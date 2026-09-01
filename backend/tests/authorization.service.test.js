'use strict';
// Phase 2 — Slice 1: resolver profile override + fail-closed scope guard.
// Unit-level: config/database is stubbed via require-cache injection
// (same precedent as the Phase 0 middleware tests) — NO DB, NO .env,
// NO network.
const test   = require('node:test');
const assert = require('node:assert');

// ── Stub config/database BEFORE the service loads ────────────
const DB_PATH = require.resolve('../src/config/database');

const OWNER_ROW = {
  name:        'OWNER',
  scope:       'SHOWROOM',
  is_system:   true,
  permissions: [
    { scope: 'SHOWROOM', permission: { key: 'user:create' } },
    { scope: 'SHOWROOM', permission: { key: 'sales:cancel' } },
    { scope: 'SHOWROOM', permission: { key: 'dashboard:read' } },
  ],
};

const PLATFORM_ROW = {
  id:          'p-platform',
  name:        'PLATFORM_ADMIN',
  scope:       'GLOBAL',
  is_system:   false,
  permissions: [
    { scope: 'GLOBAL', permission: { key: 'platform_admin:read' } },
    { scope: 'GLOBAL', permission: { key: 'platform_admin:create' } },
    { scope: 'GLOBAL', permission: { key: 'platform_user:read' } },
  ],
};

const LIMITED_ROW = {
  id:          'p-limited',
  name:        'PLATFORM_LIMITED',
  scope:       'SHOWROOM',
  is_system:   false,
  permissions: [
    { scope: 'SHOWROOM', permission: { key: 'dashboard:read' } },
  ],
};

let failNext = null; // { error | null } — forces findUnique to throw once
const byId = new Map([['p-platform', PLATFORM_ROW], ['p-limited', LIMITED_ROW]]);
const byName = new Map([['OWNER', OWNER_ROW], ['STAFF', null]]);

const dbStub = {
  profile: {
    findUnique: async ({ where }) => {
      if (failNext) {
        const err = failNext;
        failNext = null;
        throw err;
      }
      if (where.id) return byId.get(where.id) ?? null;
      if (where.name) return byName.get(where.name) ?? null;
      return null;
    },
  },
};

require.cache[DB_PATH] = {
  id:         DB_PATH,
  filename:   DB_PATH,
  loaded:     true,
  exports:    dbStub,
};

const {
  effectiveAuthorization,
  requireScope,
  validateProfileTarget,
  SCOPES,
} = require('../src/services/authorization.service');

const mkRes = () => {
  const res = { statusCode: 0, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};
const delegated = () => { let called = false; const next = () => { called = true; }; next.called = () => called; return next; };

test('p2 resolver: profile_id overrides the role-named profile', async () => {
  const eff = await effectiveAuthorization({ id: 'u1', role: 'OWNER', profile_id: 'p-platform' });
  assert.strictEqual(eff.profile, 'PLATFORM_ADMIN');
  assert.strictEqual(eff.scope, 'GLOBAL');
  assert.strictEqual(eff.isSystemAuthority, false);
  assert.deepStrictEqual(
    eff.permissions.map((p) => p.permission).sort(),
    ['platform_admin:create', 'platform_admin:read', 'platform_user:read'].sort()
  );
  assert.ok(eff.permissions.every((p) => p.scope === 'GLOBAL'));
});

test('p2 resolver: NULL profile_id keeps the legacy OWNER/STAFF role fallback', async () => {
  const eff = await effectiveAuthorization({ id: 'u1', role: 'OWNER', profile_id: null });
  assert.strictEqual(eff.profile, 'OWNER');
  assert.strictEqual(eff.scope, 'SHOWROOM');
  assert.strictEqual(eff.isSystemAuthority, false);
  assert.ok(eff.permissions.some((p) => p.permission === 'user:create'));
});

test('p2 resolver: missing assigned profile fails closed (empty grants, no fallback)', async () => {
  const eff = await effectiveAuthorization({ id: 'u1', role: 'OWNER', profile_id: 'p-ghost' });
  assert.strictEqual(eff.profile, 'OWNER');
  assert.strictEqual(eff.scope, 'SHOWROOM');
  assert.deepStrictEqual(eff.permissions, []);
});

test('p2 resolver: SUPER_ADMIN short-circuits before any DB access (system authority)', async () => {
  failNext = new Error('must not touch the DB');
  const eff = await effectiveAuthorization({ id: 'sa', role: 'SUPER_ADMIN', profile_id: null });
  assert.strictEqual(eff.profile, 'SUPER_ADMIN');
  assert.strictEqual(eff.scope, 'GLOBAL');
  assert.strictEqual(eff.isSystemAuthority, true);
});

test('p2 resolver: DB failure fails closed', async () => {
  failNext = new Error('boom');
  const eff = await effectiveAuthorization({ id: 'u1', role: 'OWNER', profile_id: null });
  assert.deepStrictEqual(eff.permissions, []);
  assert.strictEqual(eff.scope, 'SHOWROOM');
});

test('p2 requireScope: SUPER_ADMIN passes (system authority, no DB)', async () => {
  const next = delegated();
  await requireScope(SCOPES.GLOBAL)({ user: { id: 'sa', role: 'SUPER_ADMIN' } }, mkRes(), next);
  assert.ok(next.called());
});

test('p2 requireScope: GLOBAL-scoped profile passes', async () => {
  const next = delegated();
  await requireScope(SCOPES.GLOBAL)({ user: { id: 'u1', role: 'OWNER', profile_id: 'p-platform' } }, mkRes(), next);
  assert.ok(next.called());
});

test('p2 requireScope: SHOWROOM-scoped actor is rejected with INSUFFICIENT_SCOPE', async () => {
  const res = mkRes();
  const next = delegated();
  await requireScope(SCOPES.GLOBAL)({ user: { id: 'u1', role: 'OWNER', profile_id: null } }, res, next);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.code, 'INSUFFICIENT_SCOPE');
  assert.ok(!next.called());
});

