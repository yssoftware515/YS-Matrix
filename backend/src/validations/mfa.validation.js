// ============================================================
// YS-MATRIX ERP — MFA Validation Schemas (Batch 5 — P0-A)
// Zod schemas for TOTP enrollment, verification, and backup
// code endpoints.
// ============================================================

'use strict';

const { z } = require('zod');

// ─────────────────────────────────────────────────────────────
// confirmEnrollmentSchema
// POST /api/v1/mfa/confirm-enrollment
//
// After the user scans the QR code and enters their first code,
// this endpoint confirms the enrollment and activates MFA.
// The temp_token from login is passed as Bearer token (not body).
// ─────────────────────────────────────────────────────────────
const confirmEnrollmentSchema = z.object({
  code: z
    .string({ required_error: 'رمز التحقق مطلوب' })
    .length(6, 'رمز التحقق يجب أن يكون 6 أرقام')
    .regex(/^\d{6}$/, 'رمز التحقق يجب أن يحتوي على أرقام فقط'),
});

// ─────────────────────────────────────────────────────────────
// verifySchema
// POST /api/v1/mfa/verify
//
// Used during login flow when MFA is enabled — verifies the
// TOTP code (or a backup code) and issues full session tokens.
// The temp_token from login is passed as Bearer token (not body).
// ─────────────────────────────────────────────────────────────
const verifySchema = z.object({
  code: z
    .string({ required_error: 'رمز التحقق مطلوب' })
    .min(1, 'رمز التحقق مطلوب')
    .max(8, 'رمز غير صالح'),
  useBackup: z.boolean().optional().default(false),
});

// ─────────────────────────────────────────────────────────────
// getBackupCodesSchema (no body — just requires auth)
// GET /api/v1/mfa/backup-codes
// ─────────────────────────────────────────────────────────────
// No schema needed — the endpoint requires authentication only.

module.exports = {
  confirmEnrollmentSchema,
  verifySchema,
};
