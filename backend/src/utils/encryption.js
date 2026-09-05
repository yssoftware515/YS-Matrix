// ============================================================
// YS-MATRIX ERP — Encryption Utility (Batch 5 — P0-A)
// AES-256-GCM authenticated encryption for TOTP secrets.
//
// Key is derived from MFA_ENCRYPTION_KEY env var (SHA-256 hash).
// Each plaintext produces a unique random IV; the IV + ciphertext
// + auth tag are concatenated and base64-encoded for DB storage.
// ============================================================

'use strict';

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/**
 * Derive a 32-byte AES-256 key from the env var.
 * Throws on first use if the env var is missing — fail-closed.
 */
function getKey() {
  const raw = process.env.MFA_ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      'MFA_ENCRYPTION_KEY environment variable is required for TOTP secret encryption. ' +
      'Set it to a random string (e.g. openssl rand -hex 32) before starting the server.'
    );
  }
  return crypto.createHash('sha256').update(raw).digest();
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * Returns base64-encoded string: IV (16) + auth tag (16) + ciphertext.
 */
function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return Buffer.concat([iv, authTag, encrypted]).toString('base64');
}

/**
 * Decrypt base64-encoded ciphertext produced by encrypt().
 */
function decrypt(encoded) {
  const key = getKey();
  const buf = Buffer.from(encoded, 'base64');

  const iv = buf.subarray(0, IV_LENGTH);
  const authTag = buf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = buf.subarray(IV_LENGTH + TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  return decrypted.toString('utf8');
}

module.exports = { encrypt, decrypt };
