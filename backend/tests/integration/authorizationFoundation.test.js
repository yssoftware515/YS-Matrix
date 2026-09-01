'use strict';
// Phase 1 (Authorization Foundation) — end-to-end authorization
// tests against the REAL test database, real Express app, real
// middleware. Requires the catalog to be seeded (fixtures.seedAll
// does that) and the authorization service to be the canonical
// decision path.
const test = require('node:test');
const assert = require('node:assert');
const express = require('express');
const http = require('http');

const { startServer, stopServer, api, db } = require('../helpers/harness');
const { seedAll, tokenFor, IDS } = require('../helpers/fixtures');
const { PERMISSIONS, PROFILE_DEFINITIONS } = require('../../src/services/permissionCatalog');
const { validateProfileAssignment } = require('../../src/services/authorization.service');
const { authenticate } = require('../../src/middleware/auth.middleware');
const { requirePermission } = require('../../src/middleware/roles.middleware');

let base;
let ownerA, staffA, sa;

const auditVisible = async (action, user_id, timeoutMs = 1500) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hit = await db.baseClient.auditLog.findFirst({
      where: { action, user_id },
      orderBy: { created_at: 'desc' },
    });
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
};

test.before(async () => {
  base = await startServer();
  await seedAll();
  ownerA = await tokenFor(base, 'owner-a@test.local');
  staffA = await tokenFor(base, 'staff-a@test.local');
  sa     = await tokenFor(base, 'sa@test.local');
});

test.after(async () => {
  await stopServer();
});

// ── 1. Catalog seeded into the DB matches the catalog source ──
test('authz: permission catalog is seeded and matches the source definition', async () => {
  const dbPerms = await db.baseClient.permission.count();
  assert.strictEqual(dbPerms, PERMISSIONS.length, 'permission rows must equal catalog');

  const profiles = await db.baseClient.profile.findMany({
    include: { permissions: { include: { permission: { select: { key: true } } } } },
  });
  const byName = Object.fromEntries(profiles.map((p) => [p.name, p]));

  for (const name of ['OWNER', 'STAFF']) {
    assert.ok(byName[name], `profile ${name} must exist`);
    assert.strictEqual(byName[name].scope, 'SHOWROOM');
    assert.strictEqual(byName[name].is_system, true, 'parity profiles are system-managed');

    const dbSet = byName[name].permissions
      .map((a) => `${a.scope}:${a.permission.key}`)
      .sort();
    const srcSet = PROFILE_DEFINITIONS[name].permissions
      .map((a) => `${a.scope}:${a.permission}`)
      .sort();
    assert.deepStrictEqual(dbSet, srcSet, `${name} profile must exactly match the catalog`);
  }
});

// ── 2. /auth/me effective authorization contract ────────────
test('authz: /auth/me exposes OWNER effective authorization (SHOWROOM scope)', async () => {
  const r = await api(base, 'GET', '/auth/me', { token: ownerA });
  assert.strictEqual(r.status, 200);
  const authz = r.body.data.authorization;
  assert.ok(authz, 'authorization block must be present');
  assert.strictEqual(authz.profile, 'OWNER');
  assert.strictEqual(authz.scope, 'SHOWROOM');

  const perms = authz.permissions.map((p) => `${p.scope}:${p.permission}`);
  assert.ok(perms.includes('SHOWROOM:sales:cancel'), 'OWNER must expose sales:cancel');
  assert.ok(perms.includes('SHOWROOM:customer:read'), 'OWNER must expose customer:read');
  assert.ok(perms.includes('SELF:profile:update'), 'OWNER must expose self-scoped profile:update');
  assert.ok(!perms.includes('SHOWROOM:doesnotexist:read'), 'no phantom permissions');
});

test('authz: /auth/me exposes STAFF effective authorization — owner-only absent', async () => {
  const r = await api(base, 'GET', '/auth/me', { token: staffA });
  assert.strictEqual(r.status, 200);
  const authz = r.body.data.authorization;
  assert.strictEqual(authz.profile, 'STAFF');
  assert.strictEqual(authz.scope, 'SHOWROOM');

  const perms = authz.permissions.map((p) => `${p.scope}:${p.permission}`);
  assert.ok(perms.includes('SHOWROOM:customer:create'), 'STAFF must expose customer:create');
  assert.ok(!perms.includes('SHOWROOM:sales:cancel'), 'STAFF must NOT expose sales:cancel');
  assert.ok(!perms.includes('SHOWROOM:activity:read'), 'STAFF must NOT expose activity:read');
});

