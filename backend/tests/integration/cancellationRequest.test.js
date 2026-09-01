'use strict';
// ============================================================
// F3 — Pending-Request Cancellation (Customer Self-Service
// Completion). Verifies against the real DB:
//   • DELETE /subscriptions/request cancels the pending claim
//     atomically (subscription → CANCELLED, payment → EXPIRED)
//   • 409 when nothing is pending (idempotent contract)
//   • OWNER-only; STAFF → 403; unauthenticated → 401
//   • tenant isolation — B cannot cancel A's claim
//   • the 72h auto-expiry scan cancels stale claims via the SAME
//     canonical path and fires a SYSTEM notification + audit
// ============================================================

const test   = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, IDS } = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');
const lifecycleService = require('../../src/services/subscription.lifecycle.service');

const DAY = 24 * 60 * 60 * 1000;
const PLAN = { id: 'plan-cxl-standard', name: 'الباقة القياسية', code: 'STANDARD-CXL', price_amount: 500, currency: 'EGP', duration_months: 1, users_limit: 5 };

let base;
let ownerAToken, ownerBToken, staffBToken;

test.before(async () => {
  base = await startServer();
  await seedAll();

  ownerAToken = await tokenFor(base, 'owner-a@test.local');
  ownerBToken = await tokenFor(base, 'owner-b@test.local');
  staffBToken = await tokenFor(base, 'staff-b@test.local');

  await db.plan.create({ data: PLAN });
});

test.after(async () => {
  await stopServer();
});

const cancel = (token) => api(base, 'DELETE', '/subscriptions/request', { token });

test('F3: OWNER cancels the pending claim → subscription CANCELLED + payment EXPIRED', async () => {
  const req = await api(base, 'POST', '/subscriptions/request', {
    token: ownerAToken,
    body:  { plan_code: PLAN.code },
  });
  assert.strictEqual(req.status, 201);

  const r = await cancel(ownerAToken);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.cancelled_subscriptions, 1);
  assert.strictEqual(r.body.data.expired_payments, 1);
  assert.strictEqual(r.body.data.showroom_id, IDS.showroomA);

  const sub = await db.subscription.findUnique({ where: { id: req.body.data.subscription.id } });
  assert.strictEqual(sub.status, 'CANCELLED');
  assert.ok(sub.notes.includes('أُلغي'), 'cancellation reason must be recorded');

  const payment = await db.payment.findUnique({ where: { id: req.body.data.payment.id } });
  assert.strictEqual(payment.status, 'EXPIRED', 'PENDING payment must move to EXPIRED (no CANCELLED status)');
  assert.strictEqual(payment.reviewed_by, 'u-oa', 'owner cancellation records the actor');

  const audit = await db.auditLog.findFirst({
    where: { action: 'SUBSCRIPTION_REQUEST_CANCELLED', showroom_id: IDS.showroomA },
    orderBy: { created_at: 'desc' },
  });
  assert.ok(audit, 'SUBSCRIPTION_REQUEST_CANCELLED audit must exist');
  assert.strictEqual(audit.user_id, 'u-oa');
});

test('F3: cancelling again (nothing pending) → 409 (idempotent contract)', async () => {
  const r = await cancel(ownerAToken);
  assert.strictEqual(r.status, 409);
  assert.strictEqual(r.body.code, 'ACCOUNT_STATE_CONFLICT');
});

test('F3: cancel keeps an ACTIVE account ACTIVE (cancelled rows are non-actionable)', async () => {
  // Give showroom A a real ACTIVE subscription (the underlying plan),
  // then a renewal claim, then cancel it — the derived status must
  // fall back to ACTIVE, never EXPIRED.
  await db.subscription.create({
    data: {
      id: 'sub-cxl-active',
      showroom_id: IDS.showroomA,
      plan_name:   PLAN.name,
      status:      'ACTIVE',
      started_at:  new Date(),
      expires_at:  new Date(Date.now() + 30 * DAY),
      duration_months: 1,
    },
  });

  await api(base, 'POST', '/subscriptions/renew-request', {
    token: ownerAToken,
    body:  { plan_code: PLAN.code },
  });

  const cancelled = await cancel(ownerAToken);
  assert.strictEqual(cancelled.status, 200);

  const status = await api(base, 'GET', '/subscriptions/status', { token: ownerAToken });
  assert.strictEqual(status.status, 200);
  assert.strictEqual(status.body.data.account_status, 'ACTIVE', 'cancelling a renewal must not downgrade an active account');
  assert.strictEqual(status.body.data.subscription.status, 'ACTIVE');
});

