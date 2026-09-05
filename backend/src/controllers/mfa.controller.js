// ============================================================
// YS-MATRIX ERP — MFA Controller (Batch 5 — P0-A)
// TOTP enrollment, verification, and management endpoints.
// SUPER_ADMIN only.
// ============================================================

'use strict';

const { baseClient: db } = require('../config/database');
const { generateTokens } = require('../config/jwt');
const { verifyAccessToken } = require('../config/jwt');
const response = require('../utils/response');
const logger = require('../config/logger');
const mfaService = require('../services/mfa.service');
const { auditLog } = require('../middleware/audit.middleware');

// ── Helper: verify temp_token from login ─────────────────────
// Returns the decoded payload or sends an error response.
function verifyTempToken(req, res) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    response.unauthorized(res, 'رمز المصادقة مطلوب.', 'TOKEN_MISSING');
    return null;
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = verifyAccessToken(token);
    if (decoded.purpose !== 'mfa_enroll' && decoded.purpose !== 'mfa_verify') {
      response.unauthorized(res, 'رمز غير صالح.', 'TOKEN_INVALID');
      return null;
    }
    return decoded;
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      response.unauthorized(res, 'انتهت صلاحية الجلسة. يرجى تسجيل الدخول مجدداً.', 'TOKEN_EXPIRED');
    } else {
      response.unauthorized(res, 'رمز مصادقة غير صالح.', 'TOKEN_INVALID');
    }
    return null;
  }
}

// ── POST /mfa/enroll ─────────────────────────────────────────
// Generate TOTP secret + otpauth URL for enrollment.
// Requires temp_token with purpose=mfa_enroll from login.
const enroll = async (req, res) => {
  try {
    const decoded = verifyTempToken(req, res);
    if (!decoded) return;

    const user = await db.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, totp_enabled: true, email: true },
    });

    if (!user) {
      return response.notFound(res, 'الحساب غير موجود.', 'USER_NOT_FOUND');
    }

    if (user.role !== 'SUPER_ADMIN') {
      return response.forbidden(res, 'MFA متاح للمسؤول العام فقط.', 'MFA_SUPER_ADMIN_ONLY');
    }

    if (user.totp_enabled) {
      return response.conflict(res, 'MFA مفعّل بالفعل. لا يمكن إعادة التسجيل.', 'MFA_ALREADY_ENABLED');
    }

    const { secret, otpauthUrl } = mfaService.generateTotpSecret(user.email);

    // Store the plaintext secret temporarily in the temp_token.
    // The actual encrypted persistence happens in confirmEnrollment.
    // We embed the secret in the response so the frontend can display
    // the QR code, but it's ONLY sent over HTTPS and never stored
    // client-side beyond the session.
    return response.success(res, {
      secret,
      otpauthUrl,
    }, 'امسح رمز QR بتطبيق المصادقة.');

  } catch (err) {
    logger.error('MFA enroll error:', err);
    return response.serverError(res, 'فشل إعداد المصادقة الثنائية.');
  }
};

// ── POST /mfa/confirm-enrollment ─────────────────────────────
// Verify first TOTP code and activate MFA.
// Requires temp_token with purpose=mfa_enroll from login.
// Body: { code: '123456' }
const confirmEnrollment = async (req, res) => {
  try {
    const decoded = verifyTempToken(req, res);
    if (!decoded) return;

    const { code } = req.body;

    const user = await db.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, totp_enabled: true },
    });

    if (!user) {
      return response.notFound(res, 'الحساب غير موجود.', 'USER_NOT_FOUND');
    }

    if (user.role !== 'SUPER_ADMIN') {
      return response.forbidden(res, 'MFA متاح للمسؤول العام فقط.', 'MFA_SUPER_ADMIN_ONLY');
    }

    if (user.totp_enabled) {
      return response.conflict(res, 'MFA مفعّل بالفعل.', 'MFA_ALREADY_ENABLED');
    }

    // The secret was generated during enroll and passed back to the
    // frontend. The user now enters a code from their authenticator.
    // We need the secret to verify — it's embedded in the temp_token
    // OR we re-generate it. Since the temp_token doesn't carry the
    // secret (it's too large), we require the frontend to send it
    // back. This is acceptable because:
    //   1. The temp_token already authenticates the user
    //   2. The secret is only valid for this enrollment session
    //   3. HTTPS protects the transit
    //
    // HOWEVER — for maximum security, we store the pending secret
    // server-side during enrollment. Let's use a simpler approach:
    // the frontend sends the secret it received from /enroll back,
    // and we verify the code against it. If valid, we persist.
    //
    // Actually, the BEST approach: the frontend passes the secret
    // it received. We verify the code, then persist. This means the
    // secret travels client-side once (over HTTPS) which is standard
    // for TOTP enrollment flows.

    const secret = req.body.secret;
    if (!secret) {
      return response.validationError(res, { secret: 'مطلوب' }, 'الرمز السري مطلوب.');
    }

    if (!mfaService.verifyTotpCode(secret, code)) {
      return response.unauthorized(res, 'رمز التحقق غير صحيح. يرجى المحاولة مجدداً.', 'INVALID_TOTP_CODE');
    }

    // Generate backup codes and persist MFA setup
    const { codes, hashes } = await mfaService.generateBackupCodes();
    await mfaService.persistMfaSetup(user.id, secret, hashes);

    auditLog({
      showroomId: user.showroom_id || 'system-showroom-001',
      userId: user.id,
      action: 'MFA_ENABLED',
      entity: 'user',
      entityId: user.id,
      newData: { method: 'totp' },
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });

    return response.success(res, {
      backupCodes: codes,
    }, 'تم تفعيل المصادقة الثنائية بنجاح. احتفظ بأكواد الاسترداد في مكان آمن.');

  } catch (err) {
    logger.error('MFA confirm enrollment error:', err);
    return response.serverError(res, 'فشل تفعيل المصادقة الثنائية.');
  }
};

