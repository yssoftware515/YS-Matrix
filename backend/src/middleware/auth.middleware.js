// ============================================================
// YS-MATRIX ERP — Auth Middleware (Phase 2 Stage 1)
// v1.1 — Added req.impersonatedBy (Matrix Audit #9 — Impersonation)
//
// Changes vs original:
//   • Uses unified response helpers (machine-readable codes)
//   • More descriptive token error differentiation
//   • Explicit check for showroom existence on non-SuperAdmin
//   • req.impersonatedBy exposed from decoded.impersonatedBy, if
//     present — purely additive, does not change how req.user or
//     req.showroomId are resolved (still decoded.userId → DB lookup)
// ============================================================

'use strict';

const { verifyAccessToken }  = require('../config/jwt');
const { baseClient: db }     = require('../config/database');
const response               = require('../utils/response');
const logger                 = require('../config/logger');

/**
 * authenticate
 *
 * Verifies the JWT access token from Authorization header.
 * Injects req.user and req.showroomId.
 *
 * Uses baseClient (unscoped Prisma) — tenant isolation happens
 * AFTER this middleware in tenantGuard.
 */
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return response.unauthorized(res, 'رمز المصادقة مطلوب.', 'TOKEN_MISSING');
    }

    const token = authHeader.split(' ')[1];

    if (!token || token === 'null' || token === 'undefined') {
      return response.unauthorized(res, 'رمز المصادقة غير صالح.', 'TOKEN_INVALID');
    }

    // ── Verify JWT ──────────────────────────────────────────
    let decoded;
    try {
      decoded = verifyAccessToken(token);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return response.unauthorized(res, 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجدداً.', 'TOKEN_EXPIRED');
      }
      if (err.name === 'JsonWebTokenError') {
        return response.unauthorized(res, 'رمز المصادقة تالف.', 'TOKEN_MALFORMED');
      }
      return response.unauthorized(res, 'رمز مصادقة غير صالح.', 'TOKEN_INVALID');
    }

    // ── Load user from DB (cross-tenant lookup) ─────────────
    const user = await db.user.findUnique({
      where:  { id: decoded.userId },
      select: {
        id:          true,
        showroom_id: true,
        profile_id:  true,
        name:        true,
        email:       true,
        role:        true,
        is_active:   true,
        showroom: {
          select: {
            id:             true,
            name:           true,
            is_active:      true,
            is_onboarded:   true,
            license_expiry: true,
          },
        },
      },
    });

    if (!user) {
      return response.unauthorized(res, 'الحساب غير موجود.', 'USER_NOT_FOUND');
    }

    if (!user.is_active) {
      return response.unauthorized(res, 'الحساب معطل. تواصل مع المسؤول.', 'ACCOUNT_DISABLED');
    }

    // ── Non-SuperAdmin must have a valid showroom ────────────
    if (user.role !== 'SUPER_ADMIN' && !user.showroom) {
      return response.unauthorized(res, 'لا يوجد معرض مرتبط بهذا الحساب.', 'NO_SHOWROOM');
    }

    req.user       = user;
    req.showroomId = user.showroom_id;

    // Matrix Audit (#9 — Impersonation): purely additive. Only present
    // when this access token was issued by generateImpersonationToken()
    // (see jwt.js + superadmin.controller.js's impersonateShowroom).
    // Identity resolution above is completely unchanged — this just
    // makes the SuperAdmin's real id available to any downstream
    // controller/audit call that wants to record "acting as" context.
    req.impersonatedBy = decoded.impersonatedBy || null;

    next();
  } catch (err) {
    logger.error('Auth middleware error:', err);
    return response.serverError(res, 'فشل التحقق من الهوية.');
  }
};

module.exports = { authenticate };
