'use strict';
// ============================================================
// Phase C.6 — First-Customer Code Remediation.
// Coverage for the six P0/P1 fixes from the Final Code /
// Product Readiness Audit (2026-08-14):
//   • C6-DATE-01 — installment sale accepts the REAL frontend
//     serialized first_due_date (local-midnight → ISO-8601), and the
//     backend contract (z.string().datetime()) is preserved — a bare
//     YYYY-MM-DD payload is still rejected with 400.
//   • C6-SUP-CONC-01 — two PARALLEL supplier payments on a balance
//     that fits only one: exactly one 201, one clean 400, total_paid
//     never exceeds total_due (mandatory concurrency proof).
//   • C6-SUP-CONC-02 — two PARALLEL payments that BOTH fit: both
//     succeed, and the joint total still never exceeds total_due.
//   • C6-SUP-SEQ-01 — sequential error semantics + boundary: a
//     payment exactly equal to the balance succeeds; any excess is
//     rejected with the same VALIDATION_ERROR contract as before.
//   • C6-BULK-01 — POST /inventory/bulk returns { count } (the real
//     API shape the frontend now consumes), and the rows land.
//   • C6-OVD-TOTAL-01 — GET /sales/overdue pagination.total_amount is
//     a tenant-wide database aggregate, identical across pages
//     (page-scoped totals regression — same class as C.4 EXP-2).
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, IDS , unlockAll} = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');

const cuid = () => `c${crypto.randomBytes(12).toString('hex')}`;

let base;
let ownerAToken;

test.before(async () => {
  base = await startServer();
  await seedAll();
  ownerAToken = await tokenFor(base, 'owner-a@test.local');
});

test.after(async () => {
  await unlockAll();
  await stopServer();
});

// The EXACT serialization the fixed frontend sends
// (SaleCreateModal.tsx buildPayload — Phase C.6): the calendar date
// picked in <input type="date"> becomes local midnight, then ISO.
const frontendFirstDueDate = (dateStr) => new Date(`${dateStr}T00:00:00`).toISOString();

async function createInventory({ price = 10000 } = {}) {
  return db.inventory.create({
    data: {
      id: cuid(), showroom_id: IDS.showroomA, vehicle_type: 'CAR',
      brand: 'C6 Synth', model: `M-${crypto.randomBytes(3).toString('hex')}`,
      cost_price: 8000, selling_price: price, quantity: 5, status: 'IN_STOCK',
    },
  });
}

