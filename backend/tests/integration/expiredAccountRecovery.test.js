'use strict';
// ============================================================
// F1 — Expired-Account Scoped Reactivation (Customer Self-Service
// Completion). Verifies the full F1 contract against the real DB:
//   • license-expired users CAN log in (OWNER and STAFF)
//   • the session is EXPIRED-scoped: ERP business routes stay
//     blocked (403 LICENSE_EXPIRED via checkLicense), self-service
//     surfaces (/subscriptions/*, /auth/me) stay open
//   • refresh keeps the recovery session alive when expired, and
//     still hard-blocks deactivated showrooms (token revoked)
//   • active / SUPER_ADMIN / inactive behavior is unchanged
// ============================================================

const test = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, PASSWORD } = require('../helpers/fixtures');

let base;

test.before(async () => {
  base = await startServer();
  await seedAll();
});

test.after(async () => {
  await stopServer();
});

const login = (email) => api(base, 'POST', '/auth/login', {
  body: { email, password: PASSWORD },
});

test('F1: expired OWNER login → 200 EXPIRED-scoped session', async () => {
  const r = await login('owner-e@test.local');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.account_status, 'EXPIRED');
  assert.strictEqual(r.body.data.access_scope, 'SELF_SERVICE_ONLY');
  assert.ok(r.body.data.days_expired >= 5);
  assert.ok(r.body.data.accessToken && r.body.data.refreshToken);
  assert.strictEqual(r.body.data.user.role, 'OWNER');
});

test('F1: expired STAFF login → 200 EXPIRED-scoped session', async () => {
  const r = await login('staff-e@test.local');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.account_status, 'EXPIRED');
  assert.strictEqual(r.body.data.access_scope, 'SELF_SERVICE_ONLY');
});

test('F1: active account login unchanged (no scoping fields)', async () => {
  const r = await login('owner-a@test.local');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.account_status, undefined);
  assert.strictEqual(r.body.data.access_scope, undefined);
});

test('F1: SUPER_ADMIN login unchanged', async () => {
  const r = await login('sa@test.local');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.account_status, undefined);
  assert.strictEqual(r.body.data.user.role, 'SUPER_ADMIN');
});

test('F1: inactive showroom login still hard-blocked (SHOWROOM_INACTIVE)', async () => {
  const r = await api(base, 'POST', '/auth/login', {
    body: { email: 'owner-d@test.local', password: PASSWORD },
  });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'SHOWROOM_INACTIVE');
});

test('F1: ERP routes stay blocked for expired token (read + write)', async () => {
  const { body } = await login('owner-e@test.local');
  const token = body.data.accessToken;

  const read = await api(base, 'GET', '/customers', { token });
  assert.strictEqual(read.status, 403);
  assert.strictEqual(read.body.code, 'LICENSE_EXPIRED');

  const write = await api(base, 'POST', '/customers', { token, body: { name: 'Sneaky', phone: '+100' } });
  assert.strictEqual(write.status, 403);
  assert.strictEqual(write.body.code, 'LICENSE_EXPIRED');
});

test('F1: self-service surfaces open for expired token', async () => {
  const { body } = await login('owner-e@test.local');
  const token = body.data.accessToken;

  const status = await api(base, 'GET', '/subscriptions/status', { token });
  assert.strictEqual(status.status, 200);

  const plans = await api(base, 'GET', '/subscriptions/plans', { token });
  assert.strictEqual(plans.status, 200);
  assert.ok(Array.isArray(plans.body.data));

  const me = await api(base, 'GET', '/auth/me', { token });
  assert.strictEqual(me.status, 200);
  assert.strictEqual(me.body.data.email, 'owner-e@test.local');
});

