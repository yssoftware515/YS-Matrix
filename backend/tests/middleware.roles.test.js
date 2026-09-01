'use strict';
// Phase 0 baseline — authorization decisions of roles.middleware.js.
// CURRENT BEHAVIOR capture: no future permission model in these tests.
const test = require('node:test');
const assert = require('node:assert');

const {
  requireRole,
  requireMinRole,
  requireAnyRole,
  superAdminOnly,
  ownerOnly,
  staffAndAbove,
  ROLES,
} = require('../src/middleware/roles.middleware');

const mkRes = () => {
  const res = { statusCode: 0, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};
const delegated = () => { let called = false; const next = () => { called = true; }; next.called = () => called; return next; };

test('authorization baseline: role hierarchy levels (CURRENT BEHAVIOR)', () => {
  assert.strictEqual(ROLES.SUPER_ADMIN, 3);
  assert.strictEqual(ROLES.OWNER, 2);
  assert.strictEqual(ROLES.STAFF, 1);
});

test('requireRole allows only explicitly listed roles', () => {
  const allow = requireRole('OWNER', 'SUPER_ADMIN');
  const res = mkRes();
  const next = delegated();
  allow({ user: { role: 'OWNER' } }, res, next);
  assert.ok(next.called(), 'OWNER must pass requireRole(OWNER, SUPER_ADMIN)');
  assert.notStrictEqual(res.statusCode, 403);

  const blocked = delegated();
  allow({ user: { role: 'STAFF' } }, mkRes(), blocked);
  assert.ok(!blocked.called(), 'STAFF must be blocked by requireRole(OWNER, SUPER_ADMIN)');
});

test('requireRole without user returns 401 AUTH_REQUIRED', () => {
  const res = mkRes();
  const next = delegated();
  requireRole('OWNER')({}, res, next);
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.code, 'AUTH_REQUIRED');
  assert.ok(!next.called());
});

test('requireRole insufficient role returns 403 INSUFFICIENT_ROLE', () => {
  const res = mkRes();
  const next = delegated();
  requireRole('SUPER_ADMIN')({ user: { role: 'OWNER' } }, res, next);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.code, 'INSUFFICIENT_ROLE');
  assert.ok(!next.called());
});

test('requireMinRole hierarchy: OWNER >= OWNER, STAFF blocked, SUPER_ADMIN allowed', () => {
  const mw = requireMinRole('OWNER');
  for (const role of ['OWNER', 'SUPER_ADMIN']) {
    const next = delegated();
    mw({ user: { role } }, mkRes(), next);
    assert.ok(next.called(), `${role} must pass requireMinRole(OWNER)`);
  }
  const blocked = delegated();
  mw({ user: { role: 'STAFF' } }, mkRes(), blocked);
  assert.ok(!blocked.called(), 'STAFF must be blocked by requireMinRole(OWNER)');
});

test('requireAnyRole behaves as requireRole (alias)', () => {
  const next = delegated();
  requireAnyRole('SUPER_ADMIN')({ user: { role: 'SUPER_ADMIN' } }, mkRes(), next);
  assert.ok(next.called());
});

test('named shortcuts: superAdminOnly / ownerOnly / staffAndAbove (CURRENT BEHAVIOR)', () => {
  const sa = delegated();
  superAdminOnly({ user: { role: 'SUPER_ADMIN' } }, mkRes(), sa);
  assert.ok(sa.called(), 'SUPER_ADMIN passes superAdminOnly');

  const saBlocked = delegated();
  superAdminOnly({ user: { role: 'OWNER' } }, mkRes(), saBlocked);
  assert.ok(!saBlocked.called(), 'OWNER blocked by superAdminOnly');

  const o = delegated();
  ownerOnly({ user: { role: 'OWNER' } }, mkRes(), o);
  assert.ok(o.called(), 'OWNER passes ownerOnly');

  const staffCancel = delegated();
  ownerOnly({ user: { role: 'STAFF' } }, mkRes(), staffCancel);
  assert.ok(!staffCancel.called(), 'STAFF blocked by ownerOnly (paid-installment cancel protection)');

  const s = delegated();
  staffAndAbove({ user: { role: 'STAFF' } }, mkRes(), s);
  assert.ok(s.called(), 'STAFF passes staffAndAbove');
});