test('p2 requireScope: SHOWROOM-scoped assigned profile is rejected too', async () => {
  const res = mkRes();
  const next = delegated();
  await requireScope(SCOPES.GLOBAL)({ user: { id: 'u1', role: 'OWNER', profile_id: 'p-limited' } }, res, next);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.code, 'INSUFFICIENT_SCOPE');
  assert.ok(!next.called());
});

test('p2 requireScope: missing user → 401 AUTH_REQUIRED (fail closed)', async () => {
  const res = mkRes();
  const next = delegated();
  await requireScope(SCOPES.GLOBAL)({}, res, next);
  assert.strictEqual(res.statusCode, 401);
  assert.strictEqual(res.body.code, 'AUTH_REQUIRED');
  assert.ok(!next.called());
});

test('p2 requireScope: resolution failure fails CLOSED to deny (403 INSUFFICIENT_SCOPE)', async () => {
  failNext = new Error('boom');
  const res = mkRes();
  const next = delegated();
  await requireScope(SCOPES.GLOBAL)({ user: { id: 'u1', role: 'OWNER', profile_id: 'p-platform' } }, res, next);
  assert.strictEqual(res.statusCode, 403);
  assert.strictEqual(res.body.code, 'INSUFFICIENT_SCOPE');
  assert.ok(!next.called());
});

test('p2 validateProfileTarget: SUPER_ADMIN actor may define non-system profiles', async () => {
  const r = await validateProfileTarget({ id: 'sa', role: 'SUPER_ADMIN' }, PLATFORM_ROW);
  assert.strictEqual(r.allowed, true);
});

test('p2 validateProfileTarget: system profiles are protected', async () => {
  const r = await validateProfileTarget({ id: 'sa', role: 'SUPER_ADMIN' }, OWNER_ROW);
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, 'SYSTEM_PROFILE_PROTECTED');
});

test('p2 validateProfileTarget: missing target fails closed', async () => {
  const r = await validateProfileTarget({ id: 'sa', role: 'SUPER_ADMIN' }, null);
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, 'UNKNOWN_TARGET_PROFILE');
});

test('p2 validateProfileTarget: SUPER_ADMIN name is never a valid target', async () => {
  const r = await validateProfileTarget(
    { id: 'sa', role: 'SUPER_ADMIN' },
    { id: 'x', name: 'SUPER_ADMIN', scope: 'GLOBAL', is_system: false, permissions: [] }
  );
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, 'SUPER_ADMIN_IS_PROTECTED');
});

test('p2 validateProfileTarget: no privilege amplification for delegated actors', async () => {
  const actor = { id: 'u2', role: 'OWNER', profile_id: 'p-platform' };
  const r = await validateProfileTarget(actor, PLATFORM_ROW);
  assert.strictEqual(r.allowed, true, 'GLOBAL actor granting its own permissions is fine');
});

test('p2 validateProfileTarget: GLOBAL target by SHOWROOM actor → SCOPE_AMPLIFICATION', async () => {
  const actor = { id: 'u2', role: 'OWNER', profile_id: null };
  const r = await validateProfileTarget(actor, PLATFORM_ROW);
  assert.strictEqual(r.allowed, false);
  assert.strictEqual(r.reason, 'SCOPE_AMPLIFICATION');
});