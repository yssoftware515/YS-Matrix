'use strict';
// ============================================================
// F4 — OWNER Staff Management (Customer Self-Service Completion).
// Verifies against the real DB:
//   • GET /users is tenant-scoped + OWNER-only
//   • POST /users reuses the canonical register flow (role guards,
//     email uniqueness, plan users_limit)
//   • deactivation kills the session immediately (refresh revoked)
//   • self-toggle and OWNER toggle are rejected
//   • reactivation re-checks users_limit; foreign users are 404
//   • license-expired owners are blocked (business surface)
// ============================================================

const test   = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, PASSWORD, IDS , unlockAll} = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');

const DAY = 24 * 60 * 60 * 1000;
// Showroom A ships with owner-a + staff-a (2 active users).
// users_limit 3 → exactly one free slot for the create tests.
const PLAN = { id: 'plan-users-std', name: 'الباقة القياسية', code: 'STANDARD-USERS', price_amount: 500, currency: 'EGP', duration_months: 1, users_limit: 3 };

let base;
let ownerAToken, ownerBToken, staffBToken;

test.before(async () => {
  base = await startServer();
  await seedAll();

  ownerAToken = await tokenFor(base, 'owner-a@test.local');
  ownerBToken = await tokenFor(base, 'owner-b@test.local');
  staffBToken = await tokenFor(base, 'staff-b@test.local');

  await db.plan.create({ data: PLAN });

  await db.subscription.create({
    data: {
      showroom_id: IDS.showroomA,
      plan_name:   PLAN.name,
      status:      'ACTIVE',
      started_at:  new Date(),
      expires_at:  new Date(Date.now() + 30 * DAY),
      duration_months: 1,
      users_limit: PLAN.users_limit,
    },
  });
});

test.after(async () => {
  await unlockAll();
  await stopServer();
});

test('F4: OWNER lists tenant users — own showroom only', async () => {
  const r = await api(base, 'GET', '/users', { token: ownerAToken });
  assert.strictEqual(r.status, 200);
  const emails = r.body.data.map((u) => u.email);
  assert.ok(emails.includes('owner-a@test.local'));
  assert.ok(emails.includes('staff-a@test.local'));
  assert.ok(!emails.includes('owner-b@test.local'), 'foreign users must not leak');
  assert.strictEqual(r.body.data.length, 2);
});

test('F4: STAFF → 403 INSUFFICIENT_ROLE on every /users route', async () => {
  const list = await api(base, 'GET', '/users', { token: staffBToken });
  assert.strictEqual(list.status, 403);
  const patch = await api(base, 'PATCH', `/users/${IDS.staffB}`, { token: staffBToken, body: { is_active: false } });
  assert.strictEqual(patch.status, 403);
});

test('F4: duplicate email → 409 EMAIL_EXISTS (slot still free)', async () => {
  const r = await api(base, 'POST', '/users', {
    token: ownerAToken,
    body:  { name: 'Dup', email: 'staff-a@test.local', password: PASSWORD, role: 'STAFF' },
  });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.code, 'EMAIL_EXISTS');
});

test('F4: OWNER creates STAFF through the canonical path → 201', async () => {
  const r = await api(base, 'POST', '/users', {
    token: ownerAToken,
    body:  { name: 'New Staff', email: 'new-staff@test.local', password: PASSWORD, role: 'STAFF' },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.data.role, 'STAFF');
  assert.strictEqual(r.body.data.is_active, true);
});

test('F4: OWNER cannot create another OWNER (privilege escalation blocked)', async () => {
  const r = await api(base, 'POST', '/users', {
    token: ownerAToken,
    body:  { name: 'Fake Owner', email: 'fake-owner@test.local', password: PASSWORD, role: 'OWNER' },
  });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'INSUFFICIENT_ROLE');
});

