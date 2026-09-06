'use strict';
// ============================================================
// Phase B.1 — Billing & Subscription Experience. Regression
// coverage for the customer-visible billing surface:
//   • F9 — role-gated payment history: the transfer `reference`
//     (evidence) is OWNER/platform-only in the history list too
//     (previously the list leaked it to STAFF while /status did
//     not); rejection_reason (customer-facing copy) stays visible
//     to the whole showroom team
//   • F2 — rejected-payment recovery: the customer can read the
//     reviewer's reason from /status (latest_payment) and re-submit
//     a FRESH request without support
//   • F5 — renewal while ACTIVE: a renewal claim derives the
//     account to PENDING_PAYMENT (one claim at a time), the plan
//     keeps working, and cancelling the claim derives back to
//     ACTIVE (F3 — the dashboard never lies about the plan)
//   • F9 — STAFF can never trigger OWNER mutations (server is the
//     authority; the frontend only presents)
// ============================================================
const test = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, PASSWORD, IDS , unlockAll} = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');

const PLAN_ID = 'plan-b1-standard';
const REASON = 'المبلغ المحوّل لا يطابق قيمة الباقة';

let base;
let superToken, ownerAToken, staffAToken;

test.before(async () => {
  base = await startServer();
  await seedAll();

  superToken  = await tokenFor(base, 'sa@test.local');
  ownerAToken = await tokenFor(base, 'owner-a@test.local');
  staffAToken = await tokenFor(base, 'staff-a@test.local');

  await db.plan.create({
    data: {
      id: PLAN_ID, name: 'الباقة القياسية', code: 'STANDARD',
      price_amount: 500, currency: 'EGP', duration_months: 1, users_limit: 2,
    },
  });
});

test.after(async () => {
  await unlockAll();
  await stopServer();
});

// ─────────────────────────────────────────────
// F9 — ROLE-GATED PAYMENT HISTORY
// ─────────────────────────────────────────────

test('B1-F9: own payment history strips the transfer reference for STAFF, keeps it for the OWNER, and always carries rejection_reason', async () => {
  const req = await api(base, 'POST', '/subscriptions/request', {
    token: ownerAToken,
    body:  { plan_code: 'STANDARD', reference: 'B1-REF-GATE-1' },
  });
  assert.strictEqual(req.status, 201, 'owner must be able to create a claim with a reference');
  const paymentId = req.body.data.payment.id;

  const ownerList = await api(base, 'GET', '/subscriptions/payments', { token: ownerAToken });
  assert.strictEqual(ownerList.status, 200);
  const ownerRow = ownerList.body.data.find((p) => p.id === paymentId);
  assert.ok(ownerRow, 'owner must see their own payment row');
  assert.strictEqual(ownerRow.reference, 'B1-REF-GATE-1', 'owner keeps the transfer reference in history');
  assert.strictEqual(ownerRow.rejection_reason, null, 'rejection_reason field present and null while pending');

  const staffList = await api(base, 'GET', '/subscriptions/payments', { token: staffAToken });
  assert.strictEqual(staffList.status, 200);
  const staffRow = staffList.body.data.find((p) => p.id === paymentId);
  assert.ok(staffRow, 'STAFF still sees the payment row (status/amount are harmless business facts)');
  assert.strictEqual(staffRow.reference, undefined, 'STAFF list must strip the transfer reference (F9)');
  assert.strictEqual('rejection_reason' in staffRow, true, 'customer-facing rejection_reason contract stays for the team');

  const staffStatus = await api(base, 'GET', '/subscriptions/status', { token: staffAToken });
  assert.strictEqual(staffStatus.body.data.latest_payment.reference, undefined, 'STAFF status keeps stripping the reference too');
});

// ─────────────────────────────────────────────
// F2 — REJECTED-PAYMENT RECOVERY
// ─────────────────────────────────────────────

test('B1-F2: a rejected payment is readable from /status with the reviewer reason, and the owner can re-submit a FRESH request', async () => {
  const reg = await api(base, 'POST', '/auth/register-account', {
    body: { name: 'B1 Reject', email: 'b1-reject@test.local', password: PASSWORD, showroom_name: 'B1 Reject Room' },
  });
  assert.strictEqual(reg.status, 201);
  const ownerToken = await tokenFor(base, 'b1-reject@test.local');

  const req = await api(base, 'POST', '/subscriptions/request', {
    token: ownerToken,
    body:  { plan_code: 'STANDARD' },
  });
  assert.strictEqual(req.status, 201);
  const paymentId = req.body.data.payment.id;

  const reject = await api(base, 'POST', `/admin/payments/${paymentId}/reject`, {
    token: superToken, body: { reason: REASON },
  });
  assert.strictEqual(reject.status, 200);

  // The rejection is immediately visible to the customer — reason +
  // review timestamp (the F4 timeline's "reviewed" step data).
  const status = await api(base, 'GET', '/subscriptions/status', { token: ownerToken });
  assert.strictEqual(status.body.data.latest_payment.status, 'REJECTED');
  assert.strictEqual(status.body.data.latest_payment.rejection_reason, REASON);
  assert.ok(status.body.data.latest_payment.reviewed_at, 'reviewed_at must be set (timeline step data)');

  // The account derives back to PENDING (TRIAL row is the latest
  // actionable one) — plan cards return, no admin needed.
  assert.strictEqual(status.body.data.account_status, 'PENDING');

  // Recovery = a FRESH request (the claim was cancelled server-side).
  const reRequest = await api(base, 'POST', '/subscriptions/request', {
    token: ownerToken,
    body:  { plan_code: 'STANDARD' },
  });
  assert.strictEqual(reRequest.status, 201, 'customer must be able to re-submit without support');
  assert.notStrictEqual(reRequest.body.data.payment.id, paymentId);

  // The rejected row stays in history WITH its reason (F2 trace).
  const history = await api(base, 'GET', '/subscriptions/payments', { token: ownerToken });
  const rejectedRow = history.body.data.find((p) => p.id === paymentId);
  assert.ok(rejectedRow, 'rejected payment remains in the history');
  assert.strictEqual(rejectedRow.rejection_reason, REASON);
});

