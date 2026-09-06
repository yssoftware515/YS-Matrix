'use strict';
// ============================================================
// Production hardening phase — regression coverage.
//
// Verifies the P1 renewal tenant contract beyond the Phase 5
// record, the supplier ledger semantics decision, the expiry
// notification threshold/dedup contract, the payment proof
// access matrix, and the rejected-payment re-entry path:
//   • renewal for showroom B stays under B (never the system
//     showroom); explicit renewal values preserved; tenant
//     users cannot renew (403); unknown target → 404
//   • supplier.total_due semantics: manually maintained
//     cumulative counter — inventory creation never auto-
//     accrues; balance = total_due − total_paid surfaces on
//     list/detail; overpayment blocked atomically
//   • expiry notifications 7/3/1: once per threshold, correct
//     plan/date, never for CANCELLED rows, never across
//     showrooms, dedup on re-run, day-0 flip once + audit
//   • proof access matrix: owner list strips payloads, owner
//     status surfaces own proof, foreign tenant sees nothing,
//     admin detail holds proof, admin list strips it
//   • reject → corrected proof requires a FRESH request;
//     re-request after rejection succeeds; rejection never
//     activates the account
//   • ACTIVE-but-not-onboarded accounts are gated with
//     ONBOARDING_REQUIRED, then granted after onboarding
// ============================================================
const test = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, PASSWORD, IDS , unlockAll} = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');
const SECURITY = require('../../src/config/security');
const notificationService = require('../../src/services/notification.service');

const REAL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const DAY = 24 * 60 * 60 * 1000;
// The scan compares against the UTC-midnight horizon, so candidate
// expiries are anchored to UTC midnight (exact n days ahead).
const daysAhead = (n) =>
  new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + n));
const utcDayStr = (d) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0, 10);

