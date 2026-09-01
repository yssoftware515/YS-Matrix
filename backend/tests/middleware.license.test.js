'use strict';
// Phase 0 baseline — license enforcement decisions of license.middleware.js.
// Pure middleware logic; no DB. All showroom dates built relative to now.
const test = require('node:test');
const assert = require('node:assert');

const { checkLicense } = require('../src/middleware/license.middleware');

const DAY = 24 * 60 * 60 * 1000;
const mkRes = () => {
  const res = { statusCode: 0, body: null, headers: {} };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  res.setHeader = (k, v) => { res.headers[k] = v; };
  return res;
};
const delegated = () => { let called = false; const next = () => { called = true; }; next.called = () => called; return next; };
const showroom = (over = {}) => ({
  is_active: true,
  license_expiry: new Date(Date.now() + 30 * DAY).toISOString(),
  ...over,
});

test('license baseline: SUPER_ADMIN bypasses all license checks', () => {
  const next = delegated();
  checkLicense({ user: { role: 'SUPER_ADMIN' } }, mkRes(), next);
  assert.ok(next.called());
});

test('license baseline: missing or inactive showroom → 403 SHOWROOM_INACTIVE', () => {
  const res = mkRes();
  const next = delegated();
  checkLicense({ user: { role: 'OWNER', showroom: { ...showroom(), is_active: false } } }, res, next);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.code, 'SHOWROOM_INACTIVE');
  assert.ok(!next.called());

  const res2 = mkRes();
  checkLicense({ user: { role: 'OWNER', showroom: null } }, res2, delegated());
  assert.strictEqual(res2.statusCode, 403);
  assert.strictEqual(res2.body.code, 'SHOWROOM_INACTIVE');
});

test('license baseline: expired license → 403 LICENSE_EXPIRED with metadata', () => {
  const expiry = new Date(Date.now() - 5 * DAY);
  const res = mkRes();
  checkLicense({ user: { role: 'OWNER', showroom: { ...showroom(), license_expiry: expiry.toISOString() } } }, res, delegated());
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.code, 'LICENSE_EXPIRED');
  assert.strictEqual(res.body.days_expired, 5);
});

test('license baseline: healthy license (>7 days) passes with NO warning headers', () => {
  const res = mkRes();
  const next = delegated();
  checkLicense({ user: { role: 'OWNER', showroom: { ...showroom(), license_expiry: new Date(Date.now() + 30 * DAY).toISOString() } } }, res, next);
  assert.ok(next.called());
  assert.strictEqual(res.headers['X-License-Warning'], undefined);
});

test('license baseline: expiring ≤7 days gets warning headers but is ALLOWED', () => {
  const res = mkRes();
  const next = delegated();
  const expiry = new Date(Date.now() + 3 * DAY);
  checkLicense(
    { user: { role: 'OWNER', showroom: { ...showroom(), license_expiry: expiry.toISOString() } } },
    res,
    next
  );
  assert.ok(next.called());
  assert.strictEqual(res.headers['X-License-Days-Left'], '3');
  assert.ok(res.headers['X-License-Warning']);
});