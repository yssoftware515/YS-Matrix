'use strict';
// Phase 0 baseline — JWT invariants: impersonation token is ACCESS-ONLY,
// time-limited to 30 minutes, non-extendable (no refresh path), and
// carries impersonatedBy. Test secrets only — no .env loaded.
const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

process.env.JWT_ACCESS_SECRET = 'phase0-test-access-secret';
process.env.JWT_REFRESH_SECRET = 'phase0-test-refresh-secret';

const {
  JWT_CONFIG,
  generateTokens,
  generateImpersonationToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require('../src/config/jwt');

test('jwt baseline: normal access token expires per configured 15m default', () => {
  const { accessToken } = generateTokens({ userId: 'u1', role: 'OWNER' });
  const decoded = jwt.decode(accessToken);
  const ttl = decoded.exp - decoded.iat;
  assert.strictEqual(ttl, 15 * 60);
});

test('jwt baseline: impersonation token is strictly 30 minutes (non-configurable)', () => {
  const token = generateImpersonationToken({ userId: 'u2', showroomId: 's1', role: 'OWNER', impersonatedBy: 'sa1' });
  const decoded = jwt.decode(token);
  assert.strictEqual(decoded.exp - decoded.iat, 30 * 60);
});

test('jwt baseline: impersonation token verifies via the ACCESS path (same secret)', () => {
  const token = generateImpersonationToken({ userId: 'u2', showroomId: 's1', role: 'OWNER', impersonatedBy: 'sa1' });
  const verified = verifyAccessToken(token);
  assert.strictEqual(verified.impersonatedBy, 'sa1');
});

test('jwt baseline: no refresh token is issued for impersonation (access-only)', () => {
  const impersonation = generateImpersonationToken({ userId: 'u2', showroomId: 's1', role: 'OWNER', impersonatedBy: 'sa1' });
  const normal = generateTokens({ userId: 'u1', role: 'OWNER' });
  assert.throws(() => verifyRefreshToken(impersonation), 'impersonation token must NOT verify as a refresh token');
  assert.ok(verifyRefreshToken(normal.refreshToken), 'normal pair refresh token verifies');
  assert.notStrictEqual(normal.refreshToken, undefined);
});

test('jwt baseline: impersonation expiry is enforced by signature, cannot be extended', async () => {
  const token = jwt.sign(
    { userId: 'u2', showroomId: 's1', role: 'OWNER', impersonatedBy: 'sa1' },
    JWT_CONFIG.access.secret,
    { expiresIn: '1ms' }
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.throws(() => verifyAccessToken(token), /expired/i);
});