'use strict';
// ============================================================
// Phase 4 — subscription/account lifecycle integration tests.
//
// Covers the self-service surface end to end against the real DB:
//   • POST   /auth/register-account  (showroom + OWNER + TRIAL claim)
//   • GET    /subscriptions/plans + /subscriptions/status
//   • POST   /subscriptions/request  (plan-derived amount, OWNER gated)
//   • PATCH  /subscriptions/payments/:id (proof attach)
//   • POST   /admin/payments/:id/approve | reject (canonical activation)
//   • ERP gate: TRIAL account → 403 ACCOUNT_PENDING on business routes
//   • runSubscriptionExpiryScan: TRIAL → EXPIRED flip at 0 days
//   • users_limit enforcement at user:create
// ============================================================
const test = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, PASSWORD, IDS } = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');
const notificationService = require('../../src/services/notification.service');

const EMAIL = 'trial-owner@test.local';
const DAY = 24 * 60 * 60 * 1000;

let base;
let trialToken;       // the freshly registered OWNER
let superToken;       // platform authority for approval/rejection
let planBasic, planPremium;

test.before(async () => {
  base = await startServer();
  await seedAll();
  superToken = await tokenFor(base, 'sa@test.local');

  planBasic = await db.plan.create({
    data: {
      id: 'plan-basic-test', name: 'باقة أساسية', code: 'BASIC',
      price_amount: 500, currency: 'EGP', duration_months: 1, users_limit: 2,
    },
  });
  planPremium = await db.plan.create({
    data: {
      id: 'plan-premium-test', name: 'باقة احترافية', code: 'PREMIUM',
      price_amount: 1500, currency: 'EGP', duration_months: 3, users_limit: 5,
    },
  });
});

test.after(async () => {
  await stopServer();
});

test('registerAccount: atomic bootstrap (showroom + OWNER + TRIAL claim)', async () => {
  const r = await api(base, 'POST', '/auth/register-account', {
    body: { name: 'Trial Owner', email: EMAIL, password: PASSWORD, showroom_name: 'Trial Showroom' },
  });

  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.data.account_status, 'PENDING');
  assert.strictEqual(r.body.data.owner.email, EMAIL);
  // Phase C.7: approved trial = exactly 5 days (backend authority).
  assert.strictEqual(r.body.data.trial.days, 5);

  const claim = await db.subscription.findFirst({
    where: { showroom_id: r.body.data.showroom.id },
  });
  assert.ok(claim, 'trial claim must exist');
  assert.strictEqual(claim.status, 'TRIAL');

  const owner = await db.user.findFirst({ where: { showroom_id: r.body.data.showroom.id, role: 'OWNER' } });
  assert.ok(owner, 'OWNER user must exist');
  assert.strictEqual(owner.is_active, true);

  const showroom = await db.showroom.findUnique({ where: { id: r.body.data.showroom.id } });
  assert.strictEqual(showroom.is_active, true);
  const days = Math.round((showroom.license_expiry - new Date()) / DAY);
  assert.ok(days >= 4 && days <= 5, `trial license_expiry ≈ 5 days, got ${days}`);
});

test('duplicate email registration is rejected (409 EMAIL_EXISTS)', async () => {
  const r = await api(base, 'POST', '/auth/register-account', {
    body: { name: 'Duplicate', email: EMAIL, password: PASSWORD },
  });
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.code, 'EMAIL_EXISTS');
});

test('trial owner can log in, but ERP business routes are gated (ACCOUNT_PENDING)', async () => {
  trialToken = await tokenFor(base, EMAIL);
  assert.ok(trialToken);

  const erp = await api(base, 'GET', '/customers', { token: trialToken });
  assert.strictEqual(erp.status, 403);
  assert.strictEqual(erp.body.code, 'ACCOUNT_PENDING');
});

test('trial owner reaches the self-service surface (plans + status)', async () => {
  const plans = await api(base, 'GET', '/subscriptions/plans', { token: trialToken });
  assert.strictEqual(plans.status, 200);
  assert.ok(Array.isArray(plans.body.data));
  const basic = plans.body.data.find((p) => p.code === 'BASIC');
  assert.ok(basic);
  assert.strictEqual(basic.price_amount, 500);

  const status = await api(base, 'GET', '/subscriptions/status', { token: trialToken });
  assert.strictEqual(status.status, 200);
  assert.strictEqual(status.body.data.account_status, 'PENDING');
  assert.strictEqual(status.body.data.subscription.status, 'TRIAL');
});

