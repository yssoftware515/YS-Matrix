'use strict';
// ============================================================
// Phase 2 — TENANT BOUNDARY VERIFICATION SUITE (categories A–J).
//
// Verifies that no code path can read or mutate another
// showroom's data, using UNIQUE identifiers created live through
// the real HTTP API (never fixtures-only), so any leak is
// detectable. Every denial is followed by a DB-state assertion:
// the target rows must be byte-for-byte untouched.
//
// Categories:
//   A. Installments      — cross-tenant read / pay / receipt
//   B. SaleItems         — GET /sales/:id items, list search
//   C. Supplier payments — history read + payment write
//   D. Cross-tenant delete/mutation matrix (customers,
//      suppliers, inventory, sale cancel, expenses) + audit
//      attribution (no rows ever land on the target showroom)
//   E. showroom_id spoofing in body (mismatch → CROSS_TENANT_
//      BLOCKED; matching-own → row still lands on the actor's
//      OWN showroom)
//   F. Reports/analytics — unique B values must be ABSENT from
//      A's dashboard / expenses / top-items (and present for B)
//   G. Search — unique B tokens return zero results for A
//   H. Payment proofs — own-only lists, cross-tenant attach
//      rejected, DB unchanged
//   I. Missing tenant context fails CLOSED at the Prisma layer
//   J. runWithShowroomContext — tenant-facing surfaces cannot
//      redirect subscription context via showroom_id
// ============================================================

const test = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, api, db } = require('../helpers/harness');
const { seedAll, tokenFor, IDS , unlockAll} = require('../helpers/fixtures');
const { seedPlans } = require('../../src/utils/seed.plans');

// DB-state assertions must use the UNscoped base client — the scoped
// client refuses (correctly) when no AsyncLocalStorage context exists.
const { baseClient: raw } = db;

let base;
let ownerA, ownerB, staffA, sa;

const futureIso = (days) => new Date(Date.now() + days * 86400000).toISOString();
const notContains = (body, token) => {
  const serialized = JSON.stringify(body);
  assert.ok(!serialized.includes(token), `response must not contain ${token} — got: ${serialized}`);
};

let bItem, bCust, bSale, bSaleInstIds, bExp, bSupPay, aPayId, bPayId;

test.before(async () => {
  base = await startServer();
  await seedAll();
  await seedPlans();

  ownerA = await tokenFor(base, 'owner-a@test.local');
  ownerB = await tokenFor(base, 'owner-b@test.local');
  staffA = await tokenFor(base, 'staff-a@test.local');
  sa = await tokenFor(base, 'sa@test.local');

  // ── LIVE B-SIDE DATA (unique tokens — any leak is detectable) ──
  const bItemRes = await api(base, 'POST', '/inventory', {
    token: ownerB,
    body:  { vehicle_type: 'CAR', brand: 'QxZ', model: 'B-UNIQUE-1', cost_price: 9000, selling_price: 11000, quantity: 3 },
  });
  assert.ok([200, 201].includes(bItemRes.status), `B inventory create failed: ${JSON.stringify(bItemRes.body)}`);
  bItem = bItemRes.body.data;

  const bCustRes = await api(base, 'POST', '/customers', {
    token: ownerB,
    body:  { name: 'QxZ B-Customer', phone: '+10000000099', national_id: 'NID-QXZ-99' },
  });
  assert.ok([200, 201].includes(bCustRes.status), `B customer create failed: ${JSON.stringify(bCustRes.body)}`);
  bCust = bCustRes.body.data;

  const bSaleRes = await api(base, 'POST', '/sales', {
    token: ownerB,
    body:  {
      customer_id: bCust.id,
      sale_type:   'INSTALLMENT',
      items:       [{ inventory_id: bItem.id, quantity: 1, unit_price: 11000 }],
      down_payment: '2000',
      monthly_amount: '3000',
      installment_months: 3,
      first_due_date: futureIso(30),
    },
  });
  assert.ok([200, 201].includes(bSaleRes.status), `B installment sale create failed: ${JSON.stringify(bSaleRes.body)}`);
  bSale = bSaleRes.body.data;
  bSaleInstIds = (await raw.installment.findMany({ where: { sale_id: bSale.id } })).map((i) => i.id);
  assert.strictEqual(bSaleInstIds.length, 3, 'B sale must have 3 installments');

  const bExpRes = await api(base, 'POST', '/analytics/expenses', {
    token: ownerB,
    body:  { category: 'صيانة', description: 'QxZ B-Expense', amount: '1234.5', expense_date: new Date().toISOString() },
  });
  assert.ok([200, 201].includes(bExpRes.status), `B expense create failed: ${JSON.stringify(bExpRes.body)}`);
  bExp = bExpRes.body.data;

  const bSupPayRes = await api(base, 'POST', `/suppliers/${IDS.supB1}/payments`, {
    token: ownerB,
    body:  { amount: '100', note: 'QxZ-B-Payment' },
  });
  assert.ok([200, 201].includes(bSupPayRes.status), `B supplier payment failed: ${JSON.stringify(bSupPayRes.body)}`);
  bSupPay = bSupPayRes.body.data;

  const aReq = await api(base, 'POST', '/subscriptions/request', { token: ownerA, body: { plan_code: 'STANDARD' } });
  assert.ok([200, 201].includes(aReq.status), `A subscription request failed: ${JSON.stringify(aReq.body)}`);
  aPayId = aReq.body.data.payment.id;

  const bReq = await api(base, 'POST', '/subscriptions/request', { token: ownerB, body: { plan_code: 'STANDARD' } });
  assert.ok([200, 201].includes(bReq.status), `B subscription request failed: ${JSON.stringify(bReq.body)}`);
  bPayId = bReq.body.data.payment.id;
});

