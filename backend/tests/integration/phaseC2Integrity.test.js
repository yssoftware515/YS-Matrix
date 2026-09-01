'use strict';
// ============================================================
// Phase C.2 — Sales-Floor Integrity Hardening.
// Regression coverage for the C.2 surface:
//   • OVD-1 — overdue visibility: installments of a sale flipped to
//     OVERDUE by runOverdueInstallmentScan stay visible in
//     GET /sales/overdue, the dashboard KPIs, and the upcoming list;
//     paying the overdue installment restores ACTIVE and clears it;
//     CANCELLED sales never resurface
//   • STK-1 — atomic stock claim: concurrent createSale on the last
//     unit never double-sells, never goes negative, produces exactly
//     one SaleItem / one sale; the claim-level CONFLICT path is
//     pinned deterministically
//   • AUD-1 — installment payment audit + notification: PAY_INSTALLMENT
//     audit row (actor/showroom/invoice/amount), tenant-scoped
//     PAYMENT_RECEIVED notification with CUSTOMER wording (never the
//     supplier flavour), nothing written when the payment fails
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, IDS } = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');
const database = require('../../src/config/database');
const notificationService = require('../../src/services/notification.service');
const analyticsService = require('../../src/services/analytics.service');

const cuid = () => `c${crypto.randomBytes(12).toString('hex')}`;

let base;
let ownerAToken, staffAToken;

test.before(async () => {
  base = await startServer();
  await seedAll();

  ownerAToken = await tokenFor(base, 'owner-a@test.local');
  staffAToken = await tokenFor(base, 'staff-a@test.local');
});

test.after(async () => {
  await stopServer();
});

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
async function createInventory({ qty = 3, price = 10000 } = {}) {
  return db.inventory.create({
    data: {
      id: cuid(), showroom_id: IDS.showroomA, vehicle_type: 'CAR',
      brand: 'C2 Synth', model: `M-${crypto.randomBytes(3).toString('hex')}`,
      cost_price: 8000, selling_price: price, quantity: qty, status: 'IN_STOCK',
    },
  });
}

// firstDue = days from now for the FIRST installment (the API refuses
// past due dates at creation — tests backdate the row directly later).
async function createInstallmentSale({ down, monthly, months, firstDue = 30, unitPrice = 10000 } = {}) {
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
  return { inv, sale };
}

// Dashboard KPIs go through the tenant-scoped client — the test
// process has no AsyncLocalStorage context, so the ONLY supported
// passthrough (runWithShowroomContext) is used, exactly like a
// SUPER_ADMIN targeting a specific showroom.
async function dashboardKPIs() {
  return database.runWithShowroomContext(IDS.showroomA, () =>
    analyticsService.getDashboardKPIs({ showroomId: IDS.showroomA, query: {} })
  );
}

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

// ─────────────────────────────────────────
// OVD-1 — OVERDUE VISIBILITY
// ─────────────────────────────────────────