test('purchase request: plan-derived amount, OWNER-only, single pending', async () => {
  // Staff cannot request (ownerOnly gate)
  const staffToken = await tokenFor(base, 'staff-a@test.local');
  const denied = await api(base, 'POST', '/subscriptions/request', {
    token: staffToken, body: { plan_code: 'BASIC' },
  });
  assert.strictEqual(denied.status, 403);

  const r = await api(base, 'POST', '/subscriptions/request', {
    token: trialToken, body: { plan_code: 'PREMIUM', reference: 'REF-001' },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.data.price_amount, 1500); // server-side, not client input
  assert.strictEqual(r.body.data.subscription.status, 'PENDING_PAYMENT');

  const payment = await db.payment.findFirst({
    where: { showroom_id: r.body.data.subscription.showroom_id, status: 'PENDING' },
  });
  assert.ok(payment);
  assert.strictEqual(parseFloat(payment.amount), 1500);

  // Duplicate request while one is pending → 409
  const dup = await api(base, 'POST', '/subscriptions/request', {
    token: trialToken, body: { plan_code: 'BASIC' },
  });
  assert.strictEqual(dup.status, 409);
});

test('attach payment proof (PATCH /subscriptions/payments/:id)', async () => {
  const payment = await db.payment.findFirst({ where: { status: 'PENDING' }, orderBy: { created_at: 'desc' } });
  const r = await api(base, 'PATCH', `/subscriptions/payments/${payment.id}`, {
    token: trialToken,
    body: {
      proof_mime: 'image/png',
      proof_data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    },
  });
  assert.strictEqual(r.status, 200);

  const reloaded = await db.payment.findUnique({ where: { id: payment.id } });
  assert.strictEqual(reloaded.proof_mime, 'image/png');
});

test('admin approval activates the subscription (canonical path + notifications)', async () => {
  const payment = await db.payment.findFirst({ where: { status: 'PENDING' }, orderBy: { created_at: 'desc' } });
  const r = await api(base, 'POST', `/admin/payments/${payment.id}/approve`, {
    token: superToken, body: { reason: 'تحقق من التحويل' },
  });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.subscription.status, 'ACTIVE');

  const sub = await db.subscription.findUnique({ where: { id: r.body.data.subscription.id } });
  assert.strictEqual(sub.status, 'ACTIVE');
  assert.ok(sub.approved_at);
  const showroom = await db.showroom.findUnique({ where: { id: r.body.data.showroom_id } });
  assert.strictEqual(showroom.is_active, true);
  assert.ok(showroom.license_expiry > new Date(), 'license_expiry extended on activation');

  // Customer was notified (SUBSCRIPTION_ACTIVATED)
  const notif = await db.notification.findFirst({
    where: { showroom_id: r.body.data.showroom_id, type: 'SUBSCRIPTION_ACTIVATED' },
  });
  assert.ok(notif, 'activation notification must exist');

  // ERP access restored for the now-ACTIVE account — once the owner
  // completes onboarding (activation itself does not auto-onboard).
  await db.showroom.update({
    where: { id: r.body.data.showroom_id },
    data:  { is_onboarded: true },
  });
  const erp = await api(base, 'GET', '/customers', { token: trialToken });
  assert.strictEqual(erp.status, 200);

  const status = await api(base, 'GET', '/subscriptions/status', { token: trialToken });
  assert.strictEqual(status.body.data.account_status, 'ACTIVE');
});