test('F1: refresh keeps the expired recovery session alive', async () => {
  const { body } = await login('owner-e@test.local');
  const r = await api(base, 'POST', '/auth/refresh', {
    body: { refreshToken: body.data.refreshToken },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.account_status, 'EXPIRED');
  assert.ok(r.body.data.accessToken && r.body.data.refreshToken);
});

test('F1: per-request re-check — directly-minted token also blocked on ERP, open on self-service', async () => {
  // Tokens carry no license claim: checkLicense re-queries
  // showroom.license_expiry on every request, so even a token minted
  // outside login (or before the lapse) is correctly scoped.
  const { generateTokens } = require('../../src/config/jwt');
  const { IDS } = require('../helpers/fixtures');
  const token = generateTokens({ userId: IDS.ownerE, showroomId: IDS.showroomE, role: 'OWNER' }).accessToken;

  const erp = await api(base, 'GET', '/customers', { token });
  assert.strictEqual(erp.status, 403);
  assert.strictEqual(erp.body.code, 'LICENSE_EXPIRED');

  const self = await api(base, 'GET', '/subscriptions/status', { token });
  assert.strictEqual(self.status, 200);
});

test('F1: wrong password for expired account stays 401 (no enumeration)', async () => {
  const r = await api(base, 'POST', '/auth/login', {
    body: { email: 'owner-e@test.local', password: 'Wrong#Pass2026!' },
  });
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.code, 'INVALID_CREDENTIALS');
});

test('F1: refresh for deactivated showroom still rejected + token revoked', async () => {
  const r = await api(base, 'POST', '/auth/login', {
    body: { email: 'owner-d@test.local', password: PASSWORD },
  });
  assert.strictEqual(r.status, 403, 'login itself is blocked — nothing to refresh');
  // Token-level check: mint a refresh token directly for the disabled
  // showroom's user and confirm the endpoint revokes it.
  // Phase A (P2-1): the DB stores the SHA-256 digest only — the test
  // seeds the hash, matching what login()/refresh() now write/read.
  const { generateTokens, verifyRefreshToken, hashRefreshToken } = require('../../src/config/jwt');
  const { baseClient } = require('../helpers/harness');
  const { IDS } = require('../helpers/fixtures');
  const { refreshToken } = generateTokens({ userId: IDS.ownerD, showroomId: IDS.showroomD, role: 'OWNER' });
  assert.ok(verifyRefreshToken(refreshToken));
  await baseClient.refreshToken.create({
    data: { user_id: IDS.ownerD, token: hashRefreshToken(refreshToken), expires_at: new Date(Date.now() + 86400000) },
  });

  const attempt = await api(base, 'POST', '/auth/refresh', { body: { refreshToken } });
  assert.strictEqual(attempt.status, 403);
  assert.strictEqual(attempt.body.code, 'SHOWROOM_INACTIVE');

  const replay = await api(base, 'POST', '/auth/refresh', { body: { refreshToken } });
  assert.strictEqual(replay.status, 401, 'revoked token must not be reusable');
  assert.strictEqual(replay.body.code, 'REFRESH_TOKEN_NOT_FOUND');
});

test('F1: active account refresh unchanged (no scoping fields)', async () => {
  const login = await api(base, 'POST', '/auth/login', {
    body: { email: 'owner-a@test.local', password: PASSWORD },
  });
  const r = await api(base, 'POST', '/auth/refresh', {
    body: { refreshToken: login.body.data.refreshToken },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.account_status, undefined);
  assert.ok(r.body.data.accessToken);
});

test('F1: STAFF creation from expired session stays license-gated (business surface)', async () => {
  const { body } = await login('owner-e@test.local');
  const createStaff = await api(base, 'POST', '/auth/register', {
    token: body.data.accessToken,
    body:  { name: 'X', email: 'x-e@test.local', password: 'Phase0#Test2026!', role: 'STAFF' },
  });
  assert.strictEqual(createStaff.status, 403);
  assert.strictEqual(createStaff.body.code, 'LICENSE_EXPIRED', 'STAFF creation is a business surface — must stay license-gated');
});