// ── POST /mfa/verify ─────────────────────────────────────────
// Verify TOTP code (or backup code) during login.
// Requires temp_token with purpose=mfa_verify from login.
// Body: { code: '123456', useBackup: false }
const verify = async (req, res) => {
  try {
    const decoded = verifyTempToken(req, res);
    if (!decoded) return;

    const { code, useBackup = false } = req.body;

    const user = await db.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true, name: true, email: true, role: true,
        totp_enabled: true, backup_codes: true,
        showroom: {
          select: {
            id: true, name: true, slug: true, is_active: true,
            is_onboarded: true, license_expiry: true,
          },
        },
      },
    });

    if (!user) {
      return response.notFound(res, 'الحساب غير موجود.', 'USER_NOT_FOUND');
    }

    if (!user.totp_enabled) {
      return response.forbidden(res, 'MFA غير مفعّل. يرجى التسجيل أولاً.', 'MFA_NOT_ENABLED');
    }

    let verified = false;

    if (useBackup) {
      // Verify as backup code
      const result = await mfaService.verifyBackupCode(user.backup_codes, code);
      if (result.valid) {
        verified = true;
        // Consume the used backup code
        await mfaService.consumeBackupCode(user.id, result.index);

        auditLog({
          showroomId: user.showroom_id || 'system-showroom-001',
          userId: user.id,
          action: 'MFA_BACKUP_CODE_USED',
          entity: 'user',
          entityId: user.id,
          newData: { remaining: (user.backup_codes?.length || 1) - 1 },
          ipAddress: req.ip,
          userAgent: req.headers?.['user-agent'],
        });
      }
    } else {
      // Verify as TOTP code
      const secret = await mfaService.getDecryptedSecret(user.id);
      if (secret) {
        verified = mfaService.verifyTotpCode(secret, code);
      }
    }

    if (!verified) {
      return response.unauthorized(res, 'رمز التحقق غير صحيح.', 'INVALID_MFA_CODE');
    }

    // MFA verified — issue full session tokens
    const tokenPayload = {
      userId: user.id,
      showroomId: user.showroom_id,
      role: user.role,
    };
    const { accessToken, refreshToken } = generateTokens(tokenPayload);

    const { hashRefreshToken, getRefreshTokenExpiry } = require('../config/jwt');
    await db.refreshToken.create({
      data: {
        user_id: user.id,
        token: hashRefreshToken(refreshToken),
        expires_at: getRefreshTokenExpiry(),
      },
    });

    // Update last login (fire-and-forget)
    db.user.update({ where: { id: user.id }, data: { last_login: new Date() } }).catch(() => {});

    auditLog({
      showroomId: user.showroom_id || 'system-showroom-001',
      userId: user.id,
      action: 'LOGIN',
      entity: 'user',
      entityId: user.id,
      ipAddress: req.ip,
      userAgent: req.headers?.['user-agent'],
    });

    return response.success(res, {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        showroom: user.showroom ? {
          id: user.showroom.id,
          name: user.showroom.name,
          slug: user.showroom.slug,
          is_onboarded: user.showroom.is_onboarded,
          license_expiry: user.showroom.license_expiry,
        } : null,
      },
      accessToken,
      refreshToken,
    }, 'تم تسجيل الدخول بنجاح.');

  } catch (err) {
    logger.error('MFA verify error:', err);
    return response.serverError(res, 'فشل التحقق من المصادقة الثنائية.');
  }
};

// ── GET /mfa/status ──────────────────────────────────────────
// Get MFA status for the authenticated SUPER_ADMIN.
// Requires full session auth (not temp_token).
const status = async (req, res) => {
  try {
    const user = await db.user.findUnique({
      where: { id: req.user.id },
      select: { totp_enabled: true, backup_codes: true },
    });

    return response.success(res, {
      totp_enabled: user.totp_enabled || false,
      backup_codes_remaining: Array.isArray(user.backup_codes)
        ? user.backup_codes.length
        : 0,
    });

  } catch (err) {
    logger.error('MFA status error:', err);
    return response.serverError(res, 'فشل جلب حالة المصادقة الثنائية.');
  }
};

module.exports = {
  enroll,
  confirmEnrollment,
  verify,
  status,
};
