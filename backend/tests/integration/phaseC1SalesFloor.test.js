'use strict';
// ============================================================
// Phase C.1 — Sales-Floor Readiness.
// Regression coverage for the C.1 surface:
//   • 1A — installment arithmetic must reconcile with the invoice
//     total (server-authoritative, integer cents math, ±0.01
//     tolerance) while the existing down_payment < total rule stays
//   • 1B — payments on CANCELLED sales are rejected (409) with no
//     mutation to the installment
//   • 3A — duplicate customer protection within a showroom
//     (national_id + phone), cross-tenant duplicates still allowed,
//     failed duplicates create no row
//   • 2  — vehicle chassis/engine identity survives from inventory
//     into the SaleItem snapshot and the printed invoice
//   • 4B — installment receipt: success, HTML escaping, nonce CSP,
//     cross-tenant 404, paid → receipt round trip
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, PASSWORD, IDS , unlockAll} = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');

const cuid = () => `c${crypto.randomBytes(12).toString('hex')}`;

let base;
let superToken, ownerAToken, staffAToken, ownerBToken;

test.before(async () => {
  base = await startServer();
  await seedAll();

  superToken  = await tokenFor(base, 'sa@test.local');
  ownerAToken = await tokenFor(base, 'owner-a@test.local');
  staffAToken = await tokenFor(base, 'staff-a@test.local');
  ownerBToken = await tokenFor(base, 'owner-b@test.local');
});

test.after(async () => {
  await unlockAll();
  await stopServer();
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
async function createInventory({ chassis, engine, color, qty = 3, price = 10000 }) {
  return db.inventory.create({
    data: {
      id: cuid(), showroom_id: IDS.showroomA, vehicle_type: 'CAR',
      brand: 'C1 Synth', model: `M-${crypto.randomBytes(3).toString('hex')}`,
      color: color || null, chassis_number: chassis || null, engine_number: engine || null,
      cost_price: 8000, selling_price: price, quantity: qty, status: 'IN_STOCK',
    },
  });
}

async function createInstallmentSale({ down, monthly, months, discount = 0, unitPrice = 10000 }) {
  const inv = await createInventory({ chassis: `CH-${crypto.randomBytes(4).toString('hex')}`, price: unitPrice });
  const sale = await api(base, 'POST', '/sales', {
    token: ownerAToken,
    body:  {
      sale_type: 'INSTALLMENT',
      items:     [{ inventory_id: inv.id, quantity: 1, unit_price: unitPrice }],
      discount,
      down_payment:       down,
      monthly_amount:     monthly,
      installment_months: months,
      first_due_date:     new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  return { inv, sale };
}

// ─────────────────────────────────────────────
// 1A — INSTALLMENT RECONCILIATION
// ─────────────────────────────────────────────

test('C1-1A: a reconciling installment schedule is accepted (down + months×monthly = total)', async () => {
  const { sale } = await createInstallmentSale({ down: 1000, monthly: 3000, months: 3 });
  assert.strictEqual(sale.status, 201, 'down 1000 + 3×3000 = total 10000 must be accepted');
  assert.strictEqual(sale.body.data.sale_type, 'INSTALLMENT');
  const count = await db.installment.count({ where: { sale_id: sale.body.data.id } });
  assert.strictEqual(count, 3, 'three installments must be created');
});

test('C1-1A: a non-reconciling schedule is rejected with the exact message and creates nothing', async () => {
  const before = await db.sale.count();
  const { sale } = await createInstallmentSale({ down: 1000, monthly: 2500, months: 3 }); // 8500 ≠ 10000
  assert.strictEqual(sale.status, 400);
  assert.strictEqual(sale.body.code, 'VALIDATION_ERROR');
  assert.strictEqual(sale.body.message, 'مجموع الدفعة الأولى والأقساط يجب أن يساوي إجمالي الفاتورة');
  const after = await db.sale.count();
  assert.strictEqual(after, before, 'a rejected sale must not be persisted');
});

test('C1-1A: boundary tolerance — exactly ±0.01 is accepted, 0.02 is rejected', async () => {
  // total 9999.99 (discount 0.01) vs collectible 10000 → diff 0.01 → accepted
  const atTolerance = await createInstallmentSale({ down: 1000, monthly: 3000, months: 3, discount: 0.01 });
  assert.strictEqual(atTolerance.sale.status, 201, 'diff of exactly 0.01 is within tolerance');

  // total 9999.98 (discount 0.02) vs collectible 10000 → diff 0.02 → rejected
  const overTolerance = await createInstallmentSale({ down: 1000, monthly: 3000, months: 3, discount: 0.02 });
  assert.strictEqual(overTolerance.sale.status, 400, 'diff of 0.02 exceeds the 0.01 tolerance');
});

test('C1-1A: the existing down_payment < total rule is preserved at the service level', async () => {
  const { sale } = await createInstallmentSale({ down: 10000, monthly: 100, months: 1 });
  assert.strictEqual(sale.status, 400, 'down payment equal to the total must be rejected');
  assert.strictEqual(sale.body.message, 'الدفعة الأولى يجب أن تكون أقل من الإجمالي.');
});

test('C1-1A: the API-level schema refine also rejects a mismatched schedule when total is sent', async () => {
  const inv = await createInventory({ price: 10000 });
  const res = await api(base, 'POST', '/sales', {
    token: ownerAToken,
    body:  {
      sale_type: 'INSTALLMENT',
      total:     10000,
      items:     [{ inventory_id: inv.id, quantity: 1, unit_price: 10000 }],
      down_payment:       500,
      monthly_amount:     2000,
      installment_months: 3,
      first_due_date:     new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
  assert.ok(
    res.body.errors?.monthly_amount?.includes('مجموع الدفعة الأولى والأقساط'),
    'the schema refine must surface the reconciliation message on the monthly_amount field'
  );
});

// ─────────────────────────────────────────────
// 1B — PAYMENT ON CANCELLED SALES
// ─────────────────────────────────────────────

test('C1-1B: paying an installment of a CANCELLED sale is rejected 409 with no mutation', async () => {
  // Fixture: saleInstA (ACTIVE) with instA1/instA2 unpaid → cancellable.
  const cancel = await api(base, 'PATCH', `/sales/${IDS.saleInstA}/cancel`, { token: ownerAToken });
  assert.strictEqual(cancel.status, 200, 'unpaid-installment sale is cancellable');

  const pay = await api(base, 'PATCH', `/sales/installments/${IDS.instA1}/pay`, {
    token: staffAToken, body: { note: 'should not land' },
  });
  assert.strictEqual(pay.status, 409, 'payment on a cancelled sale must conflict');
  assert.strictEqual(pay.body.code, 'CONFLICT');
  assert.strictEqual(pay.body.message, 'لا يمكن تسجيل دفعة على فاتورة ملغاة');

  const inst = await db.installment.findUnique({ where: { id: IDS.instA1 } });
  assert.strictEqual(inst.is_paid, false, 'installment must remain unpaid');
  assert.strictEqual(inst.paid_at, null, 'paid_at must stay null — no payment mutation occurred');
  assert.strictEqual(inst.note, 'SALE_CANCELLED', 'only the cancellation stamp may exist');
});

// ─────────────────────────────────────────────
// 3A — DUPLICATE CUSTOMER PROTECTION
// ─────────────────────────────────────────────

test('C1-3A: duplicate national_id is rejected 409 naming the existing customer', async () => {
  const first = await api(base, 'POST', '/customers', {
    token: ownerAToken, body: { name: 'Ali Duplicate', national_id: 'NID-C1-001', phone: '+967700000001' },
  });
  assert.strictEqual(first.status, 201);

  const dup = await api(base, 'POST', '/customers', {
    token: ownerAToken, body: { name: 'Ali Copy', national_id: 'NID-C1-001', phone: '+967700000002' },
  });
  assert.strictEqual(dup.status, 409);
  assert.strictEqual(dup.body.code, 'CONFLICT');
  assert.ok(dup.body.message.includes('الرقم الوطني'), 'message must name the duplicate key');
  assert.ok(dup.body.message.includes('Ali Duplicate'), 'message must name the existing customer');

  const count = await db.customer.count({ where: { showroom_id: IDS.showroomA, national_id: 'NID-C1-001' } });
  assert.strictEqual(count, 1, 'the failed duplicate must not create a row');
});

test('C1-3A: duplicate phone is rejected 409 and cross-tenant duplicates are still allowed', async () => {
  const first = await api(base, 'POST', '/customers', {
    token: ownerAToken, body: { name: 'Phone One', phone: '+967777000777' },
  });
  assert.strictEqual(first.status, 201);

  const dupSameRoom = await api(base, 'POST', '/customers', {
    token: ownerAToken, body: { name: 'Phone Two', phone: '+967777000777' },
  });
  assert.strictEqual(dupSameRoom.status, 409, 'same-tenant phone duplicate must conflict');
  assert.ok(dupSameRoom.body.message.includes('Phone One'));

  const otherRoom = await api(base, 'POST', '/customers', {
    token: ownerBToken, body: { name: 'B Phone One', phone: '+967777000777' },
  });
  assert.strictEqual(otherRoom.status, 201, 'the same phone in another showroom is a different customer — must be allowed');
});

test('C1-3A: deactivated customers do not block re-registration of the same identity', async () => {
  const first = await api(base, 'POST', '/customers', {
    token: ownerAToken, body: { name: 'Zombie One', phone: '+967711111111', national_id: 'NID-C1-002' },
  });
  assert.strictEqual(first.status, 201);

  const deact = await api(base, 'DELETE', `/customers/${first.body.data.id}`, { token: ownerAToken });
  assert.strictEqual(deact.status, 200);

  const recreate = await api(base, 'POST', '/customers', {
    token: ownerAToken, body: { name: 'Zombie Two', phone: '+967711111111', national_id: 'NID-C1-002' },
  });
  assert.strictEqual(recreate.status, 201, 'an inactive customer does not hold the identity hostage');
});

// ─────────────────────────────────────────────
// 2 — VEHICLE IDENTITY SNAPSHOT
// ─────────────────────────────────────────────

test('C1-2: chassis/engine/color captured from inventory flow into the SaleItem snapshot and the printed invoice', async () => {
  const chassis = `CHASSIS-C1-${crypto.randomBytes(4).toString('hex')}`;
  const inv = await createInventory({ chassis, engine: 'ENG-C1-777', color: 'أحمر' });

  const sale = await api(base, 'POST', '/sales', {
    token: ownerAToken,
    body:  { sale_type: 'CASH', items: [{ inventory_id: inv.id, quantity: 1, unit_price: 10000 }] },
  });
  assert.strictEqual(sale.status, 201, 'cash sale on the chassis-identified vehicle succeeds');
  const saleId = sale.body.data.id;

  const item = await db.saleItem.findFirst({ where: { sale_id: saleId } });
  assert.strictEqual(item.chassis_number, chassis, 'SaleItem snapshot must carry the chassis number');
  assert.strictEqual(item.engine_number, 'ENG-C1-777', 'SaleItem snapshot must carry the engine number');
  assert.strictEqual(item.color, 'أحمر', 'SaleItem snapshot must carry the color');

  const print = await fetch(`${base}/api/v1/invoices/${saleId}/print`, {
    headers: { authorization: `Bearer ${ownerAToken}` },
  });
  assert.strictEqual(print.status, 200);
  const html = await print.text();
  assert.ok(html.includes(chassis), 'the printed invoice must show the chassis number');
  assert.ok(html.includes('ENG-C1-777'), 'the printed invoice must show the engine number');
});

// ─────────────────────────────────────────────
// 4B — INSTALLMENT RECEIPT
// ─────────────────────────────────────────────

test('C1-4B: payment → receipt round trip — the paid installment renders a printable receipt', async () => {
  const { sale } = await createInstallmentSale({ down: 2000, monthly: 4000, months: 2 });
  assert.strictEqual(sale.status, 201);
  const saleId = sale.body.data.id;

  const inst = await db.installment.findFirst({ where: { sale_id: saleId }, orderBy: { due_date: 'asc' } });
  assert.ok(inst);

  const pay = await api(base, 'PATCH', `/sales/installments/${inst.id}/pay`, {
    token: staffAToken, body: { note: 'استلمها الموظف نقداً' },
  });
  assert.strictEqual(pay.status, 200, 'staff can record the installment payment');

  const res = await fetch(`${base}/api/v1/sales/installments/${inst.id}/receipt`, {
    headers: { authorization: `Bearer ${ownerAToken}` },
  });
  assert.strictEqual(res.status, 200);
  const html = await res.text();

  assert.ok(html.includes('إيصال سداد قسط'), 'receipt must carry its title');
  assert.ok(html.includes(sale.body.data.invoice_number), 'receipt must show the invoice number');
  assert.ok(html.includes('✓ مدفوع'), 'receipt must show the paid status');
  assert.ok(html.includes('استلمها الموظف نقداً'), 'receipt must show the payment note');
  assert.ok(html.includes('Showroom A'), 'receipt must show the showroom name');
});

test('C1-4B: receipt HTML escapes malicious tenant input and keeps the nonce CSP', async () => {
  const evilCustomer = await db.customer.create({
    data: {
      id: cuid(), showroom_id: IDS.showroomA,
      name: `<script>alert(1)</script>أحمد<img src=x onerror=alert(2)>`,
      phone: `<script>alert(3)</script>`,
    },
  });
  const inv = await createInventory({ price: 10000 });
  const sale = await api(base, 'POST', '/sales', {
    token: ownerAToken,
    body:  {
      sale_type: 'INSTALLMENT',
      customer_id: evilCustomer.id,
      items:       [{ inventory_id: inv.id, quantity: 1, unit_price: 10000 }],
      down_payment:       1000,
      monthly_amount:     3000,
      installment_months: 3,
      first_due_date:     new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    },
  });
  assert.strictEqual(sale.status, 201);

  const inst = await db.installment.findFirst({ where: { sale_id: sale.body.data.id } });
  await api(base, 'PATCH', `/sales/installments/${inst.id}/pay`, { token: ownerAToken, body: {} });

  const res = await fetch(`${base}/api/v1/sales/installments/${inst.id}/receipt`, {
    headers: { authorization: `Bearer ${ownerAToken}` },
  });
  assert.strictEqual(res.status, 200);
  const html = await res.text();

  assert.ok(!html.includes('<script>alert'), 'no raw executable script may reach the receipt');
  assert.ok(html.includes('&lt;script&gt;'), 'script payload must be escaped');
  assert.ok(html.includes('&lt;img'), 'img payload must be escaped');
  assert.ok(html.includes('أحمد'), 'Arabic text survives escaping');

  const csp = res.headers.get('content-security-policy') || '';
  assert.ok(csp.includes(`script-src 'self' 'nonce-`), 'receipt must carry a nonce-based CSP');
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), 'script-src must never allow inline handlers');
  assert.ok(!html.includes('onclick='), 'no inline event handler may exist in the template');
  assert.ok(html.includes('@page { size: A4; margin: 12mm; }'), 'receipt must declare explicit A4 geometry');
});

test('C1-4B: cross-tenant receipt access returns 404 — the route is tenant-scoped', async () => {
  const { sale } = await createInstallmentSale({ down: 1000, monthly: 3000, months: 3 });
  const inst = await db.installment.findFirst({ where: { sale_id: sale.body.data.id } });

  const foreign = await fetch(`${base}/api/v1/sales/installments/${inst.id}/receipt`, {
    headers: { authorization: `Bearer ${ownerBToken}` },
  });
  assert.strictEqual(foreign.status, 404, 'another showroom must never read the receipt');

  const unauth = await fetch(`${base}/api/v1/sales/installments/${inst.id}/receipt`, {});
  assert.strictEqual(unauth.status, 401, 'the receipt must never be reachable without a token');
});

test('C1-4B: the unpaid fixture installment exposes no receipt data to a foreign tenant either', async () => {
  const res = await fetch(`${base}/api/v1/sales/installments/${IDS.instA2}/receipt`, {
    headers: { authorization: `Bearer ${ownerBToken}` },
  });
  assert.strictEqual(res.status, 404, 'cross-tenant receipt of a fixture installment must 404');
});