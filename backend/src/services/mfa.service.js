// ============================================================
// YS-MATRIX ERP — MFA Service (Batch 5 — P0-A)
// TOTP enrollment, verification, and backup code management.
// SUPER_ADMIN only.
// ============================================================

'use strict';

const speakeasy = require('speakeasy');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { baseClient: db } = require('../config/database');
const { encrypt, decrypt } = require('../utils/encryption');
const SECURITY = require('../config/security');

const ISSUER = 'YS-Matrix';
const BACKUP_CODE_COUNT = 8;
const BACKUP_CODE_LENGTH = 8;

// ── TOTP Enrollment ──────────────────────────────────────────

/**
 * Generate a new TOTP secret and QR code data for enrollment.
 * Returns { secret, otpauthUrl } — secret is the base32 key,
 * otpauthUrl is an otpauth:// URI for the authenticator app.
 *
 * Does NOT persist anything — the controller calls persistMfaSetup()
 * only AFTER the user verifies the first code.
 */
function generateTotpSecret(email) {
  const secret = speakeasy.generateSecret({
    name: `${ISSUER} (${email})`,
    issuer: ISSUER,
    length: 20,
  });
  return {
    secret: secret.base32,
    otpauthUrl: secret.otpauth_url,
  };
}

/**
 * Verify a TOTP code against a base32 secret.
 * window: 1 = allow ±30s drift (standard tolerance).
 */
function verifyTotpCode(secret, code) {
  return speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: code,
    window: 1,
  });
}

// ── Backup Codes ─────────────────────────────────────────────

/**
 * Generate N backup codes and return them in plaintext (shown to
 * user ONCE at enrollment). Also returns bcrypt hashes for storage.
 */
async function generateBackupCodes() {
  const rounds = SECURITY.password.bcryptRounds;
  const codes = [];
  const hashes = [];

  for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
    const code = crypto
      .randomBytes(Math.ceil(BACKUP_CODE_LENGTH / 2))
      .toString('hex')
      .slice(0, BACKUP_CODE_LENGTH)
      .toUpperCase();
    const hash = await bcrypt.hash(code, rounds);
    codes.push(code);
    hashes.push(hash);
  }

  return { codes, hashes };
}

/**
 * Verify a backup code against the stored hashes.
 * Returns { valid: boolean, index: number } — index is the position
 * of the matched hash (for removal after use), or -1 if no match.
 * A consumed backup code is NOT removed here — the caller must
 * explicitly call consumeBackupCode() to atomically consume it.
 */
async function verifyBackupCode(backupCodesHash, code) {
  if (!Array.isArray(backupCodesHash) || backupCodesHash.length === 0) {
    return { valid: false, index: -1 };
  }

  const normalized = code.toUpperCase().trim();

  for (let i = 0; i < backupCodesHash.length; i++) {
    const match = await bcrypt.compare(normalized, backupCodesHash[i]);
    if (match) {
      return { valid: true, index: i };
    }
  }

  return { valid: false, index: -1 };
}

/**
 * Remove a used backup code from the stored array.
 * Always call this AFTER verifyBackupCode() confirms validity.
 */
async function consumeBackupCode(userId, index) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { backup_codes: true },
  });

  if (!user || !Array.isArray(user.backup_codes)) return;

  const updated = [...user.backup_codes];
  updated.splice(index, 1);

  await db.user.update({
    where: { id: userId },
    data: { backup_codes: updated },
  });
}

// ── Persistence ──────────────────────────────────────────────

/**
 * Persist MFA setup after the user verifies the first TOTP code.
 * Encrypts the secret, stores bcrypt-hashed backup codes.
 */
async function persistMfaSetup(userId, plaintextSecret, backupHashes) {
  await db.user.update({
    where: { id: userId },
    data: {
      totp_secret_encrypted: encrypt(plaintextSecret),
      totp_enabled: true,
      backup_codes: backupHashes,
    },
  });
}

/**
 * Load the decrypted TOTP secret for a user.
 * Returns null if MFA is not set up.
 */
async function getDecryptedSecret(userId) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: {
      totp_secret_encrypted: true,
      totp_enabled: true,
    },
  });

  if (!user || !user.totp_enabled || !user.totp_secret_encrypted) {
    return null;
  }

  return decrypt(user.totp_secret_encrypted);
}

module.exports = {
  generateTotpSecret,
  verifyTotpCode,
  generateBackupCodes,
  verifyBackupCode,
  consumeBackupCode,
  persistMfaSetup,
  getDecryptedSecret,
  BACKUP_CODE_COUNT,
};