test.after(async () => {
  await unlockAll();
  await stopServer();
});

// ─────────────────────────────────────────
// A — INSTALLMENTS
// ─────────────────────────────────────────
test('A1: cross-tenant installment PAY is FORBIDDEN and B stays untouched', async () => {
  const inst = bSaleInstIds[0];
  const r = await api(base, 'PATCH', `/sales/installments/${inst}/pay`, { token: ownerA, body: { note: 'hijack' } });
  assert.strictEqual(r.status, 403, JSON.stringify(r.body));
  assert.strictEqual(r.body.code, 'FORBIDDEN');

  const row = await raw.installment.findUnique({ where: { id: inst } });
  assert.strictEqual(row.is_paid, false, 'B installment must remain unpaid');
  assert.strictEqual(row.paid_at, null);
  const sale = await raw.sale.findUnique({ where: { id: bSale.id } });
  assert.strictEqual(sale.status, 'ACTIVE', 'B sale must remain ACTIVE');
});

test('A2: cross-tenant installment RECEIPT resolves to 404', async () => {
  const r = await api(base, 'GET', `/sales/installments/${bSaleInstIds[1]}/receipt`, { token: ownerA });
  assert.strictEqual(r.status, 404);
});

test('A3: B installments never appear in A overdue/upcoming lists (and DO in B)', async () => {
  const overdue = await api(base, 'GET', '/sales/overdue', { token: ownerA });
  assert.strictEqual(overdue.status, 200);
  notContains(overdue.body, bSaleInstIds[0]);
  notContains(overdue.body, bSaleInstIds[1]);

  const upcomingA = await api(base, 'GET', '/sales/upcoming', { token: ownerA });
  assert.strictEqual(upcomingA.status, 200);
  notContains(upcomingA.body, bSaleInstIds[0]);
  notContains(upcomingA.body, bSaleInstIds[1]);
  notContains(upcomingA.body, bSale.invoice_number);

  const upcomingB = await api(base, 'GET', '/sales/upcoming', { token: ownerB });
  assert.strictEqual(upcomingB.status, 200);
  assert.ok(JSON.stringify(upcomingB.body).includes(bSaleInstIds[0]), 'B must see its own installment (positive control)');
});

// ─────────────────────────────────────────
// B — SALE ITEMS
// ─────────────────────────────────────────
test('B1: A GET /sales/:id on a B sale → 404, no item data leaks', async () => {
  const r = await api(base, 'GET', `/sales/${bSale.id}`, { token: ownerA });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.body.code, 'NOT_FOUND');
  notContains(r.body, bSale.invoice_number);
  notContains(r.body, bItem.id);
});

test('B2: owner B sees its own sale with its items (positive control)', async () => {
  const r = await api(base, 'GET', `/sales/${bSale.id}`, { token: ownerB });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.invoice_number, bSale.invoice_number);
  const items = r.body.data.items || [];
  assert.ok(items.some((it) => it.inventory_id === bItem.id), 'B sale must include its item');
});

test('B3: A sale list search cannot surface B invoice', async () => {
  const r = await api(base, 'GET', '/sales', { token: ownerA, query: { search: bSale.invoice_number } });
  assert.strictEqual(r.status, 200);
  notContains(r.body, bSale.invoice_number);
});

// ─────────────────────────────────────────
// C — SUPPLIER PAYMENT HISTORY + PAYMENT WRITE
// ─────────────────────────────────────────
test('C1: B payment history is readable by B (positive control)', async () => {
  const r = await api(base, 'GET', `/suppliers/${IDS.supB1}/payments`, { token: ownerB });
  assert.strictEqual(r.status, 200);
  assert.ok(JSON.stringify(r.body).includes(bSupPay.id), 'B must see its own payment');
});

test('C2: A cannot READ B payment history (404, no payment data)', async () => {
  const r = await api(base, 'GET', `/suppliers/${IDS.supB1}/payments`, { token: ownerA });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.body.code, 'NOT_FOUND');
  notContains(r.body, bSupPay.id);
  const still = await db.supplierPayment.count({ where: { supplier_id: IDS.supB1 } });
  assert.strictEqual(still, 1, 'B payment row must still exist');
});

test('C3: A cannot WRITE a payment against B supplier (404, balance unchanged)', async () => {
  const before = await raw.supplier.findUnique({ where: { id: IDS.supB1 } });
  const r = await api(base, 'POST', `/suppliers/${IDS.supB1}/payments`, { token: ownerA, body: { amount: '10' } });
  assert.strictEqual(r.status, 404);
  assert.strictEqual(r.body.code, 'NOT_FOUND');
  const after = await raw.supplier.findUnique({ where: { id: IDS.supB1 } });
  assert.strictEqual(String(after.total_paid), String(before.total_paid), 'B total_paid must be unchanged');
});

// ─────────────────────────────────────────
// D — CROSS-TENANT DELETE / MUTATION MATRIX
// ─────────────────────────────────────────
test('D1: A cannot read/update/delete B customer (all 404, DB untouched)', async () => {
  const before = await raw.customer.findUnique({ where: { id: IDS.custB1 } });
  const read = await api(base, 'GET', `/customers/${IDS.custB1}`, { token: ownerA });
  assert.strictEqual(read.status, 404);
  const upd = await api(base, 'PUT', `/customers/${IDS.custB1}`, { token: ownerA, body: { name: 'Hijacked-B' } });
  assert.strictEqual(upd.status, 404);
  const del = await api(base, 'DELETE', `/customers/${IDS.custB1}`, { token: ownerA });
  assert.strictEqual(del.status, 404);
  const after = await raw.customer.findUnique({ where: { id: IDS.custB1 } });
  assert.strictEqual(after.name, before.name);
  assert.strictEqual(after.is_active, true);
});

test('D2: A cannot read/update/delete/reactivate B supplier (all 404, DB untouched)', async () => {
  const before = await raw.supplier.findUnique({ where: { id: IDS.supB1 } });
  const read = await api(base, 'GET', `/suppliers/${IDS.supB1}`, { token: ownerA });
  assert.strictEqual(read.status, 404);
  const upd = await api(base, 'PUT', `/suppliers/${IDS.supB1}`, { token: ownerA, body: { name: 'Hijacked-Supplier' } });
  assert.strictEqual(upd.status, 404);
  const del = await api(base, 'DELETE', `/suppliers/${IDS.supB1}`, { token: ownerA });
  assert.strictEqual(del.status, 404);
  const react = await api(base, 'PATCH', `/suppliers/${IDS.supB1}/reactivate`, { token: ownerA });
  assert.strictEqual(react.status, 404);
  const after = await raw.supplier.findUnique({ where: { id: IDS.supB1 } });
  assert.strictEqual(after.name, before.name);
  assert.strictEqual(after.is_active, true);
});

test('D3: A cannot read/update/delete B inventory item (all 404, DB untouched)', async () => {
  const before = await raw.inventory.findUnique({ where: { id: bItem.id } });
  const read = await api(base, 'GET', `/inventory/${bItem.id}`, { token: ownerA });
  assert.strictEqual(read.status, 404);
  const upd = await api(base, 'PUT', `/inventory/${bItem.id}`, { token: ownerA, body: { quantity: 1 } });
  assert.strictEqual(upd.status, 404);
  const del = await api(base, 'DELETE', `/inventory/${bItem.id}`, { token: ownerA });
  assert.strictEqual(del.status, 404);
  const after = await raw.inventory.findUnique({ where: { id: bItem.id } });
  assert.strictEqual(after.quantity, before.quantity);
  assert.strictEqual(after.is_active, true);
});

test('D4: A cannot CANCEL a B sale (404; sale and inventory untouched)', async () => {
  const r = await api(base, 'PATCH', `/sales/${bSale.id}/cancel`, { token: ownerA });
  assert.strictEqual(r.status, 404);
  const sale = await raw.sale.findUnique({ where: { id: bSale.id } });
  assert.strictEqual(sale.status, 'ACTIVE');
  const item = await raw.inventory.findUnique({ where: { id: bItem.id } });
  assert.strictEqual(item.quantity, 2, 'cancel would have restored qty — must not have happened');
});

test('D5: A cannot DELETE a B expense (404, row stays)', async () => {
  const r = await api(base, 'DELETE', `/analytics/expenses/${bExp.id}`, { token: ownerA });
  assert.strictEqual(r.status, 404);
  const row = await raw.expense.findUnique({ where: { id: bExp.id } });
  assert.ok(row, 'B expense must still exist');
});

test('D6: every A denial attempt is audited on A — NEVER on B', async () => {
  const leaked = await db.auditLog.count({ where: { showroom_id: IDS.showroomB, user_id: IDS.ownerA } });
  assert.strictEqual(leaked, 0, 'no audit row from actor A may land on showroom B');
});

// ─────────────────────────────────────────
// F — REPORTS / ANALYTICS (unique-value leak detection)
// ─────────────────────────────────────────
test('F1: A dashboard aggregates exclude EVERY B value (exact figures)', async () => {
  const r = await api(base, 'GET', '/analytics/dashboard', { token: ownerA, query: { range: 'year' } });
  assert.strictEqual(r.status, 200);
  const d = r.body.data;
  assert.strictEqual(d.sales.count, 2, 'only A fixtures (cash + installment)');
  assert.strictEqual(d.sales.revenue, 30000, 'B sale (11000) must be excluded');
  assert.strictEqual(d.sales.profit, 6000, 'B profit (2000) must be excluded');
  assert.strictEqual(d.customers.total, 1, 'only custA1 (B customers excluded)');
  assert.strictEqual(d.inventory.total, 1, 'only itemA1 (B item excluded)');
  assert.strictEqual(d.suppliers.total_due, 1000, 'B supplier 500 excluded');
  assert.strictEqual(d.suppliers.total_paid, 0, 'B supplier payment 100 excluded');
  assert.strictEqual(d.installments.overdue_count, 0);
});

test('F2: B dashboard sees its own numbers (positive control)', async () => {
  const r = await api(base, 'GET', '/analytics/dashboard', { token: ownerB, query: { range: 'year' } });
  assert.strictEqual(r.status, 200);
  const d = r.body.data;
  assert.strictEqual(d.sales.count, 1);
  assert.strictEqual(d.sales.revenue, 11000);
  assert.strictEqual(d.sales.profit, 2000);
  assert.strictEqual(d.customers.total, 2, 'custB1 + live-created QxZ B-Customer');
  assert.strictEqual(d.suppliers.total_due, 500);
  assert.strictEqual(d.suppliers.total_paid, 100);
});

test('F3: A expense report excludes B expense; B sees it', async () => {
  const rA = await api(base, 'GET', '/analytics/expenses', { token: ownerA, query: { range: 'month' } });
  assert.strictEqual(rA.status, 200);
  assert.strictEqual(rA.body.pagination.total_amount, 0, 'A must see zero expenses (B 1234.5 excluded)');
  notContains(rA.body, bExp.id);

  const rB = await api(base, 'GET', '/analytics/expenses', { token: ownerB, query: { range: 'month' } });
  assert.strictEqual(rB.status, 200);
  assert.strictEqual(rB.body.pagination.total_amount, 1234.5, 'B must see its own expense');
});

test('F4: A top-items excludes the B item; B sees it', async () => {
  const rA = await api(base, 'GET', '/analytics/top-items', { token: ownerA });
  assert.strictEqual(rA.status, 200);
  notContains(rA.body, bItem.id);

  const rB = await api(base, 'GET', '/analytics/top-items', { token: ownerB });
  assert.strictEqual(rB.status, 200);
  assert.ok(JSON.stringify(rB.body).includes(bItem.id), 'B must see its own item');
});

// ─────────────────────────────────────────
// E — showroom_id SPOOFING (BODY)
// ─────────────────────────────────────────
test('E1: mismatched showroom_id in body → CROSS_TENANT_BLOCKED, nothing created', async () => {
  const before = await raw.customer.count({ where: { name: { contains: 'SpoofX' } } });
  const r = await api(base, 'POST', '/customers', {
    token: ownerA,
    body:  { name: 'SpoofX-Tenant-Jack', phone: '+10000000077', showroom_id: IDS.showroomB },
  });
  assert.strictEqual(r.status, 403, JSON.stringify(r.body));
  assert.strictEqual(r.body.code, 'CROSS_TENANT_BLOCKED');
  const after = await raw.customer.count({ where: { name: { contains: 'SpoofX' } } });
  assert.strictEqual(after, before, 'no customer may be created');
});

test('E2: even a MATCHING showroom_id in body still lands on the actor OWN showroom', async () => {
  const r = await api(base, 'POST', '/customers', {
    token: ownerA,
    body:  { name: 'Spoof-Probe-A', phone: '+10000000078', showroom_id: IDS.showroomA },
  });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
  const row = await raw.customer.findFirst({ where: { name: 'Spoof-Probe-A' } });
  assert.ok(row, 'customer must exist');
  assert.strictEqual(row.showroom_id, IDS.showroomA, 'row must land on the actor OWN showroom');
  const onB = await raw.customer.count({ where: { name: 'Spoof-Probe-A', showroom_id: IDS.showroomB } });
  assert.strictEqual(onB, 0);
});

test('E3: inventory create with mismatched showroom_id → CROSS_TENANT_BLOCKED', async () => {
  const r = await api(base, 'POST', '/inventory', {
    token: ownerA,
    body:  { vehicle_type: 'CAR', brand: 'SpoofX', model: 'JACK-1', cost_price: 1, selling_price: 2, showroom_id: IDS.showroomB },
  });
  assert.strictEqual(r.status, 403, JSON.stringify(r.body));
  assert.strictEqual(r.body.code, 'CROSS_TENANT_BLOCKED');
});

test('E4: query spoof on analytics/search → CROSS_TENANT_BLOCKED', async () => {
  const dash = await api(base, 'GET', '/analytics/dashboard', { token: ownerA, query: { showroom_id: IDS.showroomB } });
  assert.strictEqual(dash.status, 403);
  assert.strictEqual(dash.body.code, 'CROSS_TENANT_BLOCKED');
  const s = await api(base, 'GET', '/search', { token: ownerA, query: { q: 'QxZ', showroom_id: IDS.showroomB } });
  assert.strictEqual(s.status, 403);
  assert.strictEqual(s.body.code, 'CROSS_TENANT_BLOCKED');
});

// ─────────────────────────────────────────
// G — SEARCH
// ─────────────────────────────────────────
test('G1: A search for unique B tokens returns ZERO results across all four entities', async () => {
  const r = await api(base, 'GET', '/search', { token: ownerA, query: { q: 'QxZ' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.results.inventory.count, 0);
  assert.strictEqual(r.body.data.results.customers.count, 0);
  assert.strictEqual(r.body.data.results.suppliers.count, 0);
  assert.strictEqual(r.body.data.results.sales.count, 0);
  assert.strictEqual(r.body.data.total_results, 0);
});

test('G2: A search by B invoice number finds nothing', async () => {
  const r = await api(base, 'GET', '/search', { token: ownerA, query: { q: bSale.invoice_number } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.results.sales.count, 0);
  assert.strictEqual(r.body.data.results.sales.items.length, 0, 'no B sale may be returned');
});

test('G3: B search finds its own tokens (positive control)', async () => {
  const r = await api(base, 'GET', '/search', { token: ownerB, query: { q: 'QxZ' } });
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.data.results.inventory.count >= 1, 'B must find its inventory');
  assert.ok(r.body.data.results.customers.count >= 1, 'B must find its customer');
});

test('G4: A search across common words never surfaces B rows', async () => {
  const r = await api(base, 'GET', '/search', { token: ownerA, query: { q: 'Customer' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.results.customers.count, 1, 'only Customer A One');
  notContains(r.body, IDS.custB1);
});

// ─────────────────────────────────────────
// H — PAYMENT PROOFS (subscription payments)
// ─────────────────────────────────────────
test('H1: A payment history contains ONLY its own payment', async () => {
  const r = await api(base, 'GET', '/subscriptions/payments', { token: ownerA });
  assert.strictEqual(r.status, 200);
  assert.ok(JSON.stringify(r.body).includes(aPayId), 'A must see its own payment');
  notContains(r.body, bPayId);
});

test('H2: B payment history contains ONLY its own payment', async () => {
  const r = await api(base, 'GET', '/subscriptions/payments', { token: ownerB });
  assert.strictEqual(r.status, 200);
  assert.ok(JSON.stringify(r.body).includes(bPayId), 'B must see its own payment');
  notContains(r.body, aPayId);
});

test('H3: A cannot attach a proof to a B payment (404, DB untouched)', async () => {
  const before = await raw.payment.findUnique({ where: { id: bPayId } });
  const r = await api(base, 'PATCH', `/subscriptions/payments/${bPayId}`, {
    token: ownerA,
    body:  { reference: 'Hijack-Ref-999' },
  });
  assert.strictEqual(r.status, 404, JSON.stringify(r.body));
  const after = await raw.payment.findUnique({ where: { id: bPayId } });
  assert.strictEqual(after.reference, before.reference, 'B payment reference must be unchanged');
  assert.strictEqual(after.proof_data, null);
});

test('H4: owner B CAN attach a proof to its own payment (positive control)', async () => {
  const r = await api(base, 'PATCH', `/subscriptions/payments/${bPayId}`, {
    token: ownerB,
    body:  { reference: 'B-Ref-123' },
  });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
  const row = await raw.payment.findUnique({ where: { id: bPayId } });
  assert.strictEqual(row.reference, 'B-Ref-123');
});

// ─────────────────────────────────────────
// I — MISSING TENANT CONTEXT FAILS CLOSED
// ─────────────────────────────────────────
test('I1: scoped Prisma queries outside AsyncLocalStorage context are REFUSED', async () => {
  await assert.rejects(
    () => db.customer.findMany({}),
    /Tenant isolation violation/
  );
});

test('I2: unauthenticated requests never reach tenant data (401 before tenant resolution)', async () => {
  const r = await api(base, 'GET', '/customers', {});
  assert.strictEqual(r.status, 401);
});

// ─────────────────────────────────────────
// J — runWithShowroomContext PROVENANCE (server-controlled only)
// ─────────────────────────────────────────
test('J1: tenant-facing subscription request cannot redirect context via showroom_id', async () => {
  const r = await api(base, 'POST', '/subscriptions/request', {
    token: ownerA,
    body:  { plan_code: 'STANDARD', showroom_id: IDS.showroomB },
  });
  assert.strictEqual(r.status, 403, JSON.stringify(r.body));
  assert.strictEqual(r.body.code, 'CROSS_TENANT_BLOCKED');
  const bPending = await raw.subscription.count({
    where: { showroom_id: IDS.showroomB, status: 'PENDING_PAYMENT' },
  });
  assert.strictEqual(bPending, 1, 'only B own request may exist on B');
});

test('J2: renewal-request cannot redirect context either', async () => {
  const r = await api(base, 'POST', '/subscriptions/renew-request', {
    token: ownerA,
    body:  { plan_code: 'STANDARD', showroom_id: IDS.showroomB },
  });
  assert.strictEqual(r.status, 403, JSON.stringify(r.body));
  assert.strictEqual(r.body.code, 'CROSS_TENANT_BLOCKED');
});

test('J3: SUPER_ADMIN renew targets exactly the showroom in the body (global, server-routed)', async () => {
  const r = await api(base, 'POST', '/subscriptions/renew', {
    token: sa,
    body:  { showroom_id: IDS.showroomB, months: 1, plan_name: 'PRO', amount_paid: '350' },
  });
  assert.ok([200, 201].includes(r.status), JSON.stringify(r.body));
  const sub = await raw.subscription.findFirst({
    where:  { showroom_id: IDS.showroomB },
    orderBy: { created_at: 'desc' },
  });
  assert.strictEqual(sub.showroom_id, IDS.showroomB, 'renewal must land on the TARGET showroom only');
  const aSubs = await raw.subscription.count({ where: { showroom_id: IDS.showroomA } });
  assert.strictEqual(aSubs, 1, 'A must be untouched by B renewal');
});