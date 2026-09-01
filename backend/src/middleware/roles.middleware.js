// ============================================================
// YS-MATRIX ERP — Roles Middleware (Phase 2 Stage 1)
// Changes vs original:
//   • Unified response codes (INSUFFICIENT_ROLE, AUTH_REQUIRED)
//   • Added requireAnyRole — allows multiple explicit roles
//   • ownerOnly / superAdminOnly preserved as aliases
//   • No breaking change to existing route usage
//
// Phase 1 (Authorization Foundation):
//   • requirePermission added — delegates to the CENTRAL resolver
//     (src/services/authorization.service.js). Route files migrate
//     to it incrementally once catalog parity is proven.
//   • The legacy guards below (requireRole / requireMinRole /
//     superAdminOnly / ownerOnly / staffAndAbove) are the
//     COMPATIBILITY ADAPTER: byte-identical behavior to the
//     pre-Phase-1 contract. Their decision outcomes are equivalent
//     to this resolver's OWNER/STAFF profile resolution, enforced
//     by the permission catalog parity tests — ONE authorization
//     engine, not two.
// ============================================================

'use strict';

const response = require('../utils/response');
const { requirePermission, requireScope } = require('../services/authorization.service');

// ── Role hierarchy (higher = more privileged) ─────────────────────────────────
const ROLES = {
  SUPER_ADMIN: 3,
  OWNER:       2,
  STAFF:       1,
};

/**
 * requireRole(...allowedRoles)
 *
 * Allows only the explicitly listed roles.
 * Usage: requireRole('OWNER', 'SUPER_ADMIN')
 */
const requireRole = (...allowedRoles) => (req, res, next) => {
  const { user } = req;

  if (!user) {
    return response.unauthorized(res, 'المصادقة مطلوبة.', 'AUTH_REQUIRED');
  }

  if (!allowedRoles.includes(user.role)) {
    return response.forbidden(
      res,
      `غير مسموح. الصلاحيات المطلوبة: ${allowedRoles.join(' أو ')}.`,
      'INSUFFICIENT_ROLE'
    );
  }

  next();
};

/**
 * requireMinRole(minRole)
 *
 * Allows the given role AND any role above it in the hierarchy.
 * Usage: requireMinRole('OWNER')  →  allows OWNER + SUPER_ADMIN
 */
const requireMinRole = (minRole) => (req, res, next) => {
  const { user } = req;

  if (!user) {
    return response.unauthorized(res, 'المصادقة مطلوبة.', 'AUTH_REQUIRED');
  }

  const userLevel     = ROLES[user.role]  ?? 0;
  const requiredLevel = ROLES[minRole]    ?? 0;

  if (userLevel < requiredLevel) {
    return response.forbidden(
      res,
      'صلاحياتك غير كافية لتنفيذ هذا الإجراء.',
      'INSUFFICIENT_ROLE'
    );
  }

  next();
};

// ── Named shortcuts (backward-compatible) ─────────────────────────────────────
const superAdminOnly = requireRole('SUPER_ADMIN');
const ownerOnly      = requireMinRole('OWNER');        // OWNER + SUPER_ADMIN
const staffAndAbove  = requireMinRole('STAFF');        // everyone (authenticated)

module.exports = {
  requireRole,
  requireMinRole,
  requireAnyRole: requireRole,   // alias for clarity at call sites
  superAdminOnly,
  ownerOnly,
  staffAndAbove,
  ROLES,
  requirePermission,             // Phase 1 — canonical permission gate
  requireScope,                  // Phase 2 — GLOBAL administrative scope guard
};
