// ============================================================
// YS-MATRIX ERP — Tenant Middleware (Phase 2 Stage 1)
// v1.1 — F-25 SECURITY FIX (Zero-Trust): removed the SUPER_ADMIN
//        query/body `showroom_id` context-switching path entirely.
//
//        WHAT WAS WRONG: any request carrying a genuine (non-
//        impersonated) SUPER_ADMIN access token could read/mutate
//        ANY showroom's data on ANY normal resource route (sales,
//        inventory, customers, suppliers, ...) simply by adding
//        `?showroom_id=<target>` to the request — no audit trail,
//        no rate limit beyond the generic SuperAdmin limiter, no
//        time bound. This existed in parallel to, and was far
//        weaker than, the already-correct impersonateShowroom()
//        flow (audited, sensitiveOpsLimiter-throttled, 30-minute
//        access-only token).
//
//        WHY REMOVING IT IS SAFE: impersonateShowroom() issues a
//        token whose decoded.userId IS the target OWNER's user id
//        (not the SuperAdmin's) — see jwt.js. By the time
//        auth.middleware.js resolves req.user for an impersonation
//        token, req.user already IS that OWNER: role='OWNER',
//        showroom_id=<target showroom>. tenantGuard below never
//        needs to know a request is impersonated — it just sees an
//        OWNER locked to their own (here: the impersonated)
//        showroom_id, exactly like any other OWNER request.
//        req.impersonatedBy (decoded.impersonatedBy) remains
//        available for audit-trail purposes elsewhere, unrelated to
//        tenant resolution.
//
//        RESULT: a genuine, non-impersonated SUPER_ADMIN token now
//        resolves to ONLY the system showroom on every normal
//        resource route, full stop. Cross-tenant access exists
//        through exactly one path: the audited impersonation flow.
// ============================================================

'use strict';

const response          = require('../utils/response');
const logger             = require('../config/logger');
const SECURITY           = require('../config/security');
const { tenantStorage }  = require('../config/database');
const { auditLog }       = require('./audit.middleware');

/**
 * tenantGuard
 *
 * 1. Resolves showroomId EXCLUSIVELY from the authenticated user's
 *    own identity (req.user, set by auth.middleware from a verified
 *    JWT) — never from client-supplied query/body/params, for ANY
 *    role.
 * 2. Detects and blocks any request that also supplies a mismatched
 *    showroom_id in query/body/params — applies uniformly to every
 *    role now, including SUPER_ADMIN (this is precisely the surface
 *    the removed backdoor exploited).
 * 3. Injects AsyncLocalStorage context so every Prisma query
 *    downstream automatically inherits showroom_id.
 */
const tenantGuard = (req, res, next) => {
  const { user } = req;

  if (!user) {
    return response.unauthorized(res, 'Authentication required before tenant resolution.', 'AUTH_REQUIRED');
  }

  // Zero-Trust resolution: the user's OWN showroom_id, full stop.
  // SUPER_ADMIN's own account is seeded against the system showroom
  // (see seed.superadmin.js) — falls back there only if somehow
  // absent, never to a client-supplied value.
  const resolvedShowroomId =
    user.showroom_id || (user.role === 'SUPER_ADMIN' ? SECURITY.tenant.systemShowroomId : null);

  if (!resolvedShowroomId) {
    logger.error(`[TENANT] Could not resolve showroomId for user=${user.id}`);
    return response.serverError(res, 'فشل تحديد نطاق المعرض.');
  }

  // ── Cross-tenant attack / stale-client detection ──────────────
  // Any client-supplied showroom_id that disagrees with what we just
  // resolved is either stale frontend code (harmless but worth
  // knowing about) or an active spoofing attempt — both are treated
  // identically: logged and blocked. This now covers EVERY role,
  // including SUPER_ADMIN — previously SUPER_ADMIN's value here was
  // authoritative (the backdoor); now it is pure signal, never trusted.
  const requestedShowroom =
    req.query?.showroom_id  ||
    req.body?.showroom_id   ||
    req.params?.showroom_id ||
    null;

  if (requestedShowroom && requestedShowroom !== resolvedShowroomId) {
    logger.warn(
      `[SECURITY] Cross-tenant access attempt blocked. ` +
      `user=${user.id} (${user.email}) role=${user.role} ` +
      `own_showroom=${resolvedShowroomId} requested_showroom=${requestedShowroom} ` +
      `ip=${req.ip} path=${req.path}`
    );

    // Phase 3 — audit the block as a security event. Written against
    // the ACTOR'S OWN showroom (the identity is real; only the target
    // was spoofed), so the owning tenant's OWNER sees it in /activity.
    auditLog({
      showroomId: resolvedShowroomId,
      userId:     user.id,
      action:     'CROSS_TENANT_BLOCKED',
      entity:     'tenant',
      newData:    {
        actor:             user.email,
        role:              user.role,
        own_showroom:      resolvedShowroomId,
        requested_showroom: requestedShowroom,
        path:              req.originalUrl?.split('?')[0] || req.path,
      },
      ipAddress: req.ip,
    });

    return response.forbidden(res, 'الوصول لبيانات معرض آخر ممنوع.', 'CROSS_TENANT_BLOCKED');
  }

  req.showroomId = resolvedShowroomId;

  // Run the rest of the request inside AsyncLocalStorage context.
  // Every Prisma query downstream inherits this showroom_id automatically.
  // Phase 3 — the store also carries impersonation attribution (set by
  // auth.middleware from the token) so fire-and-forget audit writes can
  // attribute actions performed during an impersonation session to the
  // real SUPER_ADMIN (see audit.middleware.js).
  tenantStorage.run(
    { showroomId: resolvedShowroomId, impersonatedBy: req.impersonatedBy || null },
    next
  );
};

/**
 * withTenant
 *
 * Builds a Prisma `where` clause that always includes showroom_id.
 * Kept for backward compatibility — controllers that call it explicitly.
 *
 * @param {object} req - Express request (must have req.showroomId set)
 * @param {object} additionalWhere - Extra Prisma where conditions
 * @returns {object} Prisma where clause
 */
const withTenant = (req, additionalWhere = {}) => {
  const showroomId = req.showroomId;

  if (!showroomId) {
    // This should never happen in production — tenantGuard runs first.
    throw new Error('[withTenant] req.showroomId is not set. Ensure tenantGuard middleware runs before this call.');
  }

  return { showroom_id: showroomId, ...additionalWhere };
};

module.exports = { tenantGuard, withTenant };