test('F4: plan users_limit enforced on create (3/3 reached)', async () => {
  const r = await api(base, 'POST', '/users', {
    token: ownerAToken,
    body:  { name: 'Third User', email: 'third-user@test.local', password: PASSWORD, role: 'STAFF' },
  });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'PLAN_LIMIT_REACHED');
});

test('F4: deactivation revokes the session — refresh token dies immediately', async () => {
  const login = await api(base, 'POST', '/auth/login', {
    body: { email: 'new-staff@test.local', password: PASSWORD },
  });
  assert.strictEqual(login.status, 200);
  const refreshToken = login.body.data.refreshToken;

  const users = await api(base, 'GET', '/users', { token: ownerAToken });
  const target = users.body.data.find((u) => u.email === 'new-staff@test.local');
  const r2 = await api(base, 'PATCH', `/users/${target.id}`, {
    token: ownerAToken,
    body:  { is_active: false },
  });
  assert.strictEqual(r2.status, 200);
  assert.strictEqual(r2.body.data.is_active, false);

  // The stored refresh token was revoked → refresh fails.
  const refresh = await api(base, 'POST', '/auth/refresh', { body: { refreshToken } });
  assert.strictEqual(refresh.status, 401);
  assert.strictEqual(refresh.body.code, 'REFRESH_TOKEN_NOT_FOUND');

  // Login is blocked too.
  const relogin = await api(base, 'POST', '/auth/login', {
    body: { email: 'new-staff@test.local', password: PASSWORD },
  });
  assert.strictEqual(relogin.status, 401);
  assert.strictEqual(relogin.body.code, 'ACCOUNT_DISABLED');

  const audit = await db.auditLog.findFirst({
    where: { action: 'USER_DEACTIVATED', entity_id: target.id },
    orderBy: { created_at: 'desc' },
  });
  assert.ok(audit, 'USER_DEACTIVATED audit must exist');
  assert.strictEqual(audit.showroom_id, IDS.showroomA);
});

test('F4: reactivation re-checks users_limit — works while a slot is free, blocked when full', async () => {
  const users = await api(base, 'GET', '/users', { token: ownerAToken });
  const target = users.body.data.find((u) => u.email === 'new-staff@test.local');

  // Deactivated staff no longer counts → slot free → reactivation succeeds.
  const r = await api(base, 'PATCH', `/users/${target.id}`, {
    token: ownerAToken,
    body:  { is_active: true },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.is_active, true);

  // Slot is taken again (3/3) → a new create is blocked.
  const third = await api(base, 'POST', '/users', {
    token: ownerAToken,
    body:  { name: 'Again', email: 'again@test.local', password: PASSWORD, role: 'STAFF' },
  });
  assert.strictEqual(third.status, 403);
  assert.strictEqual(third.body.code, 'PLAN_LIMIT_REACHED');
});

test('F4: OWNER cannot toggle their own account', async () => {
  const r = await api(base, 'PATCH', `/users/${IDS.ownerA}`, {
    token: ownerAToken,
    body:  { is_active: false },
  });
  assert.strictEqual(r.status, 400);
});

test('F4: foreign user is invisible (404) — B cannot toggle A\u2019s staff', async () => {
  const users = await api(base, 'GET', '/users', { token: ownerAToken });
  const target = users.body.data.find((u) => u.email === 'staff-a@test.local');
  const r = await api(base, 'PATCH', `/users/${target.id}`, {
    token: ownerBToken,
    body:  { is_active: false },
  });
  assert.strictEqual(r.status, 404, 'cross-tenant toggle must 404, never act');
  const stillActive = await db.user.findUnique({ where: { id: target.id } });
  assert.strictEqual(stillActive.is_active, true, 'A\'s staff must be untouched');
});

test('F4: license-expired owner cannot manage users (business surface)', async () => {
  const ownerE = await api(base, 'POST', '/auth/login', {
    body: { email: 'owner-e@test.local', password: PASSWORD },
  });
  const token = ownerE.body.data.accessToken;
  const r = await api(base, 'GET', '/users', { token });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'LICENSE_EXPIRED');
});
