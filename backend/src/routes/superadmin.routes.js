// ============================================================
// YS-MATRIX ERP - SuperAdmin Routes (v1.4)
// Author: Yahya Al-Sulami 🦅
// v1.3 — Added: rate limiter + system stats endpoint
// v1.4 — F-22: rate limiter values now sourced from SECURITY
//        config instead of hardcoded literals (single source of truth)
// ============================================================

const express   = require('express');
const rateLimit = require('express-rate-limit');
const router    = express.Router();

const superAdminController  = require('../controllers/superadmin.controller');
const superAdminAnalytics   = require('../controllers/superadmin.analytics');
const { authenticate }      = require('../middleware/auth.middleware');
const { tenantGuard }       = require('../middleware/tenant.middleware');
const { superAdminOnly }    = require('../middleware/roles.middleware');
const { validate }          = require('../middleware/validate.middleware');
const SECURITY               = require('../config/security');

const {
  superAdminResetPasswordSchema,
  superAdminShowroomsQuerySchema,
  superAdminCreateUserSchema,
  superAdminUpdateUserSchema,
  superAdminUsersQuerySchema,
} = require('../validations/showroom.validation');

// ── Rate limiter خاص بالـ SuperAdmin ─────────────────────────
// أقل تساهلاً من الـ global limiter — قيمة SECURITY.rateLimit.superAdmin
const superAdminLimiter = rateLimit({
  windowMs: SECURITY.rateLimit.superAdmin.windowMs,
  max:      SECURITY.rateLimit.superAdmin.max,
  message:  { success: false, message: 'Too many requests from SuperAdmin, slow down.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Rate limiter أشد للعمليات الحساسة ────────────────────────
// reset password و create user — قيمة SECURITY.rateLimit.sensitive
const sensitiveOpsLimiter = rateLimit({
  windowMs: SECURITY.rateLimit.sensitive.windowMs,
  max:      SECURITY.rateLimit.sensitive.max,
  message:  { success: false, message: 'Too many sensitive operations, please wait.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Middleware Pipeline ───────────────────────────────────────
router.use(
  superAdminLimiter,
  authenticate,
  (req, res, next) => {
    if (req.user && req.user.role === 'SUPER_ADMIN') return next();
    return tenantGuard(req, res, next);
  },
  superAdminOnly
);

// ── System Analytics ──────────────────────────────────────────
router.get('/system-stats', superAdminAnalytics.getSystemStats);

// ── Showrooms ─────────────────────────────────────────────────
router.get(
  '/showrooms',
  validate(superAdminShowroomsQuerySchema, 'query'),
  superAdminController.getAllShowroomsGlobal
);

// Matrix Audit (#9 — Impersonation): rate-limited like other
// sensitive ops (create user, reset password) — issuing a session
// token, even a scoped/short-lived one, deserves the same throttle.
router.post(
  '/showrooms/:id/impersonate',
  sensitiveOpsLimiter,
  superAdminController.impersonateShowroom
);

// ── Users ─────────────────────────────────────────────────────
router.get(
  '/users',
  validate(superAdminUsersQuerySchema, 'query'),
  superAdminController.getAllUsers
);

router.get('/users/:id', superAdminController.getUserById);

router.post(
  '/users',
  sensitiveOpsLimiter,
  validate(superAdminCreateUserSchema),
  superAdminController.createUserForShowroom
);

router.patch(
  '/users/:id',
  validate(superAdminUpdateUserSchema),
  superAdminController.updateUser
);

// ── Password Management ───────────────────────────────────────
router.get('/password-reset-requests', superAdminController.getPendingResetRequests);

router.post(
  '/reset-user-password',
  sensitiveOpsLimiter,
  validate(superAdminResetPasswordSchema),
  superAdminController.resetUserPassword
);

module.exports = router;
