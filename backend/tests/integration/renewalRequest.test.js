'use strict';
// ============================================================
// F2 — Renewal / Upgrade Request (Customer Self-Service
// Completion). Verifies against the real DB:
//   • an ACTIVE subscription does NOT block a renewal request
//   • pricing is server-side (plan row), never client input
//   • one pending claim at a time (409 on duplicate)
//   • OWNER-only, unauthenticated → 401, STAFF → 403
//   • approval goes through the canonical activation path and
//     EXTENDS from the current ACTIVE period (no lost days)
//   • expired accounts can still submit renewals (F1 surface)
//   • upgrade swaps the plan snapshot
// ============================================================

const test   = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, PASSWORD, IDS , unlockAll} = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');

const DAY = 24 * 60 * 60 * 1000;

let base;
let superToken, ownerAToken, ownerBToken, staffBToken, ownerEToken;

const PLAN_STANDARD = { id: 'plan-rev-standard', name: 'الباقة القياسية', code: 'STANDARD-RENEW', price_amount: 500, currency: 'EGP', duration_months: 1, users_limit: 5 };
const PLAN_PREMIUM  = { id: 'plan-rev-premium',  name: 'الباقة الاحترافية', code: 'PREMIUM-RENEW', price_amount: 900, currency: 'EGP', duration_months: 3, users_limit: 10 };

test.before(async () => {
  base = await startServer();
  await seedAll();

  superToken  = await tokenFor(base, 'sa@test.local');
  ownerAToken = await tokenFor(base, 'owner-a@test.local');
  ownerBToken = await tokenFor(base, 'owner-b@test.local');
  staffBToken = await tokenFor(base, 'staff-b@test.local');
  ownerEToken = await tokenFor(base, 'owner-e@test.local');

  await db.plan.createMany({ data: [PLAN_STANDARD, PLAN_PREMIUM] });

  // Showroom A is ACTIVE with a future expiry — the renewal baseline.
  await db.subscription.create({
    data: {
      id: 'sub-rev-active',
      showroom_id: IDS.showroomA,
      plan_name:   PLAN_STANDARD.name,
      status:      'ACTIVE',
      started_at:  new Date(),
      expires_at:  new Date(Date.now() + 30 * DAY),
      duration_months: 1,
    },
  });
});

test.after(async () => {
  await unlockAll();
  await stopServer();
});

const renew = (token, body = {}) =>
  api(base, 'POST', '/subscriptions/renew-request', { token, body });

test('F2: renewal while ACTIVE → 201, pending claim + payment, ACTIVE untouched', async () => {
  const r = await renew(ownerAToken, { plan_code: PLAN_STANDARD.code });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.data.subscription.status, 'PENDING_PAYMENT');
  assert.strictEqual(r.body.data.payment.status, 'PENDING');
  // Server-side pricing — the client never sends an amount.
  assert.strictEqual(r.body.data.price_amount, PLAN_STANDARD.price_amount);
  assert.strictEqual(r.body.data.currency, PLAN_STANDARD.currency);
  assert.strictEqual(r.body.data.subscription.notes, 'طلب تجديد / ترقية الاشتراك');

  const active = await db.subscription.findUnique({ where: { id: 'sub-rev-active' } });
  assert.strictEqual(active.status, 'ACTIVE', 'existing ACTIVE row must be untouched by a renewal request');
});

test('F2: duplicate renewal while a claim is pending → 409', async () => {
  const r = await renew(ownerAToken, { plan_code: PLAN_STANDARD.code });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.code, 'ACCOUNT_STATE_CONFLICT');
});

test('F2: STAFF → 403 INSUFFICIENT_ROLE', async () => {
  const r = await renew(staffBToken, { plan_code: PLAN_STANDARD.code });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'INSUFFICIENT_ROLE');
});

test('F2: unauthenticated → 401', async () => {
  const r = await renew(undefined, { plan_code: PLAN_STANDARD.code });
  assert.strictEqual(r.status, 401);
});

