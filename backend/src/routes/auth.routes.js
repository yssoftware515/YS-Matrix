// ============================================================
// YS-MATRIX ERP - Auth Routes
// Author: Yahya Al-Sulami 🦅
// v2.1 — Added forgot-password-request endpoint
// ============================================================

const express   = require('express');
const rateLimit = require('express-rate-limit');
const router    = express.Router();

const authController       = require('../controllers/auth.controller');
const superAdminController = require('../controllers/superadmin.controller');
const { authenticate }     = require('../middleware/auth.middleware');
const { checkLicense }     = require('../middleware/license.middleware');
const { tenantGuard }      = require('../middleware/tenant.middleware');
const { validate }         = require('../middleware/validate.middleware');
const SECURITY              = require('../config/security');
const response              = require('../utils/response');

const {
  loginSchema,
  registerSchema,
  refreshTokenSchema,
  changePasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
} = require('../validations/auth.validation');

const {
  forgotPasswordRequestSchema,
} = require('../validations/showroom.validation');

const {
  registerAccountSchema,
} = require('../validations/subscription.validation');

// ── Login Limiter (Phase 3 — P3-A, TASK-003) ──────────────────
// Brute-force guard for the anonymous login endpoint only.
// 5 req / 15 min (production default, env-tunable).
const authLimiter = rateLimit({
  windowMs: SECURITY.rateLimit.auth.windowMs,
  max:      SECURITY.rateLimit.auth.max,
  standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => response.tooManyRequests(res, 'محاولات تسجيل دخول كثيرة. يرجى المحاولة بعد 15 دقيقة.'),
});

// ── Register Limiter (TASK-003) ──────────────────────────────
// Account creation abuse prevention: 3 req / 1 hour.
const registerLimiter = rateLimit({
  windowMs: SECURITY.rateLimit.register.windowMs,
  max:      SECURITY.rateLimit.register.max,
  standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => response.tooManyRequests(res, 'طلبات تسجيل كثيرة جداً. يرجى المحاولة بعد ساعة.'),
});

// ── Forgot/Reset Password Limiter (Matrix Audit — Recommendation #8, TASK-003) ──
// 3 req / 1 hour (production default, env-tunable).
const forgotPasswordLimiter = rateLimit({
  windowMs: SECURITY.rateLimit.forgotPassword.windowMs,
  max:      SECURITY.rateLimit.forgotPassword.max,
  message:  { success: false, message: 'طلبات كثيرة جداً. يرجى المحاولة بعد ساعة.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Refresh Token Limiter (TASK-003) ─────────────────────────
// Limits refresh token replay: 30 req / 15 min.
const refreshLimiter = rateLimit({
  windowMs: SECURITY.rateLimit.refresh.windowMs,
  max:      SECURITY.rateLimit.refresh.max,
  standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => response.tooManyRequests(res, 'طلبات تحديث كثيرة. يرجى المحاولة بعد قليل.'),
});

// ── Public routes ─────────────────────────────────────────────
router.post('/login',   authLimiter, validate(loginSchema),        authController.login);
router.post('/refresh', refreshLimiter, validate(refreshTokenSchema), authController.refreshToken);

// ── Phase 4: public self-registration (tenant bootstrap) ──────
// Creates showroom + OWNER + 10-day TRIAL claim in one atomic
// transaction (auth.controller.registerAccount). Role is fixed
// OWNER — the schema is strict() so no privileged role can be
// smuggled in. Anonymous credential endpoint → registerLimiter applies.
router.post(
  '/register-account',
  registerLimiter,
  validate(registerAccountSchema),
  authController.registerAccount
);

// User-initiated — no auth required, response is always generic
router.post(
  '/forgot-password-request',
  forgotPasswordLimiter,
  validate(forgotPasswordRequestSchema),
  superAdminController.forgotPasswordRequest
);

// Matrix Audit — Phase 1: the actual self-service completion of the
// flow above — public (no auth, the user has no valid session by
// definition), token-bearing link from the emailed reset link.
router.post(
  '/reset-password',
  forgotPasswordLimiter,
  validate(resetPasswordSchema),
  authController.resetPasswordWithToken
);

// ── Protected routes ──────────────────────────────────────────
//
// F1 (Customer Self-Service Completion): the license gate below is
// NOT router-wide anymore. Identity surfaces (/me GET, /logout) must
// stay reachable for an expired-account recovery session — the
// frontend hydrates the authenticated user from /auth/me right after
// login, and an expired owner MUST reach the billing/renewal surface.
// These two read/cleanup endpoints leak nothing (own row + own
// showroom only) and ERP business routes keep their license gates
// untouched. The license-gated section below still guards the
// business-ish mutations (profile update, STAFF creation, password
// change).
router.use(authenticate, tenantGuard);

router.get('/me',      authController.getMe);
router.post('/logout', authController.logout);

// ── License-gated business surfaces ───────────────────────────
router.use(checkLicense);

router.patch('/me',    validate(updateProfileSchema), authController.updateProfile);
router.post('/register',        validate(registerSchema),       authController.register);
router.put('/change-password',  validate(changePasswordSchema), authController.changePassword);

module.exports = router;
