'use strict';
// Batch 5 — P0-A: MFA / TOTP unit tests.
// Tests TOTP verification logic, backup code generation/verification,
// and the encryption round-trip. Uses test-only env values.

const test = require('node:test');
const assert = require('node:assert');

process.env.JWT_ACCESS_SECRET = 'mfa-test-access-secret-32chars-long!!';
process.env.JWT_REFRESH_SECRET = 'mfa-test-refresh-secret-32chars-long!';
process.env.MFA_ENCRYPTION_KEY = 'mfa-test-encryption-key-for-unit-tests-only';

const speakeasy = require('speakeasy');
const { encrypt, decrypt } = require('../src/utils/encryption');
const mfaService = require('../src/services/mfa.service');

// ── TOTP Generation & Verification ──────────────────────────

test('mfa: generateTotpSecret returns base32 secret and otpauth URL', () => {
  const { secret, otpauthUrl } = mfaService.generateTotpSecret('admin@test.com');
  assert.ok(secret, 'secret should be defined');
  assert.ok(secret.length >= 16, 'secret should be at least 16 chars');
  assert.ok(otpauthUrl.startsWith('otpauth://totp/'), 'otpauth URL should start with otpauth://totp/');
  assert.ok(otpauthUrl.includes('admin%40test.com'), 'otpauth URL should contain encoded email');
});

test('mfa: verifyTotpCode accepts a valid code', () => {
  const { secret } = mfaService.generateTotpSecret('admin@test.com');
  const code = speakeasy.totp({ secret, encoding: 'base32' });
  assert.ok(mfaService.verifyTotpCode(secret, code), 'valid code should be accepted');
});

test('mfa: verifyTotpCode rejects an invalid code', () => {
  const { secret } = mfaService.generateTotpSecret('admin@test.com');
  assert.ok(!mfaService.verifyTotpCode(secret, '000000'), 'invalid code should be rejected');
  assert.ok(!mfaService.verifyTotpCode(secret, '123456'), 'wrong code should be rejected');
  assert.ok(!mfaService.verifyTotpCode(secret, 'abcdef'), 'non-numeric code should be rejected');
});

test('mfa: verifyTotpCode rejects empty/missing code', () => {
  const { secret } = mfaService.generateTotpSecret('admin@test.com');
  assert.ok(!mfaService.verifyTotpCode(secret, ''), 'empty code should be rejected');
});

// ── Backup Codes ─────────────────────────────────────────────

test('mfa: generateBackupCodes produces 8 uppercase hex codes', async () => {
  const { codes, hashes } = await mfaService.generateBackupCodes();
  assert.strictEqual(codes.length, 8, 'should generate 8 codes');
  assert.strictEqual(hashes.length, 8, 'should generate 8 hashes');
  for (const code of codes) {
    assert.ok(/^[A-Z0-9]{8}$/.test(code), `code "${code}" should be 8 uppercase hex chars`);
  }
  for (const hash of hashes) {
    assert.ok(typeof hash === 'string' && hash.startsWith('$2'), 'hash should be a bcrypt hash');
  }
});

test('mfa: generateBackupCodes produces unique codes', async () => {
  const { codes } = await mfaService.generateBackupCodes();
  const unique = new Set(codes);
  assert.strictEqual(unique.size, codes.length, 'all codes should be unique');
});

test('mfa: verifyBackupCode matches a valid code', async () => {
  const { codes, hashes } = await mfaService.generateBackupCodes();
  const result = await mfaService.verifyBackupCode(hashes, codes[0]);
  assert.ok(result.valid, 'valid code should be accepted');
  assert.strictEqual(result.index, 0, 'index should be 0 for first code');
});

test('mfa: verifyBackupCode rejects an invalid code', async () => {
  const { codes, hashes } = await mfaService.generateBackupCodes();
  const result = await mfaService.verifyBackupCode(hashes, 'XXXXXXXX');
  assert.ok(!result.valid, 'invalid code should be rejected');
  assert.strictEqual(result.index, -1, 'index should be -1 for no match');
});

test('mfa: verifyBackupCode is case-insensitive', async () => {
  const { codes, hashes } = await mfaService.generateBackupCodes();
  const lowerResult = await mfaService.verifyBackupCode(hashes, codes[0].toLowerCase());
  assert.ok(lowerResult.valid, 'lowercase code should still match');
});

test('mfa: verifyBackupCode handles empty/null backup codes', async () => {
  const result1 = await mfaService.verifyBackupCode(null, 'ABCD1234');
  assert.ok(!result1.valid, 'null backup codes should return invalid');

  const result2 = await mfaService.verifyBackupCode([], 'ABCD1234');
  assert.ok(!result2.valid, 'empty array should return invalid');

  const result3 = await mfaService.verifyBackupCode(undefined, 'ABCD1234');
  assert.ok(!result3.valid, 'undefined should return invalid');
});

// ── Encryption ───────────────────────────────────────────────

test('mfa: encryption round-trip preserves TOTP secret', () => {
  const { secret } = mfaService.generateTotpSecret('admin@test.com');
  const encrypted = encrypt(secret);
  const decrypted = decrypt(encrypted);
  assert.strictEqual(decrypted, secret, 'decrypted should match original');
  assert.notStrictEqual(encrypted, secret, 'encrypted should differ from original');
  assert.ok(encrypted.length > secret.length, 'encrypted should be longer (IV + tag + encoding)');
});

test('mfa: encryption produces different ciphertext for same plaintext', () => {
  const { secret } = mfaService.generateTotpSecret('admin@test.com');
  const enc1 = encrypt(secret);
  const enc2 = encrypt(secret);
  assert.notStrictEqual(enc1, enc2, 'random IV should produce different ciphertext');
  // Both should decrypt to the same value
  assert.strictEqual(decrypt(enc1), decrypt(enc2), 'both should decrypt to same value');
});

test('mfa: decryption fails with wrong key', () => {
  const { secret } = mfaService.generateTotpSecret('admin@test.com');
  const encrypted = encrypt(secret);
  // Temporarily override the key
  const origKey = process.env.MFA_ENCRYPTION_KEY;
  process.env.MFA_ENCRYPTION_KEY = 'wrong-key-for-testing-32-chars!!!!';
  assert.throws(() => decrypt(encrypted), /unable to authenticate/i, 'wrong key should throw auth error');
  process.env.MFA_ENCRYPTION_KEY = origKey;
});