test('F2: unknown/inactive plan → 404 NOT_FOUND', async () => {
  const r = await renew(ownerBToken, { plan_code: 'NO-SUCH-PLAN' });
  assert.strictEqual(r.status, 404);
});

test('F2: approval extends from the current ACTIVE period (no lost days)', async () => {
  const claim = await db.subscription.findFirst({
    where: { showroom_id: IDS.showroomA, status: 'PENDING_PAYMENT' },
    orderBy: { created_at: 'desc' },
  });
  const payment = await db.payment.findFirst({
    where: { subscription_id: claim.id },
    orderBy: { created_at: 'desc' },
  });

  const r = await api(base, 'POST', `/admin/payments/${payment.id}/approve`, {
    token: superToken,
    body:  { reason: 'F2 renewal approval' },
  });
  assert.strictEqual(r.status, 200);

  const baseExpiry = new Date(Date.now() + 30 * DAY);
  const expected   = new Date(baseExpiry);
  expected.setMonth(expected.getMonth() + PLAN_STANDARD.duration_months);

  const activated = await db.subscription.findUnique({ where: { id: claim.id } });
  assert.strictEqual(activated.status, 'ACTIVE');
  const got = new Date(activated.expires_at).getTime();
  assert.ok(Math.abs(got - expected.getTime()) < 5 * 60 * 1000,
    `expiry must extend from old ACTIVE expiry (got ${new Date(got).toISOString()}, expected ~${expected.toISOString()})`);

  const showroom = await db.showroom.findUnique({ where: { id: IDS.showroomA } });
  assert.ok(new Date(showroom.license_expiry).getTime() > new Date(baseExpiry).getTime(), 'license_expiry must be extended');

  const audit = await db.auditLog.findFirst({
    where: { action: 'SUBSCRIPTION_RENEWAL_REQUESTED', entity_id: claim.id },
  });
  assert.ok(audit, 'SUBSCRIPTION_RENEWAL_REQUESTED audit must exist');
  assert.strictEqual(audit.showroom_id, IDS.showroomA);
});

test('F2: upgrade after activation — new plan snapshot, server pricing', async () => {
  const r = await renew(ownerAToken, { plan_code: PLAN_PREMIUM.code });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.data.price_amount, PLAN_PREMIUM.price_amount);
  assert.strictEqual(r.body.data.subscription.plan_name, PLAN_PREMIUM.name);
  assert.strictEqual(r.body.data.subscription.duration_months, PLAN_PREMIUM.duration_months);
  assert.strictEqual(r.body.data.subscription.users_limit, PLAN_PREMIUM.users_limit);
});

test('F2: expired account (F1 scope) can still submit a renewal request', async () => {
  const r = await renew(ownerEToken, { plan_code: PLAN_STANDARD.code });
  assert.strictEqual(r.status, 201, 'self-service surface must stay open for expired accounts');
  const status = await api(base, 'GET', '/subscriptions/status', { token: ownerEToken });
  assert.strictEqual(status.status, 200);
  assert.strictEqual(status.body.data.account_status, 'PENDING_PAYMENT', 'expired account with a renewal claim derives PENDING_PAYMENT');
});

test('F2: renewals never leak across tenants — B claim lives under B', async () => {
  const beforeB = await db.subscription.count({ where: { showroom_id: IDS.showroomB, status: 'PENDING_PAYMENT' } });
  const beforeA = await db.subscription.count({ where: { showroom_id: IDS.showroomA, status: 'PENDING_PAYMENT' } });
  const r = await renew(ownerBToken, { plan_code: PLAN_STANDARD.code });
  assert.strictEqual(r.status, 201);
  const afterB = await db.subscription.count({ where: { showroom_id: IDS.showroomB, status: 'PENDING_PAYMENT' } });
  assert.strictEqual(afterB, beforeB + 1);
  assert.strictEqual(r.body.data.subscription.showroom_id, IDS.showroomB);
  const afterA = await db.subscription.count({ where: { showroom_id: IDS.showroomA, status: 'PENDING_PAYMENT' } });
  assert.strictEqual(afterA, beforeA, 'showroom A must gain no claim from B\'s renewal');
});
