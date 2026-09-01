'use strict';
// Phase 0 baseline — authentication decisions of auth.middleware.js.
// config/jwt is real (test secret set in env BEFORE require) so JWT
// verification is genuinely exercised; config/database is mocked so no
// DB connection is made. No .env is loaded anywhere.
const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

process.env.JWT_ACCESS_SECRET = 'phase0-test-access-secret';
process.env.JWT_REFRESH_SECRET = 'phase0-test-refresh-secret';

// ── mock ../src/config/database BEFORE requiring the middleware ──────────
const dbModulePath = require.resolve('../src/config/database');
const dbMock = {
  user: {
    findUnique: async () => null,
  },
};
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: { baseClient: dbMock },
};

const { authenticate } = require('../src/middleware/auth.middleware');

const mkRes = () => {
  const res = { statusCode: 0, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};
const delegated = () => { let called = false; const next = () => { called = true; }; next.called = () => called; return next; };
const activeUser = (over = {}) => ({
  id: 'u1',
  showroom_id: 'showroom-A',
  name: 'Test Owner',
  email: 'owner@test.local',
  role: 'OWNER',
  is_active: true,
  showroom: { id: 'showroom-A', name: 'A', is_active: true, is_onboarded: true, license_expiry: new Date(Date.now() + 3.6e7).toISOString() },
  ...over,
});
const bearer = (token) => ({ headers: { authorization: `Bearer ${token}` } });

test('auth baseline: missing Authorization header → 401 TOKEN_MISSING', async () => {
  const res = mkRes();
  await authenticate({ headers: {} }, res, delegated());
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.code, 'TOKEN_MISSING');
});

test('auth baseline: malformed/undefined token → 401 (no DB consulted)', async () => {
  for (const t of ['null', 'undefined', 'garbage.token.here']) {
    dbMock.user.findUnique = async () => { throw new Error('DB must NOT be reached'); };
    const res = mkRes();
    const next = delegated();
    await authenticate(bearer(t), res, next);
    assert.strictEqual(res.statusCode, 401, `token ${t}`);
    assert.ok(!next.called());
  }
});

test('auth baseline: expired token → 401 TOKEN_EXPIRED (JWT verification real)', async () => {
  const expired = jwt.sign({ userId: 'u1' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '1ms' });
  await new Promise((r) => setTimeout(r, 20));
  const res = mkRes();
  await authenticate(bearer(expired), res, delegated());
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.code, 'TOKEN_EXPIRED');
});

test('auth baseline: tampered token → 401 TOKEN_MALFORMED (JWT verification real)', async () => {
  const good = jwt.sign({ userId: 'u1' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
  const tampered = good.slice(0, -4) + 'AAAA';
  const res = mkRes();
  await authenticate(bearer(tampered), res, delegated());
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.code, 'TOKEN_MALFORMED');
});

test('auth baseline: valid token but missing user → 401 USER_NOT_FOUND', async () => {
  dbMock.user.findUnique = async () => null;
  const token = jwt.sign({ userId: 'ghost' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
  const res = mkRes();
  await authenticate(bearer(token), res, delegated());
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.code, 'USER_NOT_FOUND');
});

test('auth baseline: disabled account → 401 ACCOUNT_DISABLED', async () => {
  dbMock.user.findUnique = async () => activeUser({ is_active: false });
  const token = jwt.sign({ userId: 'u1' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
  const res = mkRes();
  await authenticate(bearer(token), res, delegated());
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.code, 'ACCOUNT_DISABLED');
});

test('auth baseline: non-SUPER_ADMIN without showroom → 401 NO_SHOWROOM', async () => {
  dbMock.user.findUnique = async () => activeUser({ showroom: null, showroom_id: null });
  const token = jwt.sign({ userId: 'u1' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
  const res = mkRes();
  await authenticate(bearer(token), res, delegated());
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.code, 'NO_SHOWROOM');
});

test('auth baseline: success path loads real DB identity into req.user (never JWT claims)', async () => {
  dbMock.user.findUnique = async () => activeUser();
  const token = jwt.sign({ userId: 'u1', role: 'STAFF' }, process.env.JWT_ACCESS_SECRET, { expiresIn: '15m' });
  const req = bearer(token);
  const res = mkRes();
  const next = delegated();
  await authenticate(req, res, next);
  assert.ok(next.called());
  assert.strictEqual(req.user.role, 'OWNER', 'role must come from DB, not token claims');
  assert.strictEqual(req.showroomId, 'showroom-A');
  assert.strictEqual(req.impersonatedBy, null);
});

test('auth baseline: impersonation token preserves impersonatedBy on req', async () => {
  dbMock.user.findUnique = async () => activeUser();
  const impToken = jwt.sign(
    { userId: 'u1', showroomId: 'showroom-A', role: 'OWNER', impersonatedBy: 'sa-real-id' },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '30m' }
  );
  const req = bearer(impToken);
  const next = delegated();
  await authenticate(req, mkRes(), next);
  assert.ok(next.called());
  assert.strictEqual(req.impersonatedBy, 'sa-real-id');
});