// ─────────────────────────────────────────────
// F5/F3 — RENEWAL WHILE ACTIVE + CANCEL RESTORES ACTIVE
// ─────────────────────────────────────────────

test('B1-F5/F3: a renewal claim derives the account to PENDING_PAYMENT, keeps the active plan working, and cancelling restores ACTIVE', async () => {
  // Activate the claim created by the previous test.
  const pending = await db.payment.findFirst({
    where: { showroom_id: { not: IDS.showroomA }, status: 'PENDING' },
    orderBy: { created_at: 'desc' },
  });
  assert.ok(pending, 'need the fresh claim to activate');
  const approve = await api(base, 'POST', `/admin/payments/${pending.id}/approve`, {
    token: superToken, body: { reason: 'تم التحقق' },
  });
  assert.strictEqual(approve.status, 200);
  assert.strictEqual(approve.body.data.subscription.status, 'ACTIVE');

  const ownerToken = await tokenFor(base, 'b1-reject@test.local');

  // Renewal while ACTIVE — one claim at a time, same shape as purchase.
  const renew = await api(base, 'POST', '/subscriptions/renew-request', {
    token: ownerToken,
    body:  { plan_code: 'STANDARD' },
  });
  assert.strictEqual(renew.status, 201);

  const during = await api(base, 'GET', '/subscriptions/status', { token: ownerToken });
  assert.strictEqual(during.body.data.account_status, 'PENDING_PAYMENT', 'one claim at a time derives PENDING_PAYMENT');
  assert.strictEqual(during.body.data.latest_payment.status, 'PENDING');
  assert.strictEqual(during.body.data.latest_payment.plan_name, 'الباقة القياسية');

  // The ACTIVE subscription itself still exists and is untouched
  // (the claim is a separate PENDING_PAYMENT row) — the frontend
  // shows the current plan alongside the pending renewal.
  const active = await db.subscription.findFirst({
    where: { showroom_id: { not: IDS.showroomA }, status: 'ACTIVE' },
  });
  assert.ok(active, 'the running plan must survive the renewal claim');

  // Cancel the renewal claim → account derives back to ACTIVE.
  const cancel = await api(base, 'DELETE', '/subscriptions/request', { token: ownerToken });
  assert.strictEqual(cancel.status, 200);

  const after = await api(base, 'GET', '/subscriptions/status', { token: ownerToken });
  assert.strictEqual(after.body.data.account_status, 'ACTIVE', 'cancelling a renewal must not downgrade an active account');
  assert.strictEqual(after.body.data.latest_payment.status, 'EXPIRED', 'the cancelled claim payment is recorded as EXPIRED');
  assert.ok(after.body.data.subscription.expires_at, 'the live plan stays on /status for the billing header');
});

// ─────────────────────────────────────────────
// F9 — STAFF NEVER TRIGGERS OWNER MUTATIONS
// ─────────────────────────────────────────────

test('B1-F9: STAFF cannot create claims, attach proof, or cancel — the server stays authoritative', async () => {
  const request = await api(base, 'POST', '/subscriptions/request', {
    token: staffAToken, body: { plan_code: 'STANDARD' },
  });
  assert.strictEqual(request.status, 403, 'STAFF request → 403 (ownerOnly)');

  const renew = await api(base, 'POST', '/subscriptions/renew-request', {
    token: staffAToken, body: { plan_code: 'STANDARD' },
  });
  assert.strictEqual(renew.status, 403, 'STAFF renew → 403 (ownerOnly)');

  const cancel = await api(base, 'DELETE', '/subscriptions/request', { token: staffAToken });
  assert.strictEqual(cancel.status, 403, 'STAFF cancel → 403 (ownerOnly)');

  const pending = await db.payment.findFirst({ where: { showroom_id: IDS.showroomA, status: 'PENDING' } });
  if (pending) {
    const attach = await api(base, 'PATCH', `/subscriptions/payments/${pending.id}`, {
      token: staffAToken, body: { reference: 'B1-STAFF-TAMPER' },
    });
    assert.strictEqual(attach.status, 403, 'STAFF proof attach → 403 (ownerOnly)');
  }
});