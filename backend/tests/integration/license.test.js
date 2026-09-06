'use strict';
// Phase 0.5 — license enforcement against the real database.
// F1 (Customer Self-Service Completion): login is no longer refused
// for license-expired users — the session is issued EXPIRED-scoped
// (access_scope: SELF_SERVICE_ONLY) and ERP routes keep blocking via
// checkLicense per-request. The full F1 matrix lives in
// expiredAccountRecovery.test.js; the routes asserted here use tokens
// minted directly (mirroring the pre-F1 harness pattern).
const test = require('node:test');
const assert = require('node:assert');

// Import order matters: harness first (it loads .env.test and the
// fail-closed guard BEFORE any module that reads env at require-time),
// then jwt — JWT_CONFIG caches process.env at module load, so importing
// it before the harness would cache undefined secrets and break login.
const { startServer, stopServer, api } = require('../helpers/harness');
const { generateTokens } = require('../../src/config/jwt');
const { seedAll, tokenFor, IDS , unlockAll} = require('../helpers/fixtures');

let base;
let ownerA, ownerE, ownerW;

test.before(async () => {
  base = await startServer();
  await seedAll();
  ownerA = await tokenFor(base, 'owner-a@test.local');
  ownerE = generateTokens({ userId: IDS.ownerE, showroomId: IDS.showroomE, role: 'OWNER' }).accessToken;
  ownerW = generateTokens({ userId: IDS.ownerW, showroomId: IDS.showroomW, role: 'OWNER' }).accessToken;
});

test.after(async () => {
  await unlockAll();
  await stopServer();
});

test('license CURRENT: valid license → route accessible, no warning headers', async () => {
  const r = await api(base, 'GET', '/customers', { token: ownerA });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('x-license-days-left'), null);
});

test('license CURRENT: expired license → 403 LICENSE_EXPIRED on a protected route', async () => {
  const r = await api(base, 'GET', '/customers', { token: ownerE });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'LICENSE_EXPIRED');
  assert.ok(r.body.days_expired >= 5);
});

test('license CURRENT: expired-license login → 200 EXPIRED-scoped session (F1)', async () => {
  const r = await api(base, 'POST', '/auth/login', { body: { email: 'owner-e@test.local', password: 'Phase0#Test2026!' } });
  assert.strictEqual(r.status, 200, 'expired-license login must succeed (F1 scoped reactivation)');
  assert.strictEqual(r.body.data.account_status, 'EXPIRED');
  assert.strictEqual(r.body.data.access_scope, 'SELF_SERVICE_ONLY');
  assert.ok(r.body.data.accessToken);
  // The returned token is EXPIRED-scoped: ERP stays blocked, self-service opens.
  const erp = await api(base, 'GET', '/customers', { token: r.body.data.accessToken });
  assert.strictEqual(erp.status, 403);
  assert.strictEqual(erp.body.code, 'LICENSE_EXPIRED');
  const self = await api(base, 'GET', '/subscriptions/status', { token: r.body.data.accessToken });
  assert.strictEqual(self.status, 200);
});

test('license CURRENT: expiring license (≤7d) → 200 with warning headers', async () => {
  const r = await api(base, 'GET', '/customers', { token: ownerW });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('x-license-days-left'), '3');
  assert.ok(r.headers.get('x-license-warning'));
});