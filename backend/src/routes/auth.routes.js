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

// ── Login/Register-account Limiter (Phase 3 — P3-A) ────────────
// Brute-force guard for the two ANONYMOUS credential endpoints only.
// Previously applied at mount (index.js) to the ENTIRE /auth prefix —
// every /refresh, /me, /logout and /change-password call consumed the
// same 10/15min budget as login attempts, so a busy multi-tab session
// or a shared-NAT showroom could lock itself out of its own API.
// Authenticated flows stay covered by the global limiter instead.
const authLimiter = rateLimit({
  windowMs: SECURITY.rateLimit.auth.windowMs,
  max:      SECURITY.rateLimit.auth.max,
  standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => response.tooManyRequests(res, 'محاولات تسجيل دخول كثيرة. يرجى المحاولة بعد 15 دقيقة.'),
});

// ── Forgot/Reset Password Limiter (Matrix Audit — Recommendation #8) ──
// SECURITY.rateLimit.forgotPassword already existed in security.js
// (3 req/15min — "prevent email enumeration") but was never actually
// applied to any route; only the generous global limiter (100/15min)
// covered this endpoint. Applied to BOTH forgot-password-request AND
// reset-password — the same abuse profile applies to each (an
// attacker hammering either one to probe accounts or exhaust the
// email-sending quota).
const forgotPasswordLimiter = rateLimit({
  windowMs: SECURITY.rateLimit.forgotPassword.windowMs,
  max:      SECURITY.rateLimit.forgotPassword.max,
  message:  { success: false, message: 'طلبات كثيرة جداً. يرجى المحاولة بعد 15 دقيقة.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Public routes ─────────────────────────────────────────────
router.post('/login',   authLimiter, validate(loginSchema),        authController.login);
router.post('/refresh', validate(refreshTokenSchema), authController.refreshToken);

// ── Phase 4: public self-registration (tenant bootstrap) ──────
// Creates showroom + OWNER + 10-day TRIAL claim in one atomic
// transaction (auth.controller.registerAccount). Role is fixed
// OWNER — the schema is strict() so no privileged role can be
// smuggled in. Anonymous credential endpoint → authLimiter applies.
router.post(
  '/register-account',
  authLimiter,
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