test('authz: /auth/me — SUPER_ADMIN resolves as protected system authority (no data-driven list)', async () => {
  const r = await api(base, 'GET', '/auth/me', { token: sa });
  assert.strictEqual(r.status, 200);
  const authz = r.body.data.authorization;
  assert.strictEqual(authz.profile, 'SUPER_ADMIN');
  assert.strictEqual(authz.scope, 'GLOBAL');
  assert.deepStrictEqual(authz.permissions, [], 'system authority exposes no data-driven permission list');
});

// ── 3. requirePermission — the canonical permission gate ─────
async function withPermissionApp() {
  const app = express();
  app.get('/needs-customer-create', authenticate, requirePermission('customer:create'), (req, res) => res.json({ ok: true }));
  app.get('/needs-sales-cancel',    authenticate, requirePermission('sales:cancel'),    (req, res) => res.json({ ok: true }));
  app.get('/needs-self-profile',    authenticate, requirePermission('profile:update', 'SELF'), (req, res) => res.json({ ok: true }));
  app.get('/needs-unknown',         authenticate, requirePermission('missing:permission'), (req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { server, url };
}

const call = async (url, path, token) => {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${url}${path}`, { headers });
  let body = null;
  try { body = await res.json(); } catch { /* no body */ }
  return { status: res.status, body };
};

test('authz: requirePermission grants + denies exactly per effective permissions', async () => {
  const { server, url } = await withPermissionApp();
  try {
    const staffCreate = await call(url, '/needs-customer-create', staffA);
    assert.strictEqual(staffCreate.status, 200, 'STAFF holds customer:create');

    const staffCancel = await call(url, '/needs-sales-cancel', staffA);
    assert.strictEqual(staffCancel.status, 403, 'STAFF denied sales:cancel');
    assert.strictEqual(staffCancel.body.code, 'INSUFFICIENT_PERMISSION');

    const ownerCancel = await call(url, '/needs-sales-cancel', ownerA);
    assert.strictEqual(ownerCancel.status, 200, 'OWNER holds sales:cancel');

    const selfProfile = await call(url, '/needs-self-profile', staffA);
    assert.strictEqual(selfProfile.status, 200, 'SELF-scope grant resolves');

    const unknown = await call(url, '/needs-unknown', ownerA);
    assert.strictEqual(unknown.status, 403, 'unknown permission fails closed');

    const saBypass = await call(url, '/needs-sales-cancel', sa);
    assert.strictEqual(saBypass.status, 200, 'SUPER_ADMIN system authority bypasses');

    const anon = await call(url, '/needs-customer-create', null);
    assert.strictEqual(anon.status, 401, 'unauthenticated → AUTH_REQUIRED');
  } finally {
    server.close();
  }
});

// ── 4. Grant path — SUPER_ADMIN assigns a profile (grant success) ──
test('authz: SUPER_ADMIN role assignment succeeds and the new profile takes effect', async () => {
  const r = await api(base, 'PATCH', `/superadmin/users/${IDS.staffA}`, {
    token: sa,
    body:  { role: 'OWNER' },
  });
  assert.strictEqual(r.status, 200, `role assignment: ${JSON.stringify(r.body)}`);
  assert.strictEqual(r.body.data.role, 'OWNER');

  const profileEvt = await auditVisible('AUTHZ_PROFILE_ASSIGNED', IDS.sa);
  assert.ok(profileEvt, 'AUTHZ_PROFILE_ASSIGNED audit event must be written');
  assert.strictEqual(profileEvt.entity_id, IDS.staffA);
  assert.strictEqual(profileEvt.old_data.profile, 'STAFF');
  assert.strictEqual(profileEvt.new_data.profile, 'OWNER');

  const newToken = await tokenFor(base, 'staff-a@test.local');
  const me = await api(base, 'GET', '/auth/me', { token: newToken });
  assert.strictEqual(me.body.data.authorization.profile, 'OWNER', 'identity re-resolved from DB → new profile');

  const cancel = await api(base, 'PATCH', `/sales/${IDS.saleCashA}/cancel`, { token: newToken });
  assert.strictEqual(cancel.status, 200, 'new OWNER can now perform owner-only action (parity preserved)');
});

// ── 5. SUPER_ADMIN non-delegability + assignment gate ────────
test('authz: SUPER_ADMIN is non-delegable — every API surface rejects the target role', async () => {
  // PATCH /superadmin/users/:id — schema-level rejection
  const patch = await api(base, 'PATCH', `/superadmin/users/${IDS.staffA}`, {
    token: sa,
    body:  { role: 'SUPER_ADMIN' },
  });
  assert.strictEqual(patch.status, 400, 'superAdminUpdateUserSchema must reject SUPER_ADMIN');

  // POST /auth/register — schema-level rejection (also controller-guarded)
  const register = await api(base, 'POST', '/auth/register', {
    token: sa,
    body:  { name: 'Fake SA', email: 'fake-sa@test.local', password: 'Phase0#Test2026!', role: 'SUPER_ADMIN' },
  });
  assert.strictEqual(register.status, 400, 'registerSchema must reject SUPER_ADMIN');

  const still = await db.baseClient.user.findUnique({ where: { id: IDS.staffA } });
  assert.strictEqual(still.role, 'OWNER', 'role must remain the previously assigned OWNER (no partial change)');
});

test('authz: validateProfileAssignment — the server-side no-amplification gate', async () => {
  const ownerActor = { id: IDS.ownerA, email: 'owner-a@test.local', role: 'OWNER' };
  const saActor    = { id: IDS.sa,     email: 'sa@test.local',     role: 'SUPER_ADMIN' };

  // System authority may assign parity profiles — but never SUPER_ADMIN
  const saOk = await validateProfileAssignment(saActor, 'STAFF');
  assert.strictEqual(saOk.allowed, true, 'SA can assign STAFF');
  const saDenied = await validateProfileAssignment(saActor, 'SUPER_ADMIN');
  assert.strictEqual(saDenied.allowed, false);
  assert.strictEqual(saDenied.reason, 'SUPER_ADMIN_IS_PROTECTED', 'SA cannot assign SUPER_ADMIN');

  // OWNER can assign STAFF (parity register path — STAFF ⊆ OWNER, scope SHOWROOM ⊆ SHOWROOM)
  const ownerToStaff = await validateProfileAssignment(ownerActor, 'STAFF');
  assert.strictEqual(ownerToStaff.allowed, true, 'OWNER can assign STAFF');

  // Unassignable targets fail closed
  const ownerToSa = await validateProfileAssignment(ownerActor, 'SUPER_ADMIN');
  assert.strictEqual(ownerToSa.allowed, false);
  assert.strictEqual(ownerToSa.reason, 'SUPER_ADMIN_IS_PROTECTED');

  const unknown = await validateProfileAssignment(ownerActor, 'CLIENT');
  assert.strictEqual(unknown.allowed, false);
  assert.strictEqual(unknown.reason, 'UNKNOWN_TARGET_PROFILE', 'unknown profile fails closed');

  const noActor = await validateProfileAssignment(null, 'STAFF');
  assert.strictEqual(noActor.allowed, false);
  assert.strictEqual(noActor.reason, 'ACTOR_MISSING');
});

test('authz: register cannot create OWNER accounts via a non-SUPER_ADMIN (legacy parity)', async () => {
  const r = await api(base, 'POST', '/auth/register', {
    token: ownerA,
    body:  { name: 'Rogue Owner', email: 'rogue-owner@test.local', password: 'Phase0#Test2026!', role: 'OWNER' },
  });
  assert.strictEqual(r.status, 403, 'OWNER must not create OWNER (legacy parity — authentication guard)');

  const created = await db.baseClient.user.findUnique({ where: { email: 'rogue-owner@test.local' } });
  assert.strictEqual(created, null, 'no user row may be created');
});

// ── 6. Unauthorized profile modification rejection ──────────
test('authz: unauthorized surface access fails closed (STAFF → superadmin/users)', async () => {
  const r = await api(base, 'PATCH', `/superadmin/users/${IDS.ownerA}`, {
    token: staffA,
    body:  { role: 'OWNER' },
  });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'INSUFFICIENT_ROLE');
});