test('C2-OVD-1: overdue lifecycle — visible before the scan, stays visible after the OVERDUE flip, clears on payment', async () => {
  const { sale } = await createInstallmentSale({ down: 1000, monthly: 3000, months: 3, firstDue: 1 });
  assert.strictEqual(sale.status, 201, 'reconciling installment sale (1000 + 3×3000 = 10000) must be accepted');
  const saleId        = sale.body.data.id;
  const invoiceNumber = sale.body.data.invoice_number;

  const insts = await db.installment.findMany({ where: { sale_id: saleId }, orderBy: { due_date: 'asc' } });
  assert.strictEqual(insts.length, 3);
  const [inst1, inst2, inst3] = insts;

  // Time passes: backdate the first installment so it lapses (the API
  // correctly refuses past due dates at creation — the cron handles
  // lapses, exactly what this test is about).
  await db.installment.update({
    where: { id: inst1.id },
    data:  { due_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
  });

  // 1) Before the scan the sale is still ACTIVE → the lapsed
  //    installment is listed.
  const pre = await api(base, 'GET', '/sales/overdue', { token: ownerAToken });
  assert.strictEqual(pre.status, 200);
  assert.ok(pre.body.data.some((i) => i.id === inst1.id), 'lapsed installment must be listed while the sale is ACTIVE');

  // 2) Run the cron scan exactly as scheduledNotifications.job.js does.
  const scan = await notificationService.runOverdueInstallmentScan();
  assert.ok(scan.scanned >= 1, 'the scan must pick up the lapsed installment');

  const flipped = await db.sale.findUnique({ where: { id: saleId } });
  assert.strictEqual(flipped.status, 'OVERDUE', 'the scan must flip the sale to OVERDUE');

  // 3) THE BUG (OVD-1): the overdue list filtered on status 'ACTIVE'
  //    and silently dropped this installment the moment the flag
  //    flipped. The money is still collectible — it must stay.
  const post = await api(base, 'GET', '/sales/overdue', { token: ownerAToken });
  assert.strictEqual(post.status, 200);
  assert.ok(
    post.body.data.some((i) => i.id === inst1.id),
    'an OVERDUE sale installments must STAY visible in the overdue list'
  );

  // 4) Dashboard KPIs must count the OVERDUE sale's lapsed installment.
  const kpis = await dashboardKPIs();
  assert.strictEqual(kpis.installments.overdue_count, 1, 'dashboard must count the lapsed installment of the OVERDUE sale');
  assert.ok(kpis.installments.overdue_amount >= 3000, 'dashboard overdue amount must include the lapsed installment');

  //    Endpoint-level check once (first hit for this showroom → cache
  //    MISS → fresh response).
  const dash = await api(base, 'GET', '/analytics/dashboard', { token: ownerAToken });
  assert.strictEqual(dash.status, 200);
  assert.strictEqual(dash.body.data.installments.overdue_count, 1, 'the dashboard route must agree');

  // 5) The upcoming list must not lose the OVERDUE sale's FUTURE
  //    installments either (only future due_dates are selected there,
  //    so nothing past-due leaks in).
  const upcoming = await api(base, 'GET', '/sales/upcoming?days=90', { token: ownerAToken });
  assert.strictEqual(upcoming.status, 200);
  assert.ok(upcoming.body.data.some((i) => i.id === inst2.id), 'future installment 2 must stay in upcoming');
  assert.ok(upcoming.body.data.some((i) => i.id === inst3.id), 'future installment 3 must stay in upcoming');
  assert.ok(!upcoming.body.data.some((i) => i.id === inst1.id), 'the lapsed installment must never leak into upcoming');

  // 6) Pay the overdue installment → status returns to ACTIVE, the
  //    lists and KPIs clear.
  const pay = await api(base, 'PATCH', `/sales/installments/${inst1.id}/pay`, {
    token: staffAToken, body: { note: 'OVD-1 lifecycle' },
  });
  assert.strictEqual(pay.status, 200, 'staff can record the installment payment');

  const after = await db.sale.findUnique({ where: { id: saleId } });
  assert.strictEqual(after.status, 'ACTIVE', 'paying the only overdue installment must clear OVERDUE');

  const cleared = await api(base, 'GET', '/sales/overdue', { token: ownerAToken });
  assert.ok(!cleared.body.data.some((i) => i.id === inst1.id), 'a paid installment must leave the overdue list');

  const kpisAfter = await dashboardKPIs();
  assert.strictEqual(kpisAfter.installments.overdue_count, 0, 'dashboard overdue count must drop after payment');
});

test('C2-OVD-1: CANCELLED sales never resurface in the overdue list', async () => {
  const { sale } = await createInstallmentSale({ down: 4000, monthly: 3000, months: 2, firstDue: 1 });
  assert.strictEqual(sale.status, 201);
  const inst = await db.installment.findFirst({ where: { sale_id: sale.body.data.id }, orderBy: { due_date: 'asc' } });

  await db.installment.update({
    where: { id: inst.id },
    data:  { due_date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) },
  });

  const cancel = await api(base, 'PATCH', `/sales/${sale.body.data.id}/cancel`, { token: ownerAToken });
  assert.strictEqual(cancel.status, 200, 'unpaid-installment sale is cancellable');

  const list = await api(base, 'GET', '/sales/overdue', { token: ownerAToken });
  assert.ok(
    !list.body.data.some((i) => i.id === inst.id),
    'a CANCELLED sale installments must never appear in the overdue list'
  );
});

// ─────────────────────────────────────────
// STK-1 — ATOMIC STOCK CLAIM
// ─────────────────────────────────────────

