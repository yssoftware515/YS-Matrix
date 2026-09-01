'use strict';
// Phase 0.5 — financial invariants against the real database.
// CURRENT behavior contract — no logic changes to make tests pass.
const test = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, api, db } = require('../helpers/harness');
const { seedAll, tokenFor, IDS } = require('../helpers/fixtures');

let base;
let ownerA;

test.before(async () => {
  base = await startServer();
  await seedAll();
  ownerA = await tokenFor(base, 'owner-a@test.local');
});

test.after(async () => {
  await stopServer();
});

test('invariant: sale with a PAID installment cannot be cancelled → 409, transaction stays consistent', async () => {
  // Pay one installment of the INSTALLMENT sale
  const pay = await api(base, 'PATCH', `/sales/installments/${IDS.instA1}/pay`, { token: ownerA, body: {} });
  assert.strictEqual(pay.status, 200, `pay must succeed: ${JSON.stringify(pay.body)}`);

  // Attempt cancellation — must be rejected because money was collected
  const cancel = await api(base, 'PATCH', `/sales/${IDS.saleInstA}/cancel`, { token: ownerA });
  assert.strictEqual(cancel.status, 409);
  assert.strictEqual(cancel.body.code, 'CONFLICT');

  // Consistency: sale still ACTIVE, installment still paid, no partial cancel state
  const sale = await db.baseClient.sale.findUnique({ where: { id: IDS.saleInstA } });
  assert.strictEqual(sale.status, 'ACTIVE', 'cancel rejection must not partially mutate status');
  const paid = await db.baseClient.installment.count({ where: { sale_id: IDS.saleInstA, is_paid: true } });
  assert.strictEqual(paid, 1);
});

test('invariant: supplier overpayment is rejected atomically (no payment row, no total_paid change)', async () => {
  const r = await api(base, 'POST', `/suppliers/${IDS.supA1}/payments`, { token: ownerA, body: { amount: 999999 } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.code, 'VALIDATION_ERROR');

  const payments = await db.baseClient.supplierPayment.count({ where: { supplier_id: IDS.supA1 } });
  assert.strictEqual(payments, 0, 'rejected payment must not leave a row');
  const supplier = await db.baseClient.supplier.findUnique({ where: { id: IDS.supA1 } });
  assert.strictEqual(Number(supplier.total_paid), 0, 'total_paid must be untouched');
});

test('invariant: valid supplier payment commits atomically (row + total_paid increment)', async () => {
  const r = await api(base, 'POST', `/suppliers/${IDS.supA1}/payments`, { token: ownerA, body: { amount: 400 } });
  assert.strictEqual(r.status, 201, `valid payment: ${JSON.stringify(r.body)}`);

  const payments = await db.baseClient.supplierPayment.findMany({ where: { supplier_id: IDS.supA1 } });
  assert.strictEqual(payments.length, 1);
  assert.strictEqual(Number(payments[0].amount), 400);
  const supplier = await db.baseClient.supplier.findUnique({ where: { id: IDS.supA1 } });
  assert.strictEqual(Number(supplier.total_paid), 400, 'total_paid must equal the paid amount');
});

test('invariant: paying the final installment completes the sale (atomic status transition)', async () => {
  // saleInstA: instA2 remains; pay it → sale COMPLETED
  const r = await api(base, 'PATCH', `/sales/installments/${IDS.instA2}/pay`, { token: ownerA, body: {} });
  assert.strictEqual(r.status, 200, `second pay: ${JSON.stringify(r.body)}`);
  const sale = await db.baseClient.sale.findUnique({ where: { id: IDS.saleInstA } });
  assert.strictEqual(sale.status, 'COMPLETED', 'sale completes when the last installment is paid');
});