// ============================================================
// YS-MATRIX ERP — MFA Routes (Batch 5 — P0-A)
// TOTP enrollment, verification, and management.
// SUPER_ADMIN only.
// ============================================================

'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const router    = express.Router();

const mfaController = require('../controllers/mfa.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { tenantGuard }  = require('../middleware/tenant.middleware');
const { validate }     = require('../middleware/validate.middleware');
const SECURITY         = require('../config/security');
const response         = require('../utils/response');
const { requireMinRole } = require('../middleware/roles.middleware');

const {
  confirmEnrollmentSchema,
  verifySchema,
} = require('../validations/mfa.validation');

// ── MFA Verify Rate Limiter (Batch 5 — P0-A) ────────────────
// Tighter than sensitive ops: 5 req / 15 min.
// Protects the TOTP verification endpoint from brute-force.
const mfaVerifyLimiter = rateLimit({
  windowMs: SECURITY.rateLimit.mfaVerify.windowMs,
  max:      SECURITY.rateLimit.mfaVerify.max,
  standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => response.tooManyRequests(res, 'محاولات تحقق كثيرة. يرجى المحاولة بعد 15 دقيقة.'),
});

// ── Enroll (generate QR) ─────────────────────────────────────
// Uses temp_token from login (purpose=mfa_enroll), NOT session auth.
// No additional auth middleware — the controller verifies the temp_token.
router.post('/enroll', mfaVerifyLimiter, mfaController.enroll);

// ── Confirm Enrollment (activate MFA) ────────────────────────
// Uses temp_token from login (purpose=mfa_enroll), NOT session auth.
router.post('/confirm-enrollment', mfaVerifyLimiter, validate(confirmEnrollmentSchema), mfaController.confirmEnrollment);

// ── Verify (login flow MFA) ──────────────────────────────────
// Uses temp_token from login (purpose=mfa_verify), NOT session auth.
router.post('/verify', mfaVerifyLimiter, validate(verifySchema), mfaController.verify);

// ── Status (requires full session auth) ──────────────────────
router.get('/status', authenticate, tenantGuard, requireMinRole('SUPER_ADMIN'), mfaController.status);

module.exports = router;
