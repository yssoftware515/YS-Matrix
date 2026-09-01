'use strict';
// ============================================================
// Phase C.4 — Launch-Gate Remediation.
// Coverage for the P0/P1 remediation surface:
//   • SUB-01 — plan catalog seeded, idempotent re-seed, plans listable
//   • Money-out RBAC — STAFF blocked (403 INSUFFICIENT_ROLE) from
//     expenses create/update and supplier payments; OWNER succeeds
//   • Installment concurrency — parallel pays on one installment:
//     exactly one success, one clean 409, sale COMPLETED once
//   • Overdue scan audit — SALE_MARKED_OVERDUE audit row written once,
//     second scan adds nothing (idempotent)
//   • FIN-1 — listSales remaining_amount server-computed, updates as
//     installments are paid, 0 for CASH
//   • EXP-2 — expenses list pagination.total_amount = exact DB sum
//   • N-4 — forgot-password audit records EMAIL_SEND_FAILED truthfully
//     (no RESEND_API_KEY in the test env), generic response always
//   • N-1 — lockout after 5 wrong passwords, generic response while
//     locked, audit ACCOUNT_LOCKED, window expiry restores access
//   • N-5 — deactivated account gets the distinct ACCOUNT_DISABLED code
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, PASSWORD, IDS } = require('../helpers/fixtures');
const { seedPlans } = require('../../src/utils/seed.plans');
const { getDateRange } = require('../../src/utils/dateRange');
const { baseClient: db } = require('../../src/config/database');
const notificationService = require('../../src/services/notification.service');

const cuid = () => `c${crypto.randomBytes(12).toString('hex')}`;

let base;
let ownerAToken, staffAToken;

test.before(async () => {
  base = await startServer();
  await seedAll();
  // SUB-01: the catalog seeder is part of the launch gate — seed
  // BEFORE login so the whole file exercises the seeded state.
  await seedPlans();

  ownerAToken = await tokenFor(base, 'owner-a@test.local');
  staffAToken = await tokenFor(base, 'staff-a@test.local');
});

test.after(async () => {
  await stopServer();
});

// auditLog is fire-and-forget — poll until the row lands.
async function waitFor(predicate, { timeout = 3000, interval = 50 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, interval));
  }
}

async function createInventory({ price = 10000 } = {}) {
  return db.inventory.create({
    data: {
      id: cuid(), showroom_id: IDS.showroomA, vehicle_type: 'CAR',
      brand: 'C4 Synth', model: `M-${crypto.randomBytes(3).toString('hex')}`,
      cost_price: 8000, selling_price: price, quantity: 5, status: 'IN_STOCK',
    },
  });
}

async function createInstallmentSale({ down, monthly, months, firstDue = 30, unitPrice = 10000 }) {
  const inv = await createInventory({ price: unitPrice });
  const sale = await api(base, 'POST', '/sales', {
    token: ownerAToken,
    body:  {
      sale_type: 'INSTALLMENT',
      items:     [{ inventory_id: inv.id, quantity: 1, unit_price: unitPrice }],
      discount:  0,
      down_payment:       down,
      monthly_amount:     monthly,
      installment_months: months,
      first_due_date:     new Date(Date.now() + firstDue * 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  assert.strictEqual(sale.status, 201, 'installment sale must be created');
  return { inv, sale };
}

// ─────────────────────────────────────────
// SUB-01 — PLAN CATALOG
// ─────────────────────────────────────────
test('C4-SUB-01: plans are seeded, listable, and re-seeding is idempotent', async () => {
  const res = await api(base, 'GET', '/subscriptions/plans', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.length, 3, 'exactly the 3 canonical plans');

  const ids = res.body.data.map((p) => p.id).sort();
  assert.deepStrictEqual(ids, ['enterprise', 'pro', 'standard']);

  for (const p of res.body.data) {
    assert.strictEqual(p.is_active, true, `${p.id} must be active`);
    assert.ok(p.price_amount > 0, `${p.id} must carry a positive price`);
    assert.ok(p.duration_months >= 1, `${p.id} must carry a duration`);
    assert.ok(p.users_limit >= 1, `${p.id} must carry a user limit`);
    assert.ok(p.features && Array.isArray(p.features.items), `${p.id} must carry feature bullets for the billing UI`);
  }

  // Re-seed: additive, no duplicates, no drift.
  const again = await seedPlans();
  assert.strictEqual(again.created, 0, 're-seed must create nothing');
  assert.strictEqual(again.skipped, 3, 're-seed must skip the 3 existing plans');

  const count = await db.plan.count();
  assert.strictEqual(count, 3, 'plan table must stay at exactly 3 rows');
});

// ─────────────────────────────────────────
// MONEY-OUT RBAC
// ─────────────────────────────────────────
test('C4-MONEYOUT: STAFF is blocked from money-out routes, OWNER succeeds', async () => {
  // Expenses — STAFF denied on create + update
  const staffCreate = await api(base, 'POST', '/analytics/expenses', {
    token: staffAToken,
    body:  { category: 'إيجار', amount: 5000, expense_date: new Date().toISOString().split('T')[0] },
  });
  assert.strictEqual(staffCreate.status, 403);
  assert.strictEqual(staffCreate.body.code, 'INSUFFICIENT_ROLE');

  const ownerCreate = await api(base, 'POST', '/analytics/expenses', {
    token: ownerAToken,
    body:  { category: 'إيجار', amount: 5000, expense_date: new Date().toISOString().split('T')[0] },
  });
  assert.strictEqual(ownerCreate.status, 201, 'OWNER must record an expense');

  const staffUpdate = await api(base, 'PUT', `/analytics/expenses/${ownerCreate.body.data.id}`, {
    token: staffAToken,
    body:  { amount: 6000 },
  });
  assert.strictEqual(staffUpdate.status, 403, 'STAFF must not edit an expense');

  // Supplier payment — STAFF denied, OWNER succeeds (fixture supA1:
  // balance 1000, so 500 is within the allowed amount)
  const staffPay = await api(base, 'POST', `/suppliers/${IDS.supA1}/payments`, {
    token: staffAToken,
    body:  { amount: 500, note: 'C4 RBAC probe' },
  });
  assert.strictEqual(staffPay.status, 403);
  assert.strictEqual(staffPay.body.code, 'INSUFFICIENT_ROLE');

  const ownerPay = await api(base, 'POST', `/suppliers/${IDS.supA1}/payments`, {
    token: ownerAToken,
    body:  { amount: 500, note: 'C4 RBAC owner' },
  });
  assert.strictEqual(ownerPay.status, 201, 'OWNER must record a supplier payment');

  // STAFF keeps read access (expense list + supplier payment history).
  const staffRead = await api(base, 'GET', '/analytics/expenses?range=month', { token: staffAToken });
  assert.strictEqual(staffRead.status, 200, 'STAFF must still read expense records');
  const staffHistory = await api(base, 'GET', `/suppliers/${IDS.supA1}/payments`, { token: staffAToken });
  assert.strictEqual(staffHistory.status, 200, 'STAFF must still read payment history');
});

// ─────────────────────────────────────────
// INSTALLMENT PAY CONCURRENCY (TOCTOU)
// ─────────────────────────────────────────
test('C4-CONC: parallel pay requests on one installment — exactly one wins, sale completes once', async () => {
  const { sale } = await createInstallmentSale({ down: 4000, monthly: 6000, months: 1, firstDue: 30 });
  const saleId = sale.body.data.id;
  const [inst] = await db.installment.findMany({ where: { sale_id: saleId } });

  const [r1, r2] = await Promise.allSettled([
    api(base, 'PATCH', `/sales/installments/${inst.id}/pay`, { token: ownerAToken, body: { note: 'race A' } }),
    api(base, 'PATCH', `/sales/installments/${inst.id}/pay`, { token: staffAToken, body: { note: 'race B' } }),
  ]);

  const outcomes = [r1, r2].map((r) => (r.status === 'fulfilled' ? r.value.status : 500));
  outcomes.sort((a, b) => a - b);
  assert.deepStrictEqual(outcomes, [200, 409], 'exactly one pay succeeds, the other gets a clean CONFLICT');

  // The loser must not have produced a paid row or a completed sale.
  const paidRows = await db.installment.count({ where: { sale_id: saleId, is_paid: true } });
  assert.strictEqual(paidRows, 1, 'exactly one paid row');

  const after = await db.sale.findUnique({ where: { id: saleId } });
  assert.strictEqual(after.status, 'COMPLETED', 'fully-paid sale must complete exactly once');
});

// ─────────────────────────────────────────
// OVERDUE SCAN — CONDITIONAL FLIP + AUDIT
// ─────────────────────────────────────────
test('C4-OVERDUE: scan flips ACTIVE→OVERDUE once, writes one audit row, second run adds nothing', async () => {
  const { sale } = await createInstallmentSale({ down: 2000, monthly: 4000, months: 2, firstDue: 1 });
  const saleId = sale.body.data.id;

  const insts = await db.installment.findMany({ where: { sale_id: saleId }, orderBy: { due_date: 'asc' } });
  await db.installment.update({
    where: { id: insts[0].id },
    data:  { due_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
  });

  const first = await notificationService.runOverdueInstallmentScan();
  assert.ok(first.scanned >= 1, 'scan must pick up the lapsed installment');

  const flipped = await db.sale.findUnique({ where: { id: saleId } });
  assert.strictEqual(flipped.status, 'OVERDUE', 'sale must flip to OVERDUE');

  const auditRows = await db.auditLog.findMany({
    where: { action: 'SALE_MARKED_OVERDUE', entity_id: saleId },
  });
  assert.strictEqual(auditRows.length, 1, 'exactly one SALE_MARKED_OVERDUE audit row');
  assert.strictEqual(auditRows[0].showroom_id, IDS.showroomA);
  assert.strictEqual(auditRows[0].user_id, null, 'system-cron attribution');
  assert.strictEqual(auditRows[0].new_data.invoice_number, sale.body.data.invoice_number);

  // Second scan: the overdue_notified_at single-fire guard means zero
  // candidates, hence no new status flip and no duplicate audit rows.
  const second = await notificationService.runOverdueInstallmentScan();
  assert.strictEqual(second.scanned, 0, 'second scan must find no new candidates');
  const auditRowsAfter = await db.auditLog.count({
    where: { action: 'SALE_MARKED_OVERDUE', entity_id: saleId },
  });
  assert.strictEqual(auditRowsAfter, 1, 'audit must stay idempotent');
});

// ─────────────────────────────────────────
// FIN-1 — SERVER-SIDE REMAINING BALANCE
// ─────────────────────────────────────────
test('C4-FIN-1: listSales carries server-computed remaining_amount and tracks payments', async () => {
  // Fixture: INSTALLMENT sale with 2 × 7500 unpaid → 15000;
  // CASH sale → 0.
  const res = await api(base, 'GET', '/sales', { token: ownerAToken });
  assert.strictEqual(res.status, 200);

  const instSale = res.body.data.find((s) => s.id === IDS.saleInstA);
  assert.ok(instSale, 'fixture installment sale must be listed');
  assert.strictEqual(instSale.remaining_amount, 15000, '2 unpaid installments of 7500');

  const cashSale = res.body.data.find((s) => s.id === IDS.saleCashA);
  assert.ok(cashSale, 'fixture cash sale must be listed');
  assert.strictEqual(cashSale.remaining_amount, 0, 'CASH sale has no remaining balance');

  // Pay ONE installment → the list reflects 7500 remaining.
  const pay = await api(base, 'PATCH', `/sales/installments/${IDS.instA1}/pay`, {
    token: ownerAToken, body: { note: 'FIN-1 check' },
  });
  assert.strictEqual(pay.status, 200);

  const after = await api(base, 'GET', '/sales', { token: ownerAToken });
  const instAfter = after.body.data.find((s) => s.id === IDS.saleInstA);
  assert.strictEqual(instAfter.remaining_amount, 7500, 'one unpaid installment left');
});

// ─────────────────────────────────────────
// EXP-2 — EXPENSE AGGREGATE TOTAL
// ─────────────────────────────────────────
test('C4-EXP-2: expenses list exposes pagination.total_amount = exact DB sum over the filter', async () => {
  for (const amount of [1000, 2500]) {
    const created = await api(base, 'POST', '/analytics/expenses', {
      token: ownerAToken,
      body:  { category: 'صيانة', amount, expense_date: new Date().toISOString().split('T')[0] },
    });
    assert.strictEqual(created.status, 201);
  }

  const res = await api(base, 'GET', '/analytics/expenses?range=month', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
  // The aggregate must equal the database's own sum over the same
  // filter (other tests in this file also create expenses in-range —
  // the DB aggregate is the ground truth, not a hardcoded number).
  const monthRange = getDateRange({ range: 'month' });
  const dbAgg = await db.expense.aggregate({
    where: { showroom_id: IDS.showroomA, expense_date: monthRange },
    _sum:  { amount: true },
  });
  assert.strictEqual(res.body.pagination.total_amount, parseFloat(dbAgg._sum.amount?.toString() || '0'));
  assert.ok(res.body.pagination.total_amount >= 3500, 'includes the two expenses created here');
  assert.strictEqual(res.body.pagination.total, res.body.data.length, 'row count stays distinct from the sum');

  // Filtered: category-scoped sum must match its own rows only.
  const filtered = await api(base, 'GET', '/analytics/expenses?range=month&category=صيانة', { token: ownerAToken });
  assert.strictEqual(filtered.body.pagination.total_amount, 3500);
});

// ─────────────────────────────────────────
// N-4 — HONEST PASSWORD-RESET EMAIL AUDIT
// ─────────────────────────────────────────
test('C4-N-4: forgot-password audit records EMAIL_SEND_FAILED when mail cannot go out', async () => {
  // Test transport is the console simulator (EMAIL_TRANSPORT=console in
  // .env.test — Phase 2 F-01: emails are simulated, never sent). To
  // exercise the failure path deterministically we flip the simulated-
  // failure flag for exactly this test (the flag is read per-send and
  // restored afterwards). The response stays the generic
  // anti-enumeration success.
  process.env.EMAIL_SIMULATE_FAILURE = 'true';
  try {
    const res = await api(base, 'POST', '/auth/forgot-password-request', {
      body: { email: 'staff-a@test.local' },
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.message.includes('إذا كان هذا البريد مسجَّلاً'), 'generic anti-enumeration message');

    const audit = await waitFor(async () => {
      const row = await db.auditLog.findFirst({
        where: { action: 'PASSWORD_RESET_REQUESTED', new_data: { path: ['email'], equals: 'staff-a@test.local' } },
        orderBy: { created_at: 'desc' },
      });
      return row || null;
    });
    assert.ok(audit, 'PASSWORD_RESET_REQUESTED audit row must exist');
    assert.strictEqual(audit.new_data.status, 'EMAIL_SEND_FAILED', 'audit must record the truth');

    // Unknown email: same generic response, and NO audit row is written
    // (no user exists to attribute it to — the flow short-circuits).
    const unknown = await api(base, 'POST', '/auth/forgot-password-request', {
      body: { email: 'nobody@test.local' },
    });
    assert.strictEqual(unknown.status, 200);
    const unknownAudit = await db.auditLog.count({
      where: { action: 'PASSWORD_RESET_REQUESTED', new_data: { path: ['email'], equals: 'nobody@test.local' } },
    });
    assert.strictEqual(unknownAudit, 0, 'no audit row for non-existent emails');
  } finally {
    process.env.EMAIL_SIMULATE_FAILURE = 'false';
  }
});

// ─────────────────────────────────────────
// N-1 — LOGIN LOCKOUT
// ─────────────────────────────────────────
test('C4-N-1: 5 wrong passwords lock the account; the lock answers generically and expires', async () => {
  const email = 'staff-a@test.local';

  for (let i = 1; i <= 5; i++) {
    const res = await api(base, 'POST', '/auth/login', {
      body: { email, password: `Wrong-Pass-${i}!` },
    });
    assert.strictEqual(res.status, 401);
    assert.strictEqual(res.body.code, 'INVALID_CREDENTIALS', `attempt ${i} must stay generic`);
  }

  // Locked: even the CORRECT password is rejected, with the same
  // generic code (no oracle for the attacker).
  const locked = await api(base, 'POST', '/auth/login', {
    body: { email, password: PASSWORD },
  });
  assert.strictEqual(locked.status, 401);
  assert.strictEqual(locked.body.code, 'INVALID_CREDENTIALS');

  const row = await db.user.findUnique({ where: { email } });
  assert.ok(row.locked_until && new Date(row.locked_until) > new Date(), 'locked_until must be in the future');
  assert.strictEqual(row.failed_login_attempts, 0, 'counter reset at lock so the window grants a clean slate');

  // The lock is visible in the audit trail (owner-side visibility).
  const lockedAudit = await waitFor(async () => {
    const r = await db.auditLog.findFirst({
      where: { action: 'LOGIN_FAILED', user_id: row.id, new_data: { path: ['reason'], equals: 'ACCOUNT_LOCKED' } },
      orderBy: { created_at: 'desc' },
    });
    return r || null;
  });
  assert.ok(lockedAudit, 'LOGIN_FAILED/ACCOUNT_LOCKED audit row must exist');

  // Window expiry: lock lifts, login succeeds, lock state cleared.
  await db.user.update({ where: { id: row.id }, data: { locked_until: new Date(Date.now() - 1000) } });
  const after = await api(base, 'POST', '/auth/login', { body: { email, password: PASSWORD } });
  assert.strictEqual(after.status, 200, 'login must succeed after the window expires');
  const cleared = await db.user.findUnique({ where: { email } });
  assert.strictEqual(cleared.failed_login_attempts, 0);
  assert.strictEqual(cleared.locked_until, null);
});

// ─────────────────────────────────────────
// N-5 — DISABLED ACCOUNT MESSAGING
// ─────────────────────────────────────────
test('C4-N-5: deactivated account gets the distinct ACCOUNT_DISABLED code', async () => {
  // staff-b belongs to showroom B — untouched by every other test here.
  await db.user.update({ where: { id: IDS.staffB }, data: { is_active: false } });

  const res = await api(base, 'POST', '/auth/login', {
    body: { email: 'staff-b@test.local', password: PASSWORD },
  });
  assert.strictEqual(res.status, 401);
  assert.strictEqual(res.body.code, 'ACCOUNT_DISABLED', 'distinct code, distinct from INVALID_CREDENTIALS');
  assert.ok(res.body.message.includes('معطل'), 'Arabic copy tells the user to contact the admin');

  // Cleanup so the fixture stays reusable within this process.
  await db.user.update({ where: { id: IDS.staffB }, data: { is_active: true } });
});

// ─────────────────────────────────────────
// 4C-F4 — HEALTH ENDPOINT: READINESS SIGNAL
// ─────────────────────────────────────────
test('4C-F4: /health liveness shape is unchanged; ?check=db reports DB state', async () => {
  // Liveness — the pre-4C contract must not change.
  const liveness = await fetch(`${base}/health`);
  assert.strictEqual(liveness.status, 200);
  const body = await liveness.json();
  assert.strictEqual(body.status, 'OK');
  assert.strictEqual(body.service, 'YS-MATRIX ERP API');
  assert.ok(body.uptime >= 0);
  assert.ok(!('db' in body), 'plain /health must stay static (no DB field)');

  // Readiness — DB up: 200 + db:'up'.
  const up = await fetch(`${base}/health?check=db`);
  assert.strictEqual(up.status, 200);
  const upBody = await up.json();
  assert.strictEqual(upBody.status, 'OK');
  assert.strictEqual(upBody.db, 'up');

  // Readiness — DB down: 503 + DEGRADED + db:'down' (probe fails,
  // error text never leaks to the caller).
  const realQueryRaw = db.$queryRaw;
  try {
    db.$queryRaw = async () => { throw new Error('CONNECTION_REFUSED_INTERNAL'); };
    const down = await fetch(`${base}/health?check=db`);
    assert.strictEqual(down.status, 503);
    const downBody = await down.json();
    assert.strictEqual(downBody.status, 'DEGRADED');
    assert.strictEqual(downBody.db, 'down');
    assert.ok(!JSON.stringify(downBody).includes('CONNECTION_REFUSED_INTERNAL'), 'probe error detail must never reach the caller');
  } finally {
    db.$queryRaw = realQueryRaw;
  }
});

// ─────────────────────────────────────────
// 4C-E1 — CRON MULTI-INSTANCE CLAIM (P2002 → SKIP)
// ─────────────────────────────────────────
test('4C-E1: duplicate daily cron run is skipped via the ScheduledJobRun claim', async () => {
  const { runDailyNotificationScans } = require('../../src/jobs/scheduledNotifications.job');
  const today = new Date().toISOString().slice(0, 10);

  // The suite may legitimately re-run on the same UTC day — clear
  // the claim first so THIS test owns the run_key deterministically.
  await db.scheduledJobRun.deleteMany({
    where: { job_name: 'daily_notification_scan', run_key: today },
  });

  const first = await runDailyNotificationScans();
  assert.strictEqual(first.skipped, false, 'first run must claim the day and execute');

  const second = await runDailyNotificationScans();
  assert.strictEqual(second.skipped, true, 'second run must lose the claim (P2002) and skip');

  const rows = await db.scheduledJobRun.count({
    where: { job_name: 'daily_notification_scan', run_key: today },
  });
  assert.strictEqual(rows, 1, 'exactly one claim row must exist for the day');
});