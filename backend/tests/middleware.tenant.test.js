'use strict';
// Phase 0 baseline — tenant isolation decisions of tenant.middleware.js.
// Uses a mock config/database (require-cache injection) so NO database
// connection is ever made and no .env is loaded.
const test = require('node:test');
const assert = require('node:assert');
const { AsyncLocalStorage } = require('async_hooks');

// ── mock ../src/config/database BEFORE requiring the middleware ──────────
const dbModulePath = require.resolve('../src/config/database');
const tenantStorage = new AsyncLocalStorage();
require.cache[dbModulePath] = {
  id: dbModulePath,
  filename: dbModulePath,
  loaded: true,
  exports: { tenantStorage },
};

const { tenantGuard, withTenant } = require('../src/middleware/tenant.middleware');

const mkRes = () => {
  const res = { statusCode: 0, body: null, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};
const delegated = () => { let called = false; const next = () => { called = true; }; next.called = () => called; return next; };

test('tenant baseline: no user → 401 before tenant resolution', () => {
  const res = mkRes();
  const next = delegated();
  tenantGuard({}, res, next);
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.code, 'AUTH_REQUIRED');
  assert.ok(!next.called());
});

test('tenant baseline: tenant resolved EXCLUSIVELY from user DB record, never client input', () => {
  const res = mkRes();
  const next = delegated();
  const req = {
    user: { id: 'u1', email: 'a@b.c', role: 'OWNER', showroom_id: 'showroom-A' },
    query: { showroom_id: 'showroom-A' }, // matching client value = benign
    body: {},
    params: {},
  };
  tenantGuard(req, res, next);
  assert.ok(next.called());
  assert.strictEqual(req.showroomId, 'showroom-A');
});

test('tenant baseline: tenant A cannot access tenant B (all roles, incl. SUPER_ADMIN)', () => {
  for (const role of ['SUPER_ADMIN', 'OWNER', 'STAFF']) {
    const res = mkRes();
    const next = delegated();
    const req = {
      user: { id: 'u1', email: 'a@b.c', role, showroom_id: 'showroom-A' },
      query: { showroom_id: 'showroom-B' },
      body: {},
      params: {},
    };
    tenantGuard(req, res, next);
    assert.strictEqual(res.statusCode, 403, `role ${role} mismatch must be blocked`);
    assert.strictEqual(res.body.code, 'CROSS_TENANT_BLOCKED');
    assert.ok(!next.called());
  }
});

test('tenant baseline: mismatched showroom_id in body/params equally blocked', () => {
  const cases = [
    { query: {}, body: { showroom_id: 'showroom-B' }, params: {} },
    { query: {}, body: {}, params: { showroom_id: 'showroom-B' } },
  ];
  for (const src of cases) {
    const res = mkRes();
    const next = delegated();
    tenantGuard({ user: { id: 'u1', role: 'OWNER', showroom_id: 'showroom-A' }, ...src }, res, next);
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.code, 'CROSS_TENANT_BLOCKED');
    assert.ok(!next.called());
  }
});

test('tenant baseline: SUPER_ADMIN without own showroom falls back to system showroom', () => {
  const res = mkRes();
  const next = delegated();
  const req = { user: { id: 'sa', role: 'SUPER_ADMIN', showroom_id: null }, query: {}, body: {}, params: {} };
  tenantGuard(req, res, next);
  assert.ok(next.called());
  assert.strictEqual(req.showroomId, 'system-showroom-001');
});

test('tenant baseline: unresolvable showroom → 500 (fail closed, no silent pass-through)', () => {
  const res = mkRes();
  const next = delegated();
  tenantGuard({ user: { id: 'x', role: 'OWNER', showroom_id: null }, query: {}, body: {}, params: {} }, res, next);
  assert.strictEqual(res.statusCode, 500);
  assert.ok(!next.called());
});

test('tenant baseline: downstream runs inside AsyncLocalStorage context', async () => {
  let seenId = null;
  const next = () => { seenId = tenantStorage.getStore()?.showroomId; };
  const req = { user: { id: 'u1', role: 'OWNER', showroom_id: 'showroom-X' }, query: {}, body: {}, params: {} };
  await new Promise((resolve) => {
    tenantGuard(req, mkRes(), () => { next(); resolve(); });
  });
  assert.strictEqual(seenId, 'showroom-X');
});

test('tenant baseline: withTenant always includes showroom_id', () => {
  const where = withTenant({ showroomId: 'showroom-Z' }, { is_active: true });
  assert.deepStrictEqual(where, { showroom_id: 'showroom-Z', is_active: true });
});

test('tenant baseline: withTenant throws when showroomId missing (fail closed)', () => {
  assert.throws(() => withTenant({}), /showroomId is not set/);
});