test('F3: STAFF → 403 INSUFFICIENT_ROLE', async () => {
  const r = await cancel(staffBToken);
  assert.strictEqual(r.status, 403);
});

test('F3: unauthenticated → 401', async () => {
  const r = await cancel(undefined);
  assert.strictEqual(r.status, 401);
});

test('F3: cross-tenant — B cannot cancel A\u2019s claim (tenant-scoped 409, no leak)', async () => {
  // A submits a fresh RENEWAL claim (A is ACTIVE — first-purchase /request would conflict).
  await api(base, 'POST', '/subscriptions/renew-request', {
    token: ownerAToken,
    body:  { plan_code: PLAN.code },
  });

  // B has no pending claim of their own → 409. Crucially B can never
  // address A's claim: the route is tenant-scoped by tenantGuard.
  const r = await cancel(ownerBToken);
  assert.strictEqual(r.status, 409);

  // A's claim is still pending — untouched by B's attempt.
  const pending = await db.subscription.count({ where: { showroom_id: IDS.showroomA, status: 'PENDING_PAYMENT' } });
  assert.strictEqual(pending, 1);
  const bCancelled = await db.subscription.count({ where: { showroom_id: IDS.showroomB, status: 'CANCELLED' } });
  assert.strictEqual(bCancelled, 0);
});

test('F3: 72h auto-expiry scan cancels stale claims + SYSTEM notification + audit', async () => {
  // Seed a claim that is 72h+ old, plus a fresh one that must survive.
  const stale = await api(base, 'POST', '/subscriptions/request', {
    token: ownerBToken,
    body:  { plan_code: PLAN.code },
  });
  const staleId = stale.body.data.subscription.id;
  await db.subscription.update({
    where: { id: staleId },
    data:  { created_at: new Date(Date.now() - 4 * DAY) },
  });

  const result = await lifecycleService.runStaleRequestExpiryScan({ olderThanMs: 72 * 60 * 60 * 1000 });
  assert.ok(result.cancelled >= 1, 'stale claim must be cancelled by the scan');

  const flipped = await db.subscription.findUnique({ where: { id: staleId } });
  assert.strictEqual(flipped.status, 'CANCELLED');
  assert.ok(flipped.notes.includes('72'), 'cron cancellation records the 72h reason');

  const notif = await db.notification.findFirst({
    where: { showroom_id: IDS.showroomB, type: 'SYSTEM' },
    orderBy: { created_at: 'desc' },
  });
  assert.ok(notif, 'SYSTEM notification must fire for the auto-cancelled claim');
  assert.ok(notif.body.includes(PLAN.name));

  const audit = await db.auditLog.findFirst({
    where: { action: 'SUBSCRIPTION_REQUEST_CANCELLED', entity_id: staleId },
  });
  assert.ok(audit, 'cron cancellation must be audited');
  assert.strictEqual(audit.user_id, null, 'scheduled job has no actor');
  assert.strictEqual(audit.new_data.reason, 'STALE_REQUEST_72H');
});

test('F3: scan is idempotent — a second run cancels nothing', async () => {
  const before = await db.subscription.count({ where: { status: 'CANCELLED' } });
  const result = await lifecycleService.runStaleRequestExpiryScan({ olderThanMs: 72 * 60 * 60 * 1000 });
  assert.strictEqual(result.cancelled, 0, 'already-cancelled claims must not be re-processed');
  const after = await db.subscription.count({ where: { status: 'CANCELLED' } });
  assert.strictEqual(after, before);
});

test('F3: scan skips claims approved meanwhile (CONFLICT-safe)', async () => {
  // Create a claim older than 72h, then flip it to ACTIVE (as an admin
  // approval would) — the scan must leave it alone.
  const req = await api(base, 'POST', '/subscriptions/request', {
    token: ownerBToken,
    body:  { plan_code: PLAN.code },
  });
  const subId = req.body.data.subscription.id;
  await db.subscription.update({
    where: { id: subId },
    data:  { created_at: new Date(Date.now() - 4 * DAY), status: 'ACTIVE', started_at: new Date(), expires_at: new Date(Date.now() + 30 * DAY) },
  });
  const payment = await db.payment.findFirst({ where: { subscription_id: subId } });
  await db.payment.update({ where: { id: payment.id }, data: { status: 'PAID' } });

  const result = await lifecycleService.runStaleRequestExpiryScan({ olderThanMs: 72 * 60 * 60 * 1000 });
  assert.strictEqual(result.cancelled, 0);

  const alive = await db.subscription.findUnique({ where: { id: subId } });
  assert.strictEqual(alive.status, 'ACTIVE', 'an approved claim must never be cancelled by the scan');
});