async function createInstallmentSale({ down, monthly, months, firstDueDays = 30, unitPrice = 10000 }) {
  const inv = await createInventory({ price: unitPrice });
  const date = new Date(Date.now() + firstDueDays * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const sale = await api(base, 'POST', '/sales', {
    token: ownerAToken,
    body:  {
      sale_type: 'INSTALLMENT',
      items:     [{ inventory_id: inv.id, quantity: 1, unit_price: unitPrice }],
      discount:  0,
      down_payment:       down,
      monthly_amount:     monthly,
      installment_months: months,
      // frontend-serialized format (Phase C.6 fix)
      first_due_date:     frontendFirstDueDate(date),
    },
  });
  assert.strictEqual(sale.status, 201, 'installment sale must be created');
  return { inv, sale };
}

// ─────────────────────────────────────────
// C6-DATE-01 — FRONTEND first_due_date FORMAT
// ─────────────────────────────────────────
test('C6-DATE-01: frontend-serialized first_due_date creates the sale; bare YYYY-MM-DD is still rejected', async () => {
  const picked = '2026-09-10';
  const inv = await createInventory();

  // The real frontend payload after the C.6 fix — 201.
  const good = await api(base, 'POST', '/sales', {
    token: ownerAToken,
    body:  {
      sale_type: 'INSTALLMENT',
      items:     [{ inventory_id: inv.id, quantity: 1, unit_price: 10000 }],
      discount:  0,
      down_payment:       4000,
      monthly_amount:     6000,
      installment_months: 1,
      first_due_date:     frontendFirstDueDate(picked),
    },
  });
  assert.strictEqual(good.status, 201, `frontend format must create: ${JSON.stringify(good.body)}`);

  // The stored due date must keep the exact calendar day picked.
  const inst = await db.installment.findFirst({
    where: { sale_id: good.body.data.id },
  });
  assert.ok(inst, 'installment row must exist');
  assert.strictEqual(
    new Date(inst.due_date).getTime(),
    new Date(`${picked}T00:00:00`).getTime(),
    'due date must stay the selected calendar day (local midnight)'
  );

  // The OLD broken payload (bare date from <input type="date">) must
  // still fail — the backend contract was NOT weakened.
  const inv2 = await createInventory();
  const bad = await api(base, 'POST', '/sales', {
    token: ownerAToken,
    body:  {
      sale_type: 'INSTALLMENT',
      items:     [{ inventory_id: inv2.id, quantity: 1, unit_price: 10000 }],
      discount:  0,
      down_payment:       4000,
      monthly_amount:     6000,
      installment_months: 1,
      first_due_date:     picked,
    },
  });
  assert.strictEqual(bad.status, 400, 'bare YYYY-MM-DD must stay rejected');
});

// ─────────────────────────────────────────
// C6-SUP-CONC-01 — SUPPLIER PAYMENT RACE
// ─────────────────────────────────────────
test('C6-SUP-CONC-01: parallel supplier payments on a balance that fits only one — exactly one wins, total_paid never exceeds total_due', async () => {
  const supplier = await db.supplier.create({
    data: {
      id: cuid(), showroom_id: IDS.showroomA, name: 'C6 Race One',
      total_due: 1000, total_paid: 0, is_active: true,
    },
  });

  const [r1, r2] = await Promise.allSettled([
    api(base, 'POST', `/suppliers/${supplier.id}/payments`, { token: ownerAToken, body: { amount: 600, note: 'race A' } }),
    api(base, 'POST', `/suppliers/${supplier.id}/payments`, { token: ownerAToken, body: { amount: 600, note: 'race B' } }),
  ]);

  const outcomes = [r1, r2].map((r) => (r.status === 'fulfilled' ? r.value.status : 500));
  outcomes.sort((a, b) => a - b);
  assert.deepStrictEqual(outcomes, [201, 400], 'exactly one payment succeeds, the loser gets the overpayment rejection');

  const loser = [r1, r2].find((r) => r.status === 'fulfilled' && r.value.status === 400);
  assert.ok(loser, 'a 400 response must exist');
  assert.strictEqual(loser.value.body.code, 'VALIDATION_ERROR', 'same error code as the sequential path');

  const rows = await db.supplierPayment.count({ where: { supplier_id: supplier.id } });
  assert.strictEqual(rows, 1, 'exactly one payment row');

  const after = await db.supplier.findUnique({ where: { id: supplier.id } });
  assert.strictEqual(Number(after.total_paid), 600, 'total_paid must equal exactly one payment');
  assert.ok(Number(after.total_paid) <= Number(after.total_due), 'total_paid must never exceed total_due');
});

// ─────────────────────────────────────────
// C6-SUP-CONC-02 — BOTH FIT
// ─────────────────────────────────────────
test('C6-SUP-CONC-02: parallel payments that both fit both succeed — joint total still never exceeds total_due', async () => {
  const supplier = await db.supplier.create({
    data: {
      id: cuid(), showroom_id: IDS.showroomA, name: 'C6 Race Two',
      total_due: 1000, total_paid: 0, is_active: true,
    },
  });

  const [r1, r2] = await Promise.allSettled([
    api(base, 'POST', `/suppliers/${supplier.id}/payments`, { token: ownerAToken, body: { amount: 400, note: 'both A' } }),
    api(base, 'POST', `/suppliers/${supplier.id}/payments`, { token: ownerAToken, body: { amount: 400, note: 'both B' } }),
  ]);

  const outcomes = [r1, r2].map((r) => (r.status === 'fulfilled' ? r.value.status : 500));
  outcomes.sort((a, b) => a - b);
  assert.deepStrictEqual(outcomes, [201, 201], 'both payments fit the balance — both must succeed');

  const rows = await db.supplierPayment.count({ where: { supplier_id: supplier.id } });
  assert.strictEqual(rows, 2, 'two payment rows');

  const after = await db.supplier.findUnique({ where: { id: supplier.id } });
  assert.strictEqual(Number(after.total_paid), 800, 'joint total 800 ≤ total_due 1000');
});

// ─────────────────────────────────────────
// C6-SUP-SEQ-01 — SEQUENTIAL SEMANTICS
// ─────────────────────────────────────────
test('C6-SUP-SEQ-01: boundary payment equal to the balance succeeds; excess keeps the same rejection contract', async () => {
  const supplier = await db.supplier.create({
    data: {
      id: cuid(), showroom_id: IDS.showroomA, name: 'C6 Seq',
      total_due: 1000, total_paid: 0, is_active: true,
    },
  });

  // Exactly the balance — must succeed (boundary of the lte claim).
  const exact = await api(base, 'POST', `/suppliers/${supplier.id}/payments`, {
    token: ownerAToken, body: { amount: 1000 },
  });
  assert.strictEqual(exact.status, 201, 'payment exactly equal to the balance must succeed');

  // One unit above — rejected, same code + message as before the fix.
  const over = await api(base, 'POST', `/suppliers/${supplier.id}/payments`, {
    token: ownerAToken, body: { amount: 1 },
  });
  assert.strictEqual(over.status, 400);
  assert.strictEqual(over.body.code, 'VALIDATION_ERROR');
  assert.ok(String(over.body.message).includes('الرصيد المستحق'), 'Arabic overpayment message preserved');

  const after = await db.supplier.findUnique({ where: { id: supplier.id } });
  assert.strictEqual(Number(after.total_paid), 1000, 'total_paid unchanged by the rejected payment');
});

// ─────────────────────────────────────────
// C6-BULK-01 — BULK IMPORT RESPONSE SHAPE
// ─────────────────────────────────────────
test('C6-BULK-01: bulk inventory returns { count } — the shape the frontend now consumes — and rows land', async () => {
  const brand = `C6-Bulk-${crypto.randomBytes(3).toString('hex')}`;
  const res = await api(base, 'POST', '/inventory/bulk', {
    token: ownerAToken,
    body:  {
      items: [
        { vehicle_type: 'SPARE_PART', brand, model: 'F1', cost_price: 100, selling_price: 200, quantity: 2 },
        { vehicle_type: 'SPARE_PART', brand, model: 'F2', cost_price: 150, selling_price: 300, quantity: 1 },
      ],
    },
  });

  assert.strictEqual(res.status, 201, `bulk must succeed: ${JSON.stringify(res.body)}`);
  assert.strictEqual(typeof res.body.data.count, 'number', 'response data must carry a numeric count');
  assert.strictEqual(res.body.data.count, 2, 'count = rows actually created');
  assert.strictEqual(Array.isArray(res.body.data), false, 'bulk does NOT return an array of rows');

  const rows = await db.inventory.count({ where: { brand } });
  assert.strictEqual(rows, 2, 'both rows must exist in the database');
});

// ─────────────────────────────────────────
// C6-OVD-TOTAL-01 — TENANT-WIDE OVERDUE TOTAL
// ─────────────────────────────────────────
test('C6-OVD-TOTAL-01: overdue total_amount is a tenant-wide DB aggregate, identical across pages', async () => {
  const amounts = [3000, 5000, 7000];
  const createdAmounts = [];
  for (const amount of amounts) {
    // Created with a future due date (the API requires future dates),
    // then backdated directly below so the overdue filter matches
    // without needing the cron. down < total and down + months×monthly
    // = total keeps the C1-1A reconciliation satisfied.
    const { sale } = await createInstallmentSale({
      down: 1000, monthly: amount - 1000, months: 1, unitPrice: amount,
    });
    const [inst] = await db.installment.findMany({ where: { sale_id: sale.body.data.id } });
    createdAmounts.push(Number(inst.amount));
    await db.installment.update({
      where: { id: inst.id },
      data:  { due_date: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) },
    });
  }

  const page1 = await api(base, 'GET', '/sales/overdue?page=1&limit=1', { token: ownerAToken });
  const page2 = await api(base, 'GET', '/sales/overdue?page=2&limit=1', { token: ownerAToken });
  assert.strictEqual(page1.status, 200);
  assert.strictEqual(page2.status, 200);

  // Exact database aggregate over the SAME tenant-scoped filter —
  // the ground truth (mirrors the C4-EXP-2 pattern; earlier files may
  // leave other overdue rows in scope, so equality with the DB is the
  // assertion, not a hardcoded number).
  const dbAgg = await db.installment.aggregate({
    where: {
      is_paid:  false,
      due_date: { lt: new Date() },
      sale:     { showroom_id: IDS.showroomA, status: { in: ['ACTIVE', 'OVERDUE'] } },
    },
    _sum: { amount: true },
  });
  const expected = parseFloat(dbAgg._sum.amount?.toString() || '0');

  assert.strictEqual(page1.body.pagination.total_amount, expected, 'server total = exact DB sum');
  assert.strictEqual(page2.body.pagination.total_amount, expected, 'total must be identical on every page');

  const mySum = createdAmounts.reduce((a, b) => a + b, 0);
  assert.ok(page1.body.pagination.total_amount >= mySum, 'includes the three overdue installments created here');
  assert.ok(page1.body.pagination.total >= 3, 'row count reflects the full overdue scope');
  assert.strictEqual(page1.body.data.length, 1, 'pagination behavior itself is unchanged (limit=1)');
});