// Fire-and-forget auditLog writes land a beat after the response;
// poll briefly instead of assuming ordering.
const findAudit = async (where, attempts = 10) => {
  for (let i = 0; i < attempts; i++) {
    const row = await db.auditLog.findFirst({ where, orderBy: { created_at: 'desc' } });
    if (row) return row;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
};

let base;
let superToken, ownerAToken, ownerBToken, staffBToken, staffAToken;

test.before(async () => {
  base = await startServer();
  await seedAll();

  // Tokens are cached — each login counts against the auth rate
  // limiter (10/15min), so fetch each identity exactly once.
  superToken  = await tokenFor(base, 'sa@test.local');
  ownerAToken = await tokenFor(base, 'owner-a@test.local');
  ownerBToken = await tokenFor(base, 'owner-b@test.local');
  staffBToken = await tokenFor(base, 'staff-b@test.local');
  staffAToken = await tokenFor(base, 'staff-a@test.local');

  // The fixtures seed no plans — create the canonical one.
  await db.plan.create({
    data: {
      id: 'plan-hardening-standard', name: 'الباقة الأساسية', code: 'STANDARD',
      price_amount: 500, currency: 'EGP', duration_months: 1, users_limit: 2,
    },
  });
});

test.after(async () => {
  await unlockAll();
  await stopServer();
});

// ─────────────────────────────────────────────
// SUPPLIER LEDGER SEMANTICS (documented decision)
// ─────────────────────────────────────────────

test('supplier ledger: total_due is manually maintained — inventory creation never auto-accrues', async () => {
  const created = await api(base, 'POST', '/suppliers', {
    token: ownerAToken, body: { name: 'Ledger Supplier', phone: '+20000000001' },
  });
  assert.strictEqual(created.status, 201);
  const supId = created.body.data.id;
  assert.strictEqual(Number(created.body.data.total_due), 0, 'new supplier starts at zero due');
  assert.strictEqual(Number(created.body.data.total_paid), 0);

  // Purchase an item from this supplier (API-level, tenant-validated).
  const item = await api(base, 'POST', '/inventory', {
    token: ownerAToken,
    body:  {
      vehicle_type: 'CAR', brand: 'LedgerTest', model: 'X1',
      cost_price: 100, selling_price: 150, quantity: 1, supplier_id: supId,
    },
  });
  assert.strictEqual(item.status, 201);

  // The purchase does NOT touch the ledger — total_due is the
  // business's declared figure, maintained manually/seed, not derived.
  const after = await db.supplier.findUnique({ where: { id: supId } });
  assert.strictEqual(Number(after.total_due), 0, 'inventory purchase must not auto-accrue total_due');
  assert.strictEqual(Number(after.total_paid), 0);
});

test('supplier ledger: balance = total_due − total_paid; overpayment blocked atomically', async () => {
  // Simulate the manual ledger maintenance: declare 1000 due.
  const created = await api(base, 'POST', '/suppliers', {
    token: ownerAToken, body: { name: 'Ledger Supplier Two' },
  });
  const supId = created.body.data.id;
  await db.supplier.update({ where: { id: supId }, data: { total_due: 1000 } });

  // Pay 400 → 201, total_paid increments atomically.
  const p1 = await api(base, 'POST', `/suppliers/${supId}/payments`, {
    token: ownerAToken, body: { amount: 400, payment_type: 'BANK_TRANSFER' },
  });
  assert.strictEqual(p1.status, 201);
  // Pay 600 → clears the balance exactly.
  const p2 = await api(base, 'POST', `/suppliers/${supId}/payments`, {
    token: ownerAToken, body: { amount: 600 },
  });
  assert.strictEqual(p2.status, 201);
  // Overpay 1 → 400, no row, no counter change.
  const over = await api(base, 'POST', `/suppliers/${supId}/payments`, {
    token: ownerAToken, body: { amount: 1 },
  });
  assert.strictEqual(over.status, 400);
  assert.strictEqual(over.body.code, 'VALIDATION_ERROR');

  const supplier = await db.supplier.findUnique({ where: { id: supId } });
  assert.strictEqual(Number(supplier.total_paid), 1000);
  assert.strictEqual(Number(supplier.total_due), 1000);

  // balance surfaces identically on the list and the detail view.
  const list = await api(base, 'GET', '/suppliers', { token: ownerAToken, query: { search: 'Ledger Supplier Two' } });
  const listed = list.body.data.find((s) => s.id === supId);
  assert.ok(listed, 'supplier must appear in the list');
  assert.strictEqual(listed.balance, 0, 'list balance = total_due − total_paid');

  const detail = await api(base, 'GET', `/suppliers/${supId}`, { token: ownerAToken });
  assert.strictEqual(detail.status, 200);
  assert.strictEqual(detail.body.data.balance, 0, 'detail balance = total_due − total_paid');
});

// ─────────────────────────────────────────────
// PAYMENT PROOF ACCESS MATRIX
// ─────────────────────────────────────────────

test('proof access: owner list strips payloads, status shows own proof, foreign tenant sees nothing, admin detail holds proof, admin list strips it', async () => {
  // Owner A submits a request WITH proof.
  const req = await api(base, 'POST', '/subscriptions/request', {
    token: ownerAToken,
    body:  { plan_code: 'STANDARD', proof_mime: 'image/png', proof_data: REAL_PNG, reference: 'PROOF-MATRIX-1' },
  });
  assert.strictEqual(req.status, 201);
  const paymentId = req.body.data.payment.id;

  // Own history never carries the evidence payload.
  const own = await api(base, 'GET', '/subscriptions/payments', { token: ownerAToken });
  assert.strictEqual(own.status, 200);
  const row = own.body.data.find((p) => p.id === paymentId);
  assert.ok(row, 'own payment must be listed');
  assert.strictEqual(row.proof_data, undefined, 'list rows must strip proof_data');
  assert.strictEqual(row.proof_available, undefined, 'list rows must not hint at evidence');

  // Own status surfaces the owner''s own proof (theirs to see).
  const status = await api(base, 'GET', '/subscriptions/status', { token: ownerAToken });
  assert.strictEqual(status.body.data.latest_payment.id, paymentId);
  assert.strictEqual(status.body.data.latest_payment.proof_data, REAL_PNG);

  // Phase A (P2-2): STAFF in the SAME showroom sees the account
  // status but NEVER the evidence — proof_data/reference are
  // owner/platform-only, excluded server-side.
  const staffStatus = await api(base, 'GET', '/subscriptions/status', { token: staffAToken });
  assert.strictEqual(staffStatus.status, 200);
  assert.strictEqual(staffStatus.body.data.latest_payment.id, paymentId);
  assert.strictEqual(staffStatus.body.data.latest_payment.proof_data, undefined, 'staff status must strip proof_data');
  assert.strictEqual(staffStatus.body.data.latest_payment.reference, undefined, 'staff status must strip the transfer reference');

  // Foreign tenant: payment is invisible (no leak) + detail 403.
  const foreignList = await api(base, 'GET', '/subscriptions/payments', { token: ownerBToken });
  assert.ok(!foreignList.body.data.some((p) => p.id === paymentId), 'foreign list must not leak the payment');

  // Platform detail holds the evidence; platform LIST strips it.
  const adminDetail = await api(base, 'GET', `/admin/payments/${paymentId}`, { token: superToken });
  assert.strictEqual(adminDetail.status, 200);
  assert.strictEqual(adminDetail.body.data.proof_data, REAL_PNG, 'admin reviewer must see the evidence');

  const adminList = await api(base, 'GET', '/admin/payments', { token: superToken });
  adminList.body.data.forEach((p) => {
    assert.strictEqual(p.proof_data, undefined, 'admin list rows must strip proof_data');
  });
});

// ─────────────────────────────────────────────
// REJECTED PAYMENT → ACTIONABLE RE-ENTRY
// ─────────────────────────────────────────────

test('payment lifecycle: rejection never activates; corrected proof goes through a FRESH request', async () => {
  const payment = await db.payment.findFirst({
    where: { showroom_id: IDS.showroomA, status: 'PENDING' }, orderBy: { created_at: 'desc' },
  });
  const subId = payment.subscription_id;

  // Tenant user trying to review → 403 (platform surface is GLOBAL).
  const tenantReview = await api(base, 'GET', `/admin/payments/${payment.id}`, { token: ownerBToken });
  assert.strictEqual(tenantReview.status, 403);

  const reject = await api(base, 'POST', `/admin/payments/${payment.id}/reject`, {
    token: superToken, body: { reason: 'قيمة التحويل لا تطابق مبلغ الباقة' },
  });
  assert.strictEqual(reject.status, 200);

  const rejected = await db.payment.findUnique({ where: { id: payment.id } });
  assert.strictEqual(rejected.status, 'REJECTED');
  assert.strictEqual(rejected.rejection_reason, 'قيمة التحويل لا تطابق مبلغ الباقة');
  const cancelled = await db.subscription.findUnique({ where: { id: subId } });
  assert.strictEqual(cancelled.status, 'CANCELLED');

  // The account is NOT activated by the rejection.
  const activatedNotif = await db.notification.findFirst({
    where: { showroom_id: IDS.showroomA, type: 'SUBSCRIPTION_ACTIVATED' },
  });
  assert.ok(!activatedNotif, 'rejection must never produce an activation notification');
  assert.ok(await db.notification.findFirst({ where: { showroom_id: IDS.showroomA, type: 'PAYMENT_REJECTED' } }));

  // The processed payment is immutable — corrected proof must NOT
  // be attachable to it.
  const attachToRejected = await api(base, 'PATCH', `/subscriptions/payments/${payment.id}`, {
    token: ownerAToken, body: { proof_mime: 'image/png', proof_data: REAL_PNG },
  });
  assert.strictEqual(attachToRejected.status, 409);

  // Corrected submission = a FRESH request (no pending conflict now).
  const reRequest = await api(base, 'POST', '/subscriptions/request', {
    token: ownerAToken,
    body:  { plan_code: 'STANDARD', proof_mime: 'image/png', proof_data: REAL_PNG, reference: 'PROOF-CORRECTED-2' },
  });
  assert.strictEqual(reRequest.status, 201, 'customer must be able to re-submit a corrected request');
  assert.notStrictEqual(reRequest.body.data.payment.id, payment.id);

  // Approve the corrected request → ACTIVE + access.
  const approve = await api(base, 'POST', `/admin/payments/${reRequest.body.data.payment.id}/approve`, {
    token: superToken, body: { reason: 'التحويل صحيح' },
  });
  assert.strictEqual(approve.status, 200);
  assert.strictEqual(approve.body.data.subscription.status, 'ACTIVE');
  assert.ok(await db.notification.findFirst({ where: { showroom_id: IDS.showroomA, type: 'SUBSCRIPTION_ACTIVATED' } }));

  // Owner A now sees ERP access + derived ACTIVE status.
  const erp = await api(base, 'GET', '/customers', { token: ownerAToken });
  assert.strictEqual(erp.status, 200);
  const status = await api(base, 'GET', '/subscriptions/status', { token: ownerAToken });
  assert.strictEqual(status.body.data.account_status, 'ACTIVE');
});

// ─────────────────────────────────────────────
// ONBOARDING GATE
// ─────────────────────────────────────────────

test('onboarding gate: ACTIVE account without onboarding → ONBOARDING_REQUIRED, granted after onboarding', async () => {
  // Give B an ACTIVE claim (direct row; platform-provisioned accounts
  // get their claim at creation) — B is onboarded by default here.
  await db.subscription.create({
    data: {
      showroom_id: IDS.showroomB, plan_name: 'STANDARD', status: 'ACTIVE',
      started_at: new Date(), expires_at: daysAhead(30),
    },
  });

  // Not onboarded yet → business routes must refuse with the
  // onboarding redirect (not ACCOUNT_PENDING, not a silent allow).
  await db.showroom.update({ where: { id: IDS.showroomB }, data: { is_onboarded: false } });
  const blocked = await api(base, 'GET', '/customers', { token: ownerBToken });
  assert.strictEqual(blocked.status, 403);
  assert.strictEqual(blocked.body.code, 'ONBOARDING_REQUIRED');

  // Self-service surface stays open for onboarding completion.
  const plans = await api(base, 'GET', '/subscriptions/plans', { token: ownerBToken });
  assert.strictEqual(plans.status, 200);

  // After onboarding → full access.
  await db.showroom.update({ where: { id: IDS.showroomB }, data: { is_onboarded: true } });
  const allowed = await api(base, 'GET', '/customers', { token: ownerBToken });
  assert.strictEqual(allowed.status, 200);
});

// ─────────────────────────────────────────────
// EXPIRY NOTIFICATION THRESHOLDS + DEDUP
// ─────────────────────────────────────────────

test('expiry notifications: 7/3/1 thresholds fire once with correct plan/date, never for CANCELLED, never across showrooms', async () => {
  const subs = {
    a7:  await db.subscription.create({ data: { showroom_id: IDS.showroomA, plan_name: 'A-PLAN-7', status: 'ACTIVE', started_at: new Date(), expires_at: daysAhead(7) } }),
    a3:  await db.subscription.create({ data: { showroom_id: IDS.showroomA, plan_name: 'A-PLAN-3', status: 'ACTIVE', started_at: new Date(), expires_at: daysAhead(3) } }),
    a1:  await db.subscription.create({ data: { showroom_id: IDS.showroomA, plan_name: 'A-PLAN-1', status: 'ACTIVE', started_at: new Date(), expires_at: daysAhead(1) } }),
    b7:  await db.subscription.create({ data: { showroom_id: IDS.showroomB, plan_name: 'B-PLAN-7', status: 'ACTIVE', started_at: new Date(), expires_at: daysAhead(7) } }),
    cancelled: await db.subscription.create({ data: { showroom_id: IDS.showroomA, plan_name: 'A-CANCEL', status: 'CANCELLED', started_at: new Date(), expires_at: daysAhead(2) } }),
  };

  const result = await notificationService.runSubscriptionExpiryScan();
  assert.strictEqual(result.sent, 4, 'exactly the four ACTIVE candidates get warned');

  const expect = [
    [subs.a7,  7, 'A-PLAN-7'],
    [subs.a3,  3, 'A-PLAN-3'],
    [subs.a1,  1, 'A-PLAN-1'],
  ];
  for (const [sub, days, plan] of expect) {
    const row = await db.subscription.findUnique({ where: { id: sub.id } });
    assert.strictEqual(row.expiry_notified_days, days, `${plan} recorded at threshold ${days}`);
    const notif = await db.notification.findFirst({
      where: { showroom_id: IDS.showroomA, type: 'SUBSCRIPTION_EXPIRING', data: { path: ['plan_name'], equals: plan } },
    });
    assert.ok(notif, `${plan} must have an expiring notification`);
    assert.strictEqual(notif.data.days_left, days);
    assert.strictEqual(notif.data.expires_at, utcDayStr(sub.expires_at), 'notification carries the real expiry date');
  }

  // Cross-showroom containment: B''s warning lands under B only.
  const bNotif = await db.notification.findFirst({
    where: { showroom_id: IDS.showroomB, type: 'SUBSCRIPTION_EXPIRING', data: { path: ['plan_name'], equals: 'B-PLAN-7' } },
  });
  assert.ok(bNotif, 'B must get its own warning');
  assert.strictEqual((await db.notification.findFirst({ where: { showroom_id: IDS.showroomA, type: 'SUBSCRIPTION_EXPIRING', data: { path: ['plan_name'], equals: 'B-PLAN-7' } } })), null, 'B warning must not leak into A');

  // CANCELLED (and thus irrelevant) subscriptions are never warned.
  assert.strictEqual(await db.notification.count({ where: { data: { path: ['plan_name'], equals: 'A-CANCEL' } } }), 0);

  // Sandbox for later tests: pending payment flow rows from the
  // reject/req lifecycle leave the ACTIVE claim with a +1 month
  // horizon — outside this scan window, untouched here.
});

test('expiry notifications: dedup on re-run, day-0 flip fires SUBSCRIPTION_EXPIRED once with audit', async () => {
  const before = await db.notification.count({ where: { type: 'SUBSCRIPTION_EXPIRING' } });
  const rerun = await notificationService.runSubscriptionExpiryScan();
  assert.strictEqual(rerun.sent, 0, 'no new warnings on a duplicate run');
  assert.strictEqual(await db.notification.count({ where: { type: 'SUBSCRIPTION_EXPIRING' } }), before, 'no duplicate warnings');

  // Advance the 1-day subscription into the past → flip.
  const a1 = await db.subscription.findFirst({ where: { plan_name: 'A-PLAN-1' } });
  await db.subscription.update({ where: { id: a1.id }, data: { expires_at: daysAhead(-1) } });

  const flip = await notificationService.runSubscriptionExpiryScan();
  assert.strictEqual(flip.expired, 1);

  const flipped = await db.subscription.findUnique({ where: { id: a1.id } });
  assert.strictEqual(flipped.status, 'EXPIRED');
  assert.strictEqual(flipped.expiry_notified_days, 0);

  const expiredNotif = await db.notification.findFirst({
    where: { showroom_id: IDS.showroomA, type: 'SUBSCRIPTION_EXPIRED', data: { path: ['plan_name'], equals: 'A-PLAN-1' } },
  });
  assert.ok(expiredNotif, 'day-0 must fire the SUBSCRIPTION_EXPIRED notification');

  const audit = await findAudit({ action: 'SUBSCRIPTION_EXPIRED', entity_id: a1.id });
  assert.ok(audit, 'day-0 flip must be audited');
  assert.strictEqual(audit.showroom_id, IDS.showroomA);
  assert.strictEqual(audit.new_data.from_status, 'ACTIVE');

  // Idempotent: another run must not re-notify or re-audit.
  const flip2 = await notificationService.runSubscriptionExpiryScan();
  assert.strictEqual(flip2.expired, 0);
  assert.strictEqual(flip2.sent, 0);
  assert.strictEqual(await db.notification.count({ where: { type: 'SUBSCRIPTION_EXPIRED', data: { path: ['plan_name'], equals: 'A-PLAN-1' } } }), 1);
  assert.strictEqual(await db.auditLog.count({ where: { action: 'SUBSCRIPTION_EXPIRED', entity_id: a1.id } }), 1);
});

// ─────────────────────────────────────────────
// RENEWAL TENANT CONTRACT (P0/P1)
// ─────────────────────────────────────────────

test('renewal: ordinary showroom users cannot renew (403); unknown target → 404', async () => {
  const asOwner = await api(base, 'POST', '/subscriptions/renew', {
    token: ownerAToken, body: { showroom_id: IDS.showroomB, months: 1 },
  });
  assert.strictEqual(asOwner.status, 403, 'OWNER must never reach the renew surface');

  const asStaff = await api(base, 'POST', '/subscriptions/renew', {
    token: staffBToken, body: { showroom_id: IDS.showroomA, months: 1 },
  });
  assert.strictEqual(asStaff.status, 403, 'STAFF must never reach the renew surface');

  const missing = await api(base, 'POST', '/subscriptions/renew', {
    token: superToken, body: { showroom_id: 'no-such-showroom', months: 1 },
  });
  assert.strictEqual(missing.status, 404, 'renewal must validate the target exists');
});

test('renewal: showroom B stays under B — system showroom never gains rows, audit under B', async () => {
  const sysBefore = await db.subscription.count({ where: { showroom_id: SECURITY.tenant.systemShowroomId } });
  const bBefore = await db.subscription.count({ where: { showroom_id: IDS.showroomB } });
  const licenseBefore = (await db.showroom.findUnique({ where: { id: IDS.showroomB } })).license_expiry;

  const r = await api(base, 'POST', '/subscriptions/renew', {
    token: superToken, body: { showroom_id: IDS.showroomB, months: 1, notes: 'hardening renew B' },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.data.subscription.showroom_id, IDS.showroomB, 'renewed row must stay under B');

  const persisted = await db.subscription.findUnique({ where: { id: r.body.data.subscription.id } });
  assert.strictEqual(persisted.showroom_id, IDS.showroomB, 'persisted row must stay under B');
  assert.strictEqual(persisted.status, 'ACTIVE');
  assert.strictEqual(persisted.renewed_by, IDS.sa, 'renewal is attributed to the platform actor');
  // Base = still-future license_expiry (B is 60 days out) + 1 month.
  const expectedExpiry = new Date(licenseBefore);
  expectedExpiry.setMonth(expectedExpiry.getMonth() + 1);
  assert.strictEqual(new Date(persisted.expires_at).toISOString().slice(0, 10), expectedExpiry.toISOString().slice(0, 10), 'expiry = license base + months');

  // license_expiry synced for the license gate's backward compatibility.
  const showroom = await db.showroom.findUnique({ where: { id: IDS.showroomB } });
  assert.ok(new Date(showroom.license_expiry) >= new Date(persisted.expires_at).getTime() - 60 * 1000);
  assert.ok(showroom.is_active === true);

  // No accidental writes anywhere else.
  assert.strictEqual(await db.subscription.count({ where: { showroom_id: SECURITY.tenant.systemShowroomId } }), sysBefore, 'system showroom must not gain rows');
  assert.strictEqual(await db.subscription.count({ where: { showroom_id: IDS.showroomB } }), bBefore + 1, 'exactly one row added under B');

  // Audit attributed to the TARGET tenant, not the system showroom.
  const audit = await findAudit({ action: 'RENEW_SUBSCRIPTION', entity_id: persisted.id });
  assert.ok(audit, 'renewal must be audited');
  assert.strictEqual(audit.showroom_id, IDS.showroomB);
  assert.strictEqual(audit.new_data.showroom_id, IDS.showroomB);

  // Tenant isolation intact for the ORDINARY surface afterwards.
  const foreign = await api(base, 'GET', '/subscriptions/status', { token: ownerBToken });
  assert.strictEqual(foreign.status, 200);
  assert.strictEqual(foreign.body.data.showroom.id, IDS.showroomB, 'B sees only its own account');
});

test('renewal: explicit values are preserved (expiry date, plan, amount, method, notes, audit)', async () => {
  const sysBefore = await db.subscription.count({ where: { showroom_id: SECURITY.tenant.systemShowroomId } });
  const aBefore = await db.subscription.count({ where: { showroom_id: IDS.showroomA } });

  const r = await api(base, 'POST', '/subscriptions/renew', {
    token: superToken,
    body:  {
      showroom_id:     IDS.showroomA,
      new_expiry_date: '2032-06-15T00:00:00.000Z',
      plan_name:       'PREMIUM',
      amount_paid:     1500,
      payment_method:  'BANK_TRANSFER',
      notes:           'hardening explicit renew',
    },
  });
  assert.strictEqual(r.status, 201);

  const persisted = await db.subscription.findUnique({ where: { id: r.body.data.subscription.id } });
  assert.strictEqual(persisted.showroom_id, IDS.showroomA);
  assert.strictEqual(persisted.status, 'ACTIVE');
  assert.strictEqual(persisted.expires_at.toISOString(), '2032-06-15T00:00:00.000Z', 'explicit expiry honored');
  assert.strictEqual(persisted.plan_name, 'PREMIUM');
  assert.strictEqual(Number(persisted.amount_paid), 1500);
  assert.strictEqual(persisted.payment_method, 'BANK_TRANSFER');
  assert.strictEqual(persisted.notes, 'hardening explicit renew');

  const showroom = await db.showroom.findUnique({ where: { id: IDS.showroomA } });
  assert.strictEqual(showroom.license_expiry.toISOString(), '2032-06-15T00:00:00.000Z', 'license gate synced to the explicit expiry');

  assert.strictEqual(await db.subscription.count({ where: { showroom_id: SECURITY.tenant.systemShowroomId } }), sysBefore, 'system showroom untouched');
  assert.strictEqual(await db.subscription.count({ where: { showroom_id: IDS.showroomA } }), aBefore + 1);

  const audit = await findAudit({ action: 'RENEW_SUBSCRIPTION', entity_id: persisted.id });
  assert.ok(audit);
  assert.strictEqual(audit.showroom_id, IDS.showroomA, 'audit attributed to the target showroom');
  assert.strictEqual(audit.new_data.plan_name, 'PREMIUM');
  assert.strictEqual(audit.new_data.showroom_id, IDS.showroomA);
});