test('users_limit is enforced at user:create (PLAN_LIMIT_REACHED)', async () => {
  // BASIC plan = users_limit 2; create a request for it, approve it,
  // then the limit must bite on the 3rd staff account.
  const limitPlan = await db.plan.create({
    data: { id: 'plan-limit-test', name: 'باقة محدودة', code: 'LIMIT_TEST', price_amount: 100, currency: 'EGP', duration_months: 1, users_limit: 2 },
  });
  const req = await api(base, 'POST', '/subscriptions/request', {
    token: trialToken, body: { plan_code: 'LIMIT_TEST' },
  });
  assert.strictEqual(req.status, 409, 'an ACTIVE subscription exists — renewal request blocked until lapsed');

  // Renewal path: force-lapse the ACTIVE claim, request again, approve.
  const showroomId = (await db.subscription.findFirst({ where: { status: 'ACTIVE' } })).showroom_id;
  await db.showroom.update({ where: { id: showroomId }, data: { license_expiry: new Date(Date.now() - 1 * DAY) } });
  await db.subscription.updateMany({ where: { showroom_id: showroomId, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });

  const req2 = await api(base, 'POST', '/subscriptions/request', {
    token: trialToken, body: { plan_code: 'LIMIT_TEST' },
  });
  assert.strictEqual(req2.status, 201);
  const p2 = await db.payment.findFirst({ where: { status: 'PENDING', showroom_id: showroomId }, orderBy: { created_at: 'desc' } });
  const approve = await api(base, 'POST', `/admin/payments/${p2.id}/approve`, { token: superToken });
  assert.strictEqual(approve.status, 200);

  // Owner counts toward the limit → only 1 more user fits in a limit of 2.
  const u1 = await api(base, 'POST', '/auth/register', {
    token: trialToken, body: { name: 'Staff One', email: 'staff-one@test.local', password: PASSWORD, role: 'STAFF' },
  });
  assert.strictEqual(u1.status, 201);

  const u2 = await api(base, 'POST', '/auth/register', {
    token: trialToken, body: { name: 'Staff Two', email: 'staff-two@test.local', password: PASSWORD, role: 'STAFF' },
  });
  assert.strictEqual(u2.status, 403);
  assert.strictEqual(u2.body.code, 'PLAN_LIMIT_REACHED');
});

test('admin rejection cancels the request and notifies the owner', async () => {
  // Lapse + re-request to get a fresh PENDING payment.
  const showroomId = (await db.subscription.findFirst({ where: { status: 'ACTIVE' } })).showroom_id;
  await db.showroom.update({ where: { id: showroomId }, data: { license_expiry: new Date(Date.now() - 1 * DAY) } });
  await db.subscription.updateMany({ where: { showroom_id: showroomId, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });

  const req = await api(base, 'POST', '/subscriptions/request', {
    token: trialToken, body: { plan_code: 'BASIC' },
  });
  assert.strictEqual(req.status, 201);
  const payment = await db.payment.findFirst({
    where: { showroom_id: showroomId, status: 'PENDING' }, orderBy: { created_at: 'desc' },
  });

  const r = await api(base, 'POST', `/admin/payments/${payment.id}/reject`, {
    token: superToken, body: { reason: 'مستند التحويل غير واضح' },
  });
  assert.strictEqual(r.status, 200);

  const sub = await db.subscription.findUnique({ where: { id: payment.subscription_id } });
  assert.strictEqual(sub.status, 'CANCELLED');
  const pay = await db.payment.findUnique({ where: { id: payment.id } });
  assert.strictEqual(pay.status, 'REJECTED');
  assert.strictEqual(pay.rejection_reason, 'مستند التحويل غير واضح');

  const notif = await db.notification.findFirst({ where: { showroom_id: showroomId, type: 'PAYMENT_REJECTED' } });
  assert.ok(notif, 'rejection notification must exist');
});

test('expiry scan flips TRIAL → EXPIRED at 0 days and warns 7/3/1', async () => {
  // Fresh registered account with an imminent claim.
  const r = await api(base, 'POST', '/auth/register-account', {
    body: { name: 'Short Trial', email: 'short-trial@test.local', password: PASSWORD, showroom_name: 'Short Showroom' },
  });
  const showroomId = r.body.data.showroom.id;
  const claim = await db.subscription.findFirst({ where: { showroom_id: showroomId } });
  const daysLeft = 4;
  await db.subscription.update({
    where: { id: claim.id },
    data: { expires_at: new Date(Date.now() + daysLeft * DAY) },
  });

  // 4 days left → applicable threshold 7 → notify, record 7.
  const s1 = await notificationService.runSubscriptionExpiryScan();
  const warned = await db.subscription.findUnique({ where: { id: claim.id } });
  assert.strictEqual(warned.expiry_notified_days, 7);
  assert.ok(await db.notification.findFirst({ where: { showroom_id: showroomId, type: 'SUBSCRIPTION_EXPIRING' } }));

  // At 0 days → flip TRIAL → EXPIRED + SUBSCRIPTION_EXPIRED notification.
  await db.subscription.update({ where: { id: claim.id }, data: { expires_at: new Date(Date.now() - DAY) } });
  const s2 = await notificationService.runSubscriptionExpiryScan();
  const flipped = await db.subscription.findUnique({ where: { id: claim.id } });
  assert.strictEqual(flipped.status, 'EXPIRED');
  assert.ok(await db.notification.findFirst({ where: { showroom_id: showroomId, type: 'SUBSCRIPTION_EXPIRED' } }));

  // Idempotent: a second run must not re-notify.
  const before = await db.notification.count({ where: { showroom_id: showroomId } });
  await notificationService.runSubscriptionExpiryScan();
  const after = await db.notification.count({ where: { showroom_id: showroomId } });
  assert.strictEqual(after, before);
  assert.ok(s1.expired === 0 && s2.expired >= 1);
});