// ============================================================
// YS-MATRIX ERP — Authorization Service (Phase 1 — Authorization
// Foundation)
//
// THE CENTRAL AUTHORIZATION RESOLUTION PATH.
//
// Request flow (Phase 1):
//   Authentication (auth.middleware — DB-resolved identity)
//     ↓
//   Permission resolution (this service — DB-backed profiles)
//     ↓
//   Scope resolution (SHOWROOM / SELF — assignment-level)
//     ↓
//   Authorization decision (requirePermission / hasPermission)
//     ↓
//   Controller → existing scoped database query (unchanged)
//
// Design rules enforced here:
//   • SUPER_ADMIN is a protected system authority — short-circuits
//     exactly like every legacy guard (never data-driven, never
//     assignable, never modifiable through profiles).
//   • Fail closed: unknown role, missing profile, unknown
//     permission, or DB error → DENY (or 500 for infra errors).
//   • No privilege amplification: every profile/profile-assignment
//     change must pass validateProfileAssignment()
//     (granted_permissions ⊆ creator_permissions AND
//      granted_scope ⊆ creator_scope, checked server-side).
//   • The legacy route guards in roles.middleware.js are the
//     compatibility adapter: identical behavior, same decision
//     outcome as this resolver's OWNER/STAFF profiles (enforced by
//     the catalog-parity tests). Route files will migrate to
//     requirePermission incrementally, after parity is proven.
// ============================================================

'use strict';

const prisma  = require('../config/database');
const response = require('../utils/response');
const logger   = require('../config/logger');
const SECURITY = require('../config/security');
const { auditLog } = require('../middleware/audit.middleware');
const {
  SCOPES,
  hasPermission,
  containsAll,
} = require('./permissionCatalog');

// ─────────────────────────────────────────────────────────────
// Profile loading (DB is the runtime source of truth)
// ─────────────────────────────────────────────────────────────

/**
 * Loads a profile row with its assignment records.
 * Profile rows are platform-level (GLOBAL_MODELS) — safe to query
 * outside any tenant context.
 */
async function loadProfileRow(profileName) {
  return prisma.profile.findUnique({
    where:  { name: profileName },
    include: {
      permissions: {
        select: {
          scope:      true,
          permission: { select: { key: true } },
        },
      },
    },
  });
}

/** Converts a loaded profile row into { permission, scope } records. */
function profileRowToRecords(row) {
  return row.permissions.map((a) => ({
    permission: a.permission.key,
    scope:      a.scope,
  }));
}

/**
 * Loads a profile row BY ID (Phase 2 — user-level profile override).
 * Same platform-level (GLOBAL_MODELS) access rules as loadProfileRow.
 */
async function loadProfileRowById(profileId) {
  return prisma.profile.findUnique({
    where:  { id: profileId },
    include: {
      permissions: {
        select: {
          scope:      true,
          permission: { select: { key: true } },
        },
      },
    },
  });
}

// ─────────────────────────────────────────────────────────────
// Effective authorization resolution
// ─────────────────────────────────────────────────────────────

/**
 * Resolves the effective authorization state for an authenticated
 * user (already DB-resolved by auth.middleware — never JWT claims).
 *
 * Returns (forward-compatible contract):
 *   { profile, scope, permissions: [{ permission, scope }], isSystemAuthority }
 *
 * SUPER_ADMIN → isSystemAuthority: true, scope GLOBAL, permissions []
 * (system authority bypass — matching every legacy SUPER_ADMIN guard).
 *
 * OTHER USERS — Phase 2 resolution order:
 *   1. user.profile_id set  → resolve the ASSIGNED profile row by id
 *      (delegated administrator / any profile override). The profile's
 *      own scope + grant records become the effective authorization.
 *   2. profile_id NULL      → legacy role-based fallback: profile row
 *      named after user.role (OWNER / STAFF) — byte-identical to the
 *      Phase 1 behavior.
 *
 * Unknown/missing profile (id or name) or any DB error → fail closed:
 * profile kept, empty permission list → every check denies, the
 * user keeps only identity-level access (their data still loads
 * for existing role-guarded routes).
 */
async function effectiveAuthorization(user) {
  if (!user) return null;

  const role = user.role;

  if (role === 'SUPER_ADMIN') {
    return {
      profile:            'SUPER_ADMIN',
      scope:              SCOPES.GLOBAL,
      permissions:        [],
      isSystemAuthority:  true,
    };
  }

  try {
    let row;
    if (user.profile_id) {
      // Phase 2 — assigned-profile override (delegated administrators).
      row = await loadProfileRowById(user.profile_id);
      if (!row) {
        // Should be impossible (FK ON DELETE SET NULL), but fail closed
        // rather than silently falling back to a role-bundled profile.
        logger.error('[Authorization] Assigned profile missing — failing closed:', {
          userId:   user.id,
          profileId: user.profile_id,
        });
      }
    } else {
      // Legacy: role-named profile (OWNER / STAFF).
      row = await loadProfileRow(role);
    }

    return {
      profile:           row ? row.name : role,
      scope:             row ? (row.scope || SCOPES.SHOWROOM) : SCOPES.SHOWROOM,
      permissions:       row ? profileRowToRecords(row) : [],
      isSystemAuthority: false,
    };
  } catch (err) {
    logger.error('[Authorization] Profile resolution failed — failing closed:', {
      role,
      err: err.message,
    });
    return {
      profile:           role,
      scope:             SCOPES.SHOWROOM,
      permissions:       [],
      isSystemAuthority: false,
    };
  }
}

/**
 * Boolean answer to: "does this identity hold permission X at
 * scope Y?" — the single question every authorization decision asks.
 */
async function userHasPermission(user, permission, requiredScope = SCOPES.SHOWROOM) {
  if (!user) return false;
  const eff = await effectiveAuthorization(user);
  if (!eff) return false;
  if (eff.isSystemAuthority) return true; // SUPER_ADMIN — protected system authority
  return hasPermission(eff.permissions, permission, requiredScope);
}

// ─────────────────────────────────────────────────────────────
// Denial auditing (Phase 3 — Security Governance)
// ─────────────────────────────────────────────────────────────
// Every route-level authorization denial becomes a truthful
// AUTHZ_DENIED audit row (fire-and-forget, defensive — a denial
// audit failure must never change the denial response). Attributed
// to the actor's OWN showroom (delegated platform admins live on
// the system showroom, so platform denials land there naturally).
function auditDenial(req, { reason, permission, requiredScope }) {
  if (!req.user) return;
  try {
    auditLog({
      showroomId: req.user.showroom_id || SECURITY.tenant.systemShowroomId,
      userId:     req.user.id,
      action:     'AUTHZ_DENIED',
      entity:     'authorization',
      newData:    {
        actor:          req.user.email || req.user.id,
        role:           req.user.role,
        permission:     permission || null,
        required_scope: requiredScope || null,
        reason,
        method:         req.method,
        path:           req.originalUrl?.split('?')[0] || req.path,
      },
      ipAddress: req.ip,
    });
  } catch (err) {
    logger.error('[Authorization] Denial audit failed:', err);
  }
}

// ─────────────────────────────────────────────────────────────
// Express middleware — canonical permission gate for routes
// ─────────────────────────────────────────────────────────────

/**
 * requirePermission('resource:action', scope?)
 * To be adopted incrementally by route files once parity is proven
 * (legacy role guards remain the compatibility adapter today).
 * Runs AFTER authenticate (needs req.user).
 */
function requirePermission(permission, requiredScope = SCOPES.SHOWROOM) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return response.unauthorized(res, 'المصادقة مطلوبة.', 'AUTH_REQUIRED');
      }

      const eff = await effectiveAuthorization(req.user);

      if (!eff) {
        return response.serverError(res, 'فشل التحقق من الصلاحيات.');
      }

      if (!eff.isSystemAuthority && !hasPermission(eff.permissions, permission, requiredScope)) {
        auditDenial(req, { reason: 'INSUFFICIENT_PERMISSION', permission, requiredScope });
        return response.forbidden(
          res,
          `غير مسموح. الصلاحية المطلوبة: ${permission} (${requiredScope}).`,
          'INSUFFICIENT_PERMISSION'
        );
      }

      next();
    } catch (err) {
      logger.error('[Authorization] requirePermission error — failing closed:', {
        permission,
        requiredScope,
        err: err.message,
      });
      return response.serverError(res, 'فشل التحقق من الصلاحيات.');
    }
  };
}

// ─────────────────────────────────────────────────────────────
// Scope guard — GLOBAL administrative surfaces
// ─────────────────────────────────────────────────────────────

/**
 * requireScope('GLOBAL')
 *
 * Router-level guard for platform-administration surfaces. Resolves
 * effective authorization SERVER-SIDE (never client state):
 *   • SUPER_ADMIN            → pass (protected system authority)
 *   • effective scope match  → pass
 *   • anything else          → 403 INSUFFICIENT_SCOPE (fail closed)
 *
 * Used together with granular requirePermission on individual routes.
 */
function requireScope(requiredScope) {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return response.unauthorized(res, 'المصادقة مطلوبة.', 'AUTH_REQUIRED');
      }

      const eff = await effectiveAuthorization(req.user);

      if (!eff) {
        return response.serverError(res, 'فشل التحقق من الصلاحيات.');
      }

      if (!eff.isSystemAuthority && eff.scope !== requiredScope) {
        auditDenial(req, { reason: 'INSUFFICIENT_SCOPE', permission: null, requiredScope });
        return response.forbidden(
          res,
          `غير مسموح. يتطلب نطاق: ${requiredScope}.`,
          'INSUFFICIENT_SCOPE'
        );
      }

      next();
    } catch (err) {
      logger.error('[Authorization] requireScope error — failing closed:', {
        requiredScope,
        err: err.message,
      });
      return response.serverError(res, 'فشل التحقق من الصلاحيات.');
    }
  };
}

// ─────────────────────────────────────────────────────────────
// Assignment validation — NO PRIVILEGE AMPLIFICATION
// ─────────────────────────────────────────────────────────────

/**
 * validateProfileAssignment(actor, targetRoleName)
 *
 * Server-side gate for EVERY profile assignment (role change,
 * user creation with a role). Enforces, before any mutation:
 *   1. target !== SUPER_ADMIN (protected, non-delegable)
 *   2. grant_capability: actor holds `user:create` at SHOWROOM scope
 *   3. granted_permissions ⊆ creator_permissions  (same scope)
 *   4. granted_scope ⊆ creator_scope
 * SUPER_ADMIN actor bypasses (system authority) — matching the
 * legacy model where only SUPER_ADMIN assigns any role.
 *
 * Returns { allowed, reason? } — controllers decide the HTTP
 * response and audit the denial. Pure validation is synchronous
 * after the (async) data loads: the caller must still perform the
 * actual assignment inside ITS transaction; this check runs before
 * that write.
 */
async function validateProfileAssignment(actor, targetRoleName) {
  if (!actor) {
    return { allowed: false, reason: 'ACTOR_MISSING' };
  }

  if (targetRoleName === 'SUPER_ADMIN') {
    return { allowed: false, reason: 'SUPER_ADMIN_IS_PROTECTED' };
  }

  if (actor.role === 'SUPER_ADMIN') {
    // System authority — identical to the legacy model where the
    // platform SuperAdmin assigns OWNER/STAFF roles. Protected from
    // delegation by the target guard above (never SUPER_ADMIN).
    return { allowed: true };
  }

  // Non-system administrator path (future delegated admins; OWNER
  // today via /auth/register). Every grant must be contained in the
  // actor's own effective authority.
  const actorEff = await effectiveAuthorization(actor);
  if (!actorEff) {
    return { allowed: false, reason: 'ACTOR_AUTHORIZATION_UNAVAILABLE' };
  }

  // Capability: assignment requires the user-management permission.
  if (!hasPermission(actorEff.permissions, 'user:create', SCOPES.SHOWROOM)) {
    return { allowed: false, reason: 'INSUFFICIENT_CAPABILITY' };
  }

  let targetRow;
  try {
    targetRow = await loadProfileRow(targetRoleName);
  } catch (err) {
    logger.error('[Authorization] validateProfileAssignment — target profile load failed:', {
      targetRoleName,
      err: err.message,
    });
    return { allowed: false, reason: 'TARGET_PROFILE_UNAVAILABLE' };
  }

  if (!targetRow) {
    return { allowed: false, reason: 'UNKNOWN_TARGET_PROFILE' };
  }

  const targetRecords = profileRowToRecords(targetRow);

  // Rule 3: granted_permissions ⊆ creator_permissions.
  if (!containsAll(actorEff.permissions, targetRecords)) {
    return { allowed: false, reason: 'PRIVILEGE_AMPLIFICATION' };
  }

  // Rule 4: granted_scope ⊆ creator_scope. Phase 1: only SHOWROOM
  // profiles exist, so any GLOBAL-scoped future target is rejected
  // unless the actor itself holds GLOBAL scope (impossible today).
  const targetScope = targetRow.scope || SCOPES.SHOWROOM;
  if (actorEff.scope !== SCOPES.GLOBAL && targetScope !== actorEff.scope) {
    return { allowed: false, reason: 'SCOPE_AMPLIFICATION' };
  }

  return { allowed: true };
}

// ─────────────────────────────────────────────────────────────
// Profile-target validation (Phase 2 — profile management)
// ─────────────────────────────────────────────────────────────

/**
 * validateProfileTarget(actor, targetRow)
 *
 * Server-side gate for CREATING / MUTATING a profile row. Runs before
 * any mutation; the caller must apply the checks INSIDE its write
 * transaction for delegate-to-delegate safety (Slice 1: only
 * SUPER_ADMIN mutates profiles, so the check-then-write window is
 * race-free; the in-transaction form is required once delegated
 * admins can grant).
 *
 * Rules (fail closed):
 *   1. targetRow missing            → UNKNOWN_TARGET_PROFILE
 *   2. target name SUPER_ADMIN      → SUPER_ADMIN_IS_PROTECTED
 *      (must never exist as a profile row)
 *   3. target.is_system             → SYSTEM_PROFILE_PROTECTED
 *      (OWNER / STAFF parity rows are immutable)
 *   4. SUPER_ADMIN actor            → allowed (system authority)
 *   5. granted ⊆ actor              → PRIVILEGE_AMPLIFICATION
 *   6. target scope ⊆ actor scope   → SCOPE_AMPLIFICATION
 *      (GLOBAL target by a SHOWROOM-scoped actor is impossible)
 *
 * Returns { allowed, reason? }.
 */
async function validateProfileTarget(actor, targetRow) {
  if (!actor) {
    return { allowed: false, reason: 'ACTOR_MISSING' };
  }

  if (!targetRow) {
    return { allowed: false, reason: 'UNKNOWN_TARGET_PROFILE' };
  }

  if (targetRow.name === 'SUPER_ADMIN') {
    return { allowed: false, reason: 'SUPER_ADMIN_IS_PROTECTED' };
  }

  if (targetRow.is_system) {
    return { allowed: false, reason: 'SYSTEM_PROFILE_PROTECTED' };
  }

  if (actor.role === 'SUPER_ADMIN') {
    // System authority may define administrator profiles. GLOBAL scope
    // is never delegable to SUPER_ADMIN itself (rule 2) and never
    // reachable by SHOWROOM actors (rule 6 below).
    return { allowed: true };
  }

  const actorEff = await effectiveAuthorization(actor);
  if (!actorEff) {
    return { allowed: false, reason: 'ACTOR_AUTHORIZATION_UNAVAILABLE' };
  }

  const targetRecords = profileRowToRecords(targetRow);

  // Rule 6 (checked first — scope is the coarsest containment): a
  // SHOWROOM-scoped actor may never define a GLOBAL-scoped profile.
  const targetScope = targetRow.scope || SCOPES.SHOWROOM;
  if (actorEff.scope !== SCOPES.GLOBAL && targetScope !== actorEff.scope) {
    return { allowed: false, reason: 'SCOPE_AMPLIFICATION' };
  }

  // Rule 5: granted_permissions ⊆ creator_permissions (same scope).
  if (!containsAll(actorEff.permissions, targetRecords)) {
    return { allowed: false, reason: 'PRIVILEGE_AMPLIFICATION' };
  }

  return { allowed: true };
}

module.exports = {
  SCOPES,
  effectiveAuthorization,
  userHasPermission,
  requirePermission,
  requireScope,
  validateProfileAssignment,
  validateProfileTarget,
  loadProfileRow,
  loadProfileRowById,
  profileRowToRecords,
};