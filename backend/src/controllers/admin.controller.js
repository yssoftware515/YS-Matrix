// ============================================================
// YS-MATRIX ERP — Platform Administration Controller
// (Phase 2 — Delegated Platform Administrators)
//
// Security contract (enforced here, server-side, fail closed):
//   • Every profile mutation passes validateProfileTarget BEFORE
//     the write and AGAIN inside the write transaction (delegate-
//     to-delegate safety: granted ⊆ actor AND scope ⊆ actor).
//   • SUPER_ADMIN is never a profile row, never modified, never
//     reset through this surface.
//   • System parity profiles (is_system) are immutable; profiles
//     with assigned users cannot be deleted (409 PROFILE_IN_USE);
//     assigning users to a profile nulls them (FK SET NULL) but is
//     rejected before deletion.
//   • Administrators live on the system showroom (role 'OWNER') —
//     they never touch a tenant's data; the tenants they read are
//     listed through the shared superadmin read handlers.
//   • Enable/disable takes effect immediately: requireScope /
//     requirePermission resolve per-request against the DB row
//     (no client-held claims), so a disabled admin is denied on
//     the very next request.
// ============================================================

'use strict';

const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const SECURITY = require('../config/security');

// SECURITY FIX (same rationale as superadmin.controller.js): this
// surface is platform-level — every handler operates across ALL
// showrooms. admin.routes.js deliberately mounts NO tenantGuard,
// so tenantStorage context is never populated here; every query
// MUST go through the unscoped baseClient or fail closed.
const { baseClient: db } = require('../config/database');

const {
  SCOPES,
  validateProfileTarget,
  loadProfileRowById,
  profileRowToRecords,
} = require('../services/authorization.service');

const response = require('../utils/response');
const logger   = require('../config/logger');
const { auditLog } = require('../middleware/audit.middleware');
const { getPagination, buildPaginationMeta } = require('../utils/pagination');

const SYSTEM_SHOWROOM_ID = SECURITY.tenant.systemShowroomId;

// ── Profile row shape used everywhere in this file ────────────
const PROFILE_INCLUDE = {
  permissions: {
    select: { scope: true, permission: { select: { key: true } } },
  },
};

// ── Audit helper — all platform profile/appointment events are
// recorded against the system showroom (fail-safe showroomId).
function log(auditParams) {
  auditLog({ showroomId: SYSTEM_SHOWROOM_ID, ipAddress: undefined, ...auditParams });
}

function dedupeRecords(records) {
  const seen = new Set();
  return records.filter((r) => {
    const sig = `${r.permission}@${r.scope}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  });
}

// ── generateTempPassword — duplicated from superadmin.controller
// (decision: do NOT refactor the superadmin surface mid-phase;
// this is the same algorithm, same entropy source).
function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const rand  = crypto.randomBytes(12);
  let pwd = 'Ys-';
  for (let i = 0; i < 6; i++) pwd += chars[rand[i] % chars.length];
  pwd += '-';
  for (let i = 6; i < 8; i++) pwd += chars[rand[i] % chars.length];
  return pwd;
}

// ─────────────────────────────────────────────────────────────
// GET /api/v1/admin/profiles
// ─────────────────────────────────────────────────────────────
const listProfiles = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const { search } = req.query;

    const where = search
      ? {
          OR: [
            { name:        { contains: search, mode: 'insensitive' } },
            { description: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {};

    const [profiles, total] = await Promise.all([
      db.profile.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { created_at: 'asc' },
        include: {
          ...PROFILE_INCLUDE,
          _count: { select: { users: true } },
        },
      }),
      db.profile.count({ where }),
    ]);

    const enriched = profiles.map((p) => ({
      id:          p.id,
      name:        p.name,
      description: p.description,
      scope:       p.scope,
      is_system:   p.is_system,
      in_use:      p._count.users,
      created_at:  p.created_at,
      updated_at:  p.updated_at,
      permissions: profileRowToRecords(p),
    }));

    return response.paginated(res, enriched, buildPaginationMeta(total, page, limit), 'Profiles list');
  } catch (err) {
    logger.error('List profiles error:', err);
    return response.error(res, 'Failed to fetch profiles');
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/admin/profiles
//
// Creates a platform profile (SHOWROOM or GLOBAL scope). The
// candidate is validated against the actor's authority BEFORE the
// write and AGAIN inside the transaction — a future delegated
// admin can never create a profile wider than its own grants.
// ─────────────────────────────────────────────────────────────
const createProfile = async (req, res) => {
  try {
    const { name, description, scope, permissions } = req.body;

    const candidate = {
      name,
      scope,
      is_system: false,
      permissions: permissions.map((g) => ({ scope: g.scope, permission: { key: g.permission } })),
    };

    const fastGate = await validateProfileTarget(req.user, candidate);
    if (!fastGate.allowed) {
      log({
        userId:   req.user.id,
        action:   'AUTHZ_ESCALATION_ATTEMPT',
        entity:   'profile',
        newData:  { actor: req.user.email, requested_profile: name, reason: fastGate.reason },
        ipAddress: req.ip,
      });
      return response.forbidden(res, 'لا يمكن إنشاء هذه الصلاحية: صلاحيات غير كافية.', 'INSUFFICIENT_ROLE');
    }

    const outcome = await db.$transaction(async (tx) => {
      // Re-validate inside the write window — check-then-write is
      // race-free for any future delegated actor.
      const innerGate = await validateProfileTarget(req.user, candidate);
      if (!innerGate.allowed) return { gate: innerGate };

      const created = await tx.profile.create({
        data: { name, description, scope, is_system: false },
        select: { id: true, name: true, description: true, scope: true, is_system: true, created_at: true },
      });

      const keys     = [...new Set(permissions.map((g) => g.permission))];
      const permRows = await tx.permission.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
      const permIdByKey = new Map(permRows.map((r) => [r.key, r.id]));

      const grants = dedupeRecords(permissions)
        .filter((g) => permIdByKey.has(g.permission))
        .map((g) => ({
          profile_id:    created.id,
          permission_id: permIdByKey.get(g.permission),
          scope:         g.scope,
        }));

      if (grants.length > 0) {
        await tx.profilePermission.createMany({ data: grants });
      }

      return { gate: null, created };
    });

    if (outcome.gate) {
      log({
        userId:   req.user.id,
        action:   'AUTHZ_ESCALATION_ATTEMPT',
        entity:   'profile',
        newData:  { actor: req.user.email, requested_profile: name, reason: outcome.gate.reason },
        ipAddress: req.ip,
      });
      return response.forbidden(res, 'لا يمكن إنشاء هذه الصلاحية: صلاحيات غير كافية.', 'INSUFFICIENT_ROLE');
    }

    log({
      userId:   req.user.id,
      action:   'PROFILE_CREATED',
      entity:   'profile',
      entityId: outcome.created.id,
      newData:  {
        name,
        scope,
        permissions: permissions.map((g) => ({ permission: g.permission, scope: g.scope })),
        created_by:  req.user.email,
      },
      ipAddress: req.ip,
    });

    return response.created(res, outcome.created, 'Profile created successfully');
  } catch (err) {
    if (err.code === 'P2002') {
      return response.conflict(res, 'اسم الصلاحية مستخدم بالفعل', 'PROFILE_NAME_TAKEN');
    }
    logger.error('Create profile error:', err);
    return response.error(res, 'Failed to create profile');
  }
};

// ─────────────────────────────────────────────────────────────
// PATCH /api/v1/admin/profiles/:id
//
// Deltas: granted / revoked carry { permission, scope } pairs;
// description/scope metadata may change alongside. System
// profiles are immutable. Every change re-runs the amplification
// gate against the merged candidate inside the transaction.
// ─────────────────────────────────────────────────────────────
const updateProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const { description, scope, granted = [], revoked = [] } = req.body;

    const target = await db.profile.findUnique({ where: { id }, include: PROFILE_INCLUDE });
    if (!target) return response.notFound(res, 'Profile not found');

    if (target.is_system) {
      log({
        userId:   req.user.id,
        action:   'AUTHZ_ESCALATION_ATTEMPT',
        entity:   'profile',
        entityId: id,
        newData:  { actor: req.user.email, target: target.name, reason: 'SYSTEM_PROFILE_PROTECTED' },
        ipAddress: req.ip,
      });
      return response.forbidden(res, 'الصلاحيات النظامية (OWNER / STAFF) محمية ولا يمكن تعديلها.', 'SYSTEM_PROFILE_PROTECTED');
    }

    const newScope = scope ?? target.scope;
    const revokedKeys = new Set(revoked.map((r) => `${r.permission}@${r.scope}`));
    const merged = dedupeRecords([
      ...profileRowToRecords(target).filter((r) => !revokedKeys.has(`${r.permission}@${r.scope}`)),
      ...granted,
    ]);

    const candidate = {
      name:        target.name,
      scope:       newScope,
      is_system:   false,
      permissions: merged.map((g) => ({ scope: g.scope, permission: { key: g.permission } })),
    };

    const fastGate = await validateProfileTarget(req.user, candidate);
    if (!fastGate.allowed) {
      log({
        userId:   req.user.id,
        action:   'AUTHZ_ESCALATION_ATTEMPT',
        entity:   'profile',
        entityId: id,
        newData:  { actor: req.user.email, target: target.name, reason: fastGate.reason },
        ipAddress: req.ip,
      });
      return response.forbidden(res, 'لا يمكن تعديل هذه الصلاحية: صلاحيات غير كافية.', 'INSUFFICIENT_ROLE');
    }

    const outcome = await db.$transaction(async (tx) => {
      const innerGate = await validateProfileTarget(req.user, candidate);
      if (!innerGate.allowed) return { gate: innerGate };

      const updated = await tx.profile.update({
        where: { id },
        data: {
          ...(description !== undefined && { description }),
          ...(scope      !== undefined && { scope: newScope }),
        },
        select: { id: true, name: true, scope: true, description: true, is_system: true },
      });

      const keys     = [...new Set([...granted, ...revoked].map((r) => r.permission))];
      const permRows = await tx.permission.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } });
      const permIdByKey = new Map(permRows.map((r) => [r.key, r.id]));

      const mutators = [];
      for (const g of dedupeRecords(granted)) {
        if (!permIdByKey.has(g.permission)) continue;
        await tx.profilePermission.upsert({
          where: {
            profile_id_permission_id_scope: {
              profile_id:    id,
              permission_id: permIdByKey.get(g.permission),
              scope:         g.scope,
            },
          },
          update: {},
          create: {
            profile_id:    id,
            permission_id: permIdByKey.get(g.permission),
            scope:         g.scope,
          },
        });
        mutators.push({ action: 'PROFILE_PERMISSION_GRANTED', data: { permission: g.permission, scope: g.scope } });
      }

      for (const r of revoked) {
        if (!permIdByKey.has(r.permission)) {
          mutators.push({ action: 'PROFILE_PERMISSION_REVOKED', data: { permission: r.permission, scope: r.scope, outcome: 'UNKNOWN_PERMISSION' } });
          continue;
        }
        const deletion = await tx.profilePermission.deleteMany({
          where: { profile_id: id, permission_id: permIdByKey.get(r.permission), scope: r.scope },
        });
        mutators.push({ action: 'PROFILE_PERMISSION_REVOKED', data: { permission: r.permission, scope: r.scope, removed: deletion.count } });
      }

      return { gate: null, updated, mutators };
    });

    if (outcome.gate) {
      log({
        userId:   req.user.id,
        action:   'AUTHZ_ESCALATION_ATTEMPT',
        entity:   'profile',
        entityId: id,
        newData:  { actor: req.user.email, target: target.name, reason: outcome.gate.reason },
        ipAddress: req.ip,
      });
      return response.forbidden(res, 'لا يمكن تعديل هذه الصلاحية: صلاحيات غير كافية.', 'INSUFFICIENT_ROLE');
    }

    for (const m of outcome.mutators) {
      log({
        userId:   req.user.id,
        action:   m.action,
        entity:   'profile',
        entityId: id,
        newData:  { ...m.data, actor: req.user.email },
        ipAddress: req.ip,
      });
    }

    log({
      userId:   req.user.id,
      action:   'PROFILE_MODIFIED',
      entity:   'profile',
      entityId: id,
      oldData:  { description: target.description, scope: target.scope },
      newData:  {
        description: outcome.updated.description,
        scope:       outcome.updated.scope,
        granted:     granted.map((g) => ({ permission: g.permission, scope: g.scope })),
        revoked:     revoked.map((r) => ({ permission: r.permission, scope: r.scope })),
        modified_by: req.user.email,
      },
      ipAddress: req.ip,
    });

    return response.success(res, outcome.updated, 'Profile updated successfully');
  } catch (err) {
    logger.error('Update profile error:', err);
    return response.error(res, 'Failed to update profile');
  }
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/v1/admin/profiles/:id
//
// System profiles immutable; profiles with assigned users return
// 409 PROFILE_IN_USE (users FK is ON DELETE SET NULL — refusal
// prevents silent disenfranchisement).
// ─────────────────────────────────────────────────────────────
const deleteProfile = async (req, res) => {
  try {
    const { id } = req.params;

    const target = await db.profile.findUnique({ where: { id }, include: PROFILE_INCLUDE });
    if (!target) return response.notFound(res, 'Profile not found');

    if (target.is_system) {
      log({
        userId:   req.user.id,
        action:   'AUTHZ_ESCALATION_ATTEMPT',
        entity:   'profile',
        entityId: id,
        newData:  { actor: req.user.email, target: target.name, reason: 'SYSTEM_PROFILE_PROTECTED' },
        ipAddress: req.ip,
      });
      return response.forbidden(res, 'الصلاحيات النظامية (OWNER / STAFF) محمية ولا يمكن حذفها.', 'SYSTEM_PROFILE_PROTECTED');
    }

    if (target.name === 'SUPER_ADMIN') {
      log({
        userId:   req.user.id,
        action:   'AUTHZ_ESCALATION_ATTEMPT',
        entity:   'profile',
        entityId: id,
        newData:  { actor: req.user.email, target: target.name, reason: 'SUPER_ADMIN_IS_PROTECTED' },
        ipAddress: req.ip,
      });
      return response.forbidden(res, 'لا يمكن حذف الصلاحية المحمية.', 'SUPER_ADMIN_IS_PROTECTED');
    }

    const inUse = await db.user.count({ where: { profile_id: id } });
    if (inUse > 0) {
      return response.conflict(res, `لا يمكن حذف الصلاحية — معيّنة لـ ${inUse} مستخدم`, 'PROFILE_IN_USE');
    }

    const fastGate = await validateProfileTarget(req.user, {
      name:        target.name,
      scope:       target.scope,
      is_system:   false,
      permissions: target.permissions.map((a) => ({ scope: a.scope, permission: { key: a.permission.key } })),
    });
    if (!fastGate.allowed) {
      log({
        userId:   req.user.id,
        action:   'AUTHZ_ESCALATION_ATTEMPT',
        entity:   'profile',
        entityId: id,
        newData:  { actor: req.user.email, target: target.name, reason: fastGate.reason },
        ipAddress: req.ip,
      });
      return response.forbidden(res, 'لا يمكن حذف هذه الصلاحية: صلاحيات غير كافية.', 'INSUFFICIENT_ROLE');
    }

    await db.$transaction(async (tx) => {
      const innerGate = await validateProfileTarget(req.user, {
        name:        target.name,
        scope:       target.scope,
        is_system:   false,
        permissions: target.permissions.map((a) => ({ scope: a.scope, permission: { key: a.permission.key } })),
      });
      if (!innerGate.allowed) return { gate: innerGate };

      // Cascade removes ProfilePermission rows; users.profile_id is
      // nulled by the FK (cannot happen here — PROFILE_IN_USE above).
      await tx.profile.delete({ where: { id } });
      return { gate: null };
    });

    log({
      userId:   req.user.id,
      action:   'PROFILE_DELETED',
      entity:   'profile',
      entityId: id,
      newData:  { name: target.name, scope: target.scope, deleted_by: req.user.email },
      ipAddress: req.ip,
    });

    return response.success(res, { id, name: target.name }, 'Profile deleted successfully');
  } catch (err) {
    logger.error('Delete profile error:', err);
    return response.error(res, 'Failed to delete profile');
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/admin/administrators
//
// Users carrying an assigned profile (profile_id NOT NULL).
// ─────────────────────────────────────────────────────────────
const listAdministrators = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const { search, is_active } = req.query;

    const where = { profile_id: { not: null } };
    if (search) {
      where.OR = [
        { name:  { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (is_active !== undefined) where.is_active = is_active === 'true';

    const [admins, total] = await Promise.all([
      db.user.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { created_at: 'desc' },
        select: {
          id:          true,
          name:        true,
          email:       true,
          role:        true,
          is_active:   true,
          avatar_url:  true,
          last_login:  true,
          created_at:  true,
          profile: {
            select: { id: true, name: true, scope: true, is_system: true },
          },
          showroom: {
            select: { id: true, name: true, slug: true },
          },
        },
      }),
      db.user.count({ where }),
    ]);

    return response.paginated(res, admins, buildPaginationMeta(total, page, limit), 'Administrators list');
  } catch (err) {
    logger.error('List administrators error:', err);
    return response.error(res, 'Failed to fetch administrators');
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/admin/administrators
//
// Creates a delegated platform administrator: a user on the
// system showroom (role OWNER envelope) carrying a GLOBAL-scope
// delegated profile. The profile is the authority source — the
// OWNER role is only the legacy-envelope. Guarded by the same
// no-amplification gate as every profile mutation.
// ─────────────────────────────────────────────────────────────
const createAdministrator = async (req, res) => {
  try {
    const { name, email, password, profile_id } = req.body;

    const profile = await db.profile.findUnique({ where: { id: profile_id }, include: PROFILE_INCLUDE });
    if (!profile) return response.notFound(res, 'Profile not found');

    if (profile.name === 'SUPER_ADMIN') {
      log({
        userId:   req.user.id,
        action:   'AUTHZ_ESCALATION_ATTEMPT',
        entity:   'user',
        newData:  { actor: req.user.email, requested_profile: profile.name, reason: 'SUPER_ADMIN_IS_PROTECTED' },
        ipAddress: req.ip,
      });
      return response.forbidden(res, 'لا يمكن تعيين صلاحية SUPER_ADMIN.', 'SUPER_ADMIN_IS_PROTECTED');
    }

    if (profile.is_system) {
      log({
        userId:   req.user.id,
        action:   'AUTHZ_ESCALATION_ATTEMPT',
        entity:   'user',
        newData:  { actor: req.user.email, requested_profile: profile.name, reason: 'SYSTEM_PROFILE_PROTECTED' },
        ipAddress: req.ip,
      });
      return response.forbidden(res, 'لا يمكن تعيين الصلاحيات النظامية (OWNER / STAFF) كمشرف منصة.', 'SYSTEM_PROFILE_PROTECTED');
    }

    if (profile.scope !== SCOPES.GLOBAL) {
      log({
        userId:   req.user.id,
        action:   'AUTHZ_ESCALATION_ATTEMPT',
        entity:   'user',
        newData:  { actor: req.user.email, requested_profile: profile.name, reason: 'PROFILE_NOT_GLOBAL' },
        ipAddress: req.ip,
      });
      return response.forbidden(res, 'صلاحية المشرف يجب أن تكون بنطاق GLOBAL.', 'PROFILE_NOT_GLOBAL');
    }

    const gate = await validateProfileTarget(req.user, profile);
    if (!gate.allowed) {
      log({
        userId:   req.user.id,
        action:   'AUTHZ_ESCALATION_ATTEMPT',
        entity:   'user',
        newData:  { actor: req.user.email, requested_profile: profile.name, reason: gate.reason },
        ipAddress: req.ip,
      });
      return response.forbidden(res, 'لا يمكن تعيين هذه الصلاحية: صلاحيات غير كافية.', 'INSUFFICIENT_ROLE');
    }

    const canonicalEmail = email.toLowerCase().trim();
    const existing = await db.user.findUnique({ where: { email: canonicalEmail } });
    if (existing) {
      return response.validationError(res, null, 'Email already registered');
    }

    const password_hash = await bcrypt.hash(password, SECURITY.password.bcryptRounds);

    const user = await db.user.create({
      data: {
        showroom_id:  SYSTEM_SHOWROOM_ID,
        name,
        email:        canonicalEmail,
        password_hash,
        role:         'OWNER', // legacy envelope only — profile_id is the authority
        profile_id,
        is_active:    true,
      },
      select: {
        id:         true,
        name:       true,
        email:      true,
        role:       true,
        is_active:  true,
        profile_id: true,
        created_at: true,
        profile:    { select: { id: true, name: true, scope: true } },
        showroom:   { select: { id: true, name: true } },
      },
    });

    log({
      userId:   req.user.id,
      action:   'ADMIN_CREATED',
      entity:   'user',
      entityId: user.id,
      newData:  {
        name,
        email:         canonicalEmail,
        profile_id,
        profile_name:  profile.name,
        profile_scope: profile.scope,
        created_by:    req.user.email,
      },
      ipAddress: req.ip,
    });

    return response.created(res, user, 'Administrator created successfully');
  } catch (err) {
    logger.error('Create administrator error:', err);
    return response.error(res, 'Failed to create administrator');
  }
};

// ─────────────────────────────────────────────────────────────
// PATCH /api/v1/admin/administrators/:id
//
// Name / enable-disable / profile reassignment. SUPER_ADMIN is
// protected; non-administrators (no profile_id) are outside this
// surface (404). is_active change is audited with its own code
// (ADMIN_ENABLED / ADMIN_DISABLED) and takes effect immediately —
// every request re-resolves the DB row.
// ─────────────────────────────────────────────────────────────
const updateAdministrator = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, is_active, profile_id } = req.body;

    const target = await db.user.findUnique({
      where: { id },
      select: {
        id: true, name: true, email: true, role: true, is_active: true,
        showroom_id: true, profile_id: true,
        profile: { select: { name: true, scope: true } },
      },
    });

    if (!target || !target.profile_id) return response.notFound(res, 'Administrator not found');

    if (target.role === 'SUPER_ADMIN') {
      log({
        userId:   req.user.id,
        action:   'AUTHZ_ESCALATION_ATTEMPT',
        entity:   'user',
        entityId: id,
        newData:  { actor: req.user.email, target: target.email, reason: 'SUPER_ADMIN_IS_PROTECTED' },
        ipAddress: req.ip,
      });
      return response.forbidden(res, 'لا يمكن تعديل حساب SuperAdmin.', 'SUPER_ADMIN_IS_PROTECTED');
    }

    let newProfile = null;
    if (profile_id !== undefined && profile_id !== target.profile_id) {
      newProfile = await db.profile.findUnique({ where: { id: profile_id }, include: PROFILE_INCLUDE });
      if (!newProfile) return response.notFound(res, 'Profile not found');

      if (newProfile.name === 'SUPER_ADMIN' || newProfile.is_system) {
        log({
          userId:   req.user.id,
          action:   'AUTHZ_ESCALATION_ATTEMPT',
          entity:   'user',
          entityId: id,
          newData:  {
            actor: req.user.email,
            target: target.email,
            requested_profile: newProfile.name,
            reason: newProfile.is_system ? 'SYSTEM_PROFILE_PROTECTED' : 'SUPER_ADMIN_IS_PROTECTED',
          },
          ipAddress: req.ip,
        });
        return response.forbidden(res, 'لا يمكن تعيين هذه الصلاحية.', newProfile.is_system ? 'SYSTEM_PROFILE_PROTECTED' : 'SUPER_ADMIN_IS_PROTECTED');
      }

      if (newProfile.scope !== SCOPES.GLOBAL) {
        log({
          userId:   req.user.id,
          action:   'AUTHZ_ESCALATION_ATTEMPT',
          entity:   'user',
          entityId: id,
          newData:  { actor: req.user.email, target: target.email, requested_profile: newProfile.name, reason: 'PROFILE_NOT_GLOBAL' },
          ipAddress: req.ip,
        });
        return response.forbidden(res, 'صلاحية المشرف يجب أن تكون بنطاق GLOBAL.', 'PROFILE_NOT_GLOBAL');
      }

      const gate = await validateProfileTarget(req.user, newProfile);
      if (!gate.allowed) {
        log({
          userId:   req.user.id,
          action:   'AUTHZ_ESCALATION_ATTEMPT',
          entity:   'user',
          entityId: id,
          newData:  { actor: req.user.email, target: target.email, requested_profile: newProfile.name, reason: gate.reason },
          ipAddress: req.ip,
        });
        return response.forbidden(res, 'لا يمكن تعيين هذه الصلاحية: صلاحيات غير كافية.', 'INSUFFICIENT_ROLE');
      }
    }

    const updated = await db.user.update({
      where: { id },
      data: {
        ...(name       !== undefined && { name }),
        ...(is_active  !== undefined && { is_active }),
        ...(profile_id !== undefined && { profile_id }),
      },
      select: {
        id:         true,
        name:       true,
        email:      true,
        role:       true,
        is_active:  true,
        profile_id: true,
        profile:    { select: { id: true, name: true, scope: true } },
      },
    });

    // Audit each actual change (no noise on no-op fields).
    if (profile_id !== undefined && profile_id !== target.profile_id) {
      log({
        userId:   req.user.id,
        action:   'ADMIN_MODIFIED',
        entity:   'user',
        entityId: id,
        oldData:  { profile_id: target.profile_id, profile_name: target.profile?.name || null },
        newData:  { profile_id, profile_name: newProfile.name, modified_by: req.user.email },
        ipAddress: req.ip,
      });
    }

    if (name !== undefined && name !== target.name) {
      log({
        userId:   req.user.id,
        action:   'ADMIN_MODIFIED',
        entity:   'user',
        entityId: id,
        oldData:  { name: target.name },
        newData:  { name, modified_by: req.user.email },
        ipAddress: req.ip,
      });
    }

    if (is_active !== undefined && is_active !== target.is_active) {
      log({
        userId:   req.user.id,
        action:   is_active ? 'ADMIN_ENABLED' : 'ADMIN_DISABLED',
        entity:   'user',
        entityId: id,
        newData:  { actor: req.user.email, target: target.email },
        ipAddress: req.ip,
      });
    }

    return response.success(res, updated, 'Administrator updated successfully');
  } catch (err) {
    logger.error('Update administrator error:', err);
    return response.error(res, 'Failed to update administrator');
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/admin/administrators/:id/reset-password
//
// Same contract as /superadmin/reset-user-password: bcrypt hash +
// refresh-token revoke in one transaction, temp password returned
// exactly once. SUPER_ADMIN never reachable here.
// ─────────────────────────────────────────────────────────────
const resetAdministratorPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { new_password } = req.body;

    const target = await db.user.findUnique({
      where:  { id },
      select: {
        id: true, name: true, email: true, role: true, is_active: true,
        showroom_id: true, profile_id: true,
        showroom: { select: { name: true } },
      },
    });

    if (!target || !target.profile_id) return response.notFound(res, 'Administrator not found');

    if (target.role === 'SUPER_ADMIN') {
      return response.forbidden(res, 'Cannot reset another SuperAdmin password');
    }

    const tempPassword    = new_password || generateTempPassword();
    const newPasswordHash = await bcrypt.hash(tempPassword, SECURITY.password.bcryptRounds);

    await db.$transaction([
      db.user.update({ where: { id }, data: { password_hash: newPasswordHash } }),
      db.refreshToken.deleteMany({ where: { user_id: id } }),
    ]);

    log({
      userId:   req.user.id,
      action:   'ADMIN_PASSWORD_RESET',
      entity:   'user',
      entityId: id,
      newData:  {
        reset_by:                req.user.email,
        target_user:             target.email,
        tokens_revoked:          true,
        password_auto_generated: !new_password,
      },
      ipAddress: req.ip,
    });

    return response.success(res, {
      user_id:       id,
      name:          target.name,
      email:         target.email,
      showroom:      target.showroom?.name || null,
      profile_id:    target.profile_id,
      temp_password: !new_password ? tempPassword : '*** provided by admin ***',
      tokens_revoked: true,
      message: 'Password reset successful. All active sessions have been terminated.',
    });
  } catch (err) {
    logger.error('Reset administrator password error:', err);
    return response.error(res, 'Failed to reset administrator password');
  }
};

module.exports = {
  listProfiles,
  createProfile,
  updateProfile,
  deleteProfile,
  listAdministrators,
  createAdministrator,
  updateAdministrator,
  resetAdministratorPassword,
};