test('C2-STK-1: two concurrent sales on the last unit — exactly one wins, stock never negative, no partial mutations', async () => {
  const inv = await createInventory({ qty: 1 });

  const body = () => ({
    sale_type: 'CASH',
    items:     [{ inventory_id: inv.id, quantity: 1, unit_price: 10000 }],
  });

  const results = await Promise.allSettled([
    api(base, 'POST', '/sales', { token: ownerAToken, body: body() }),
    api(base, 'POST', '/sales', { token: ownerAToken, body: body() }),
  ]);

  assert.strictEqual(results.length, 2);
  const fulfilled = results.map((r) => (r.status === 'fulfilled' ? r.value : null));
  assert.ok(fulfilled.every((r) => r !== null), 'both HTTP calls must complete');

  const successes = fulfilled.filter((r) => r.status === 201);
  const failures  = fulfilled.filter((r) => r.status !== 201);
  assert.strictEqual(successes.length, 1, 'exactly one concurrent sale may succeed on the last unit');
  assert.strictEqual(failures.length, 1, 'exactly one concurrent sale must fail');

  const loser = failures[0];
  assert.ok([409, 400].includes(loser.status), 'the loser fails cleanly — 409 CONFLICT or 400 insufficient stock');
  if (loser.status === 409) {
    assert.strictEqual(loser.body.code, 'CONFLICT', 'a lost claim is a CONFLICT');
    assert.ok(loser.body.message.includes('نفدت الكمية'), 'the claim message must explain the race');
  } else {
    assert.strictEqual(loser.body.code, 'VALIDATION_ERROR', 'a pre-check shortage is a VALIDATION_ERROR');
    assert.ok(loser.body.message.includes('الكمية غير كافية'), 'the pre-check message must explain the shortage');
  }

  // Stock invariants — never negative, exactly one unit consumed.
  const after = await db.inventory.findUnique({ where: { id: inv.id } });
  assert.strictEqual(after.quantity, 0, 'stock must be exactly 0 — never negative');
  assert.strictEqual(after.status, 'SOLD', 'the last unit transitions to SOLD');

  // Exactly one SaleItem row, owned by exactly one sale.
  const itemRows = await db.saleItem.findMany({ where: { inventory_id: inv.id } });
  assert.strictEqual(itemRows.length, 1, 'no partial mutations — exactly one SaleItem');
  const sales = await db.sale.findMany({ where: { id: itemRows[0].sale_id } });
  assert.strictEqual(sales.length, 1, 'exactly one sale owns the unit');
});

test('C2-STK-1: the claim-level CONFLICT path is deterministic when the loser pre-checks before the winner commits', async () => {
  // The winner buys 50 single-unit items: its transaction is long
  // (100+ queries), so the loser's single pre-check deterministically
  // reads the contested unit BEFORE the winner's commit, and both
  // requests race at the atomic claim. Exactly one claim can win.
  const N = 50;
  const items = [];
  for (let i = 0; i < N; i++) items.push(await createInventory({ qty: 1 }));
  const contested = items[0];

  const winnerBody = {
    sale_type: 'CASH',
    items:     items.map((it) => ({ inventory_id: it.id, quantity: 1, unit_price: 10000 })),
  };
  const loserBody = {
    sale_type: 'CASH',
    items:     [{ inventory_id: contested.id, quantity: 1, unit_price: 10000 }],
  };

  const results = await Promise.allSettled([
    api(base, 'POST', '/sales', { token: ownerAToken, body: winnerBody }),
    api(base, 'POST', '/sales', { token: ownerAToken, body: loserBody }),
  ]);

  const statuses = results
    .map((r) => (r.status === 'fulfilled' ? r.value.status : 0))
    .sort((a, b) => a - b);
  assert.deepStrictEqual(statuses, [201, 409], 'winner 201 + loser 409 CONFLICT');

  const loser = results.find((r) => r.status === 'fulfilled' && r.value.status === 409).value;
  assert.strictEqual(loser.body.code, 'CONFLICT');
  assert.ok(loser.body.message.includes('نفدت الكمية'), 'the lost claim must carry the race message');

  const contestedRow = await db.inventory.findUnique({ where: { id: contested.id } });
  assert.strictEqual(contestedRow.quantity, 0, 'contested unit consumed exactly once');
  assert.strictEqual(contestedRow.status, 'SOLD');
  const contestedItems = await db.saleItem.findMany({ where: { inventory_id: contested.id } });
  assert.strictEqual(contestedItems.length, 1, 'the contested unit has exactly one SaleItem — no double-sell');
});

// ─────────────────────────────────────────
// AUD-1 — INSTALLMENT PAYMENT AUDIT + NOTIFICATION
// ─────────────────────────────────────────

test('C2-AUD-1: paying an installment writes a PAY_INSTALLMENT audit row with full context', async () => {
  const { sale } = await createInstallmentSale({ down: 1000, monthly: 3000, months: 3 });
  assert.strictEqual(sale.status, 201);
  const invoiceNumber = sale.body.data.invoice_number;
  const inst = await db.installment.findFirst({ where: { sale_id: sale.body.data.id }, orderBy: { due_date: 'asc' } });

  const pay = await api(base, 'PATCH', `/sales/installments/${inst.id}/pay`, {
    token: staffAToken, body: { note: 'AUD-1 note' },
  });
  assert.strictEqual(pay.status, 200, 'payment must still behave exactly as before');

  const row = await waitFor(() =>
    db.auditLog.findFirst({
      where: { showroom_id: IDS.showroomA, action: 'PAY_INSTALLMENT', entity: 'installment', entity_id: inst.id },
    })
  );
  assert.ok(row, 'the audit entry must be written (fire-and-forget)');
  assert.strictEqual(row.user_id, IDS.staffA, 'actor must be the authenticated user');
  assert.strictEqual(row.showroom_id, IDS.showroomA, 'audit must be tenant-scoped');

  const data = row.new_data;
  assert.strictEqual(data.is_paid, true, 'audit must record the payment state');
  assert.strictEqual(data.amount, 3000, 'audit must record the payment amount');
  assert.strictEqual(data.invoice_number, invoiceNumber, 'audit must record the invoice number');
  assert.strictEqual(data.note, 'AUD-1 note', 'audit must record the payment note');
});

test('C2-AUD-1: the payment fires the CUSTOMER installment notification — never the supplier flavour', async () => {
  const { sale } = await createInstallmentSale({ down: 1000, monthly: 3000, months: 3 });
  assert.strictEqual(sale.status, 201);
  const invoiceNumber = sale.body.data.invoice_number;
  const inst = await db.installment.findFirst({ where: { sale_id: sale.body.data.id }, orderBy: { due_date: 'asc' } });

  const before = await db.notification.count({ where: { showroom_id: IDS.showroomA, type: 'PAYMENT_RECEIVED' } });

  const pay = await api(base, 'PATCH', `/sales/installments/${inst.id}/pay`, { token: staffAToken, body: {} });
  assert.strictEqual(pay.status, 200);

  const notif = await db.notification.findFirst({
    where:  { showroom_id: IDS.showroomA, type: 'PAYMENT_RECEIVED' },
    orderBy: { created_at: 'desc' },
  });
  assert.ok(notif, 'a PAYMENT_RECEIVED notification must be created');
  assert.strictEqual(notif.title, 'دفعة قسط مستلمة', 'the title must be the installment variant');
  assert.ok(notif.body.includes(invoiceNumber), 'the body must name the invoice');
  assert.ok(notif.body.includes('قسط'), 'the body must say installment, not supplier payment');
  assert.ok(!notif.body.includes('للمورد'), 'the supplier flavour must never leak into an installment payment');
  assert.strictEqual(notif.data.invoice_number, invoiceNumber, 'the notification payload must carry the invoice');

  const after = await db.notification.count({ where: { showroom_id: IDS.showroomA, type: 'PAYMENT_RECEIVED' } });
  assert.strictEqual(after, before + 1, 'exactly one notification per payment — no duplicates');
});

test('C2-AUD-1: a failed payment writes neither an audit row nor a notification', async () => {
  const { sale } = await createInstallmentSale({ down: 1000, monthly: 3000, months: 3 });
  assert.strictEqual(sale.status, 201);
  const inst = await db.installment.findFirst({ where: { sale_id: sale.body.data.id }, orderBy: { due_date: 'asc' } });

  const first = await api(base, 'PATCH', `/sales/installments/${inst.id}/pay`, { token: ownerAToken, body: {} });
  assert.strictEqual(first.status, 200);

  // Let the first payment's fire-and-forget audit land before counting.
  await waitFor(() =>
    db.auditLog.count({ where: { entity_id: inst.id, action: 'PAY_INSTALLMENT' } }).then((n) => (n >= 1 ? true : null))
  );

  const auditBefore = await db.auditLog.count({ where: { entity_id: inst.id, action: 'PAY_INSTALLMENT' } });
  const notifBefore = await db.notification.count({ where: { showroom_id: IDS.showroomA, type: 'PAYMENT_RECEIVED' } });

  // Duplicate payment — rejected before any mutation.
  const dup = await api(base, 'PATCH', `/sales/installments/${inst.id}/pay`, { token: ownerAToken, body: {} });
  assert.strictEqual(dup.status, 409);
  assert.strictEqual(dup.body.code, 'CONFLICT');
  assert.strictEqual(dup.body.message, 'القسط مدفوع مسبقاً.');

  // Give a stray fire-and-forget write a generous window to (not) appear.
  await new Promise((r) => setTimeout(r, 300));
  const auditAfter = await db.auditLog.count({ where: { entity_id: inst.id, action: 'PAY_INSTALLMENT' } });
  const notifAfter = await db.notification.count({ where: { showroom_id: IDS.showroomA, type: 'PAYMENT_RECEIVED' } });
  assert.strictEqual(auditAfter, auditBefore, 'a rejected payment must not be audited');
  assert.strictEqual(notifAfter, notifBefore, 'a rejected payment must not fire a notification');

  const row = await db.installment.findUnique({ where: { id: inst.id } });
  assert.strictEqual(row.is_paid, true, 'the original payment stays intact');
});