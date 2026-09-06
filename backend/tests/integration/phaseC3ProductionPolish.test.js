'use strict';
// ============================================================
// Phase C.3 — Production Readiness Polish.
// Regression coverage for the C.3 surface:
//   • C3-1 — expense financial validation + audit: negative/zero/
//     malformed amounts are rejected before the ledger is touched
//     (Arabic messages, product convention); update/delete write
//     audit rows; tenant isolation holds; role rules preserved
//     (STAFF may create/update expenses, only owners delete).
//     NOTE: expense endpoints live under /analytics (the analytics
//     router mounts them — analytics.routes.js) → /api/v1/analytics/
//     expenses.
//   • C3-2 — customer duplicate protection on UPDATE: same-showroom,
//     active-only national_id/phone conflict checks (mirroring
//     createCustomer), trimmed comparison, self-update allowed,
//     cross-showroom duplicates allowed, failed updates leave the
//     row untouched
//   • C3-3 — inventory min_price enforcement at sale creation:
//     undercutting the floor is rejected before any stock mutation
//     (no sale, no sale items, no stock movement); equal/above
//     succeed; items without min_price keep the legacy behavior
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, IDS , unlockAll} = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');

const cuid = () => `c${crypto.randomBytes(12).toString('hex')}`;
const tag  = () => crypto.randomBytes(3).toString('hex');

let base;
let ownerAToken, staffAToken, ownerBToken;

test.before(async () => {
  base = await startServer();
  await seedAll();

  ownerAToken = await tokenFor(base, 'owner-a@test.local');
  staffAToken = await tokenFor(base, 'staff-a@test.local');
  ownerBToken = await tokenFor(base, 'owner-b@test.local');
});

test.after(async () => {
  await unlockAll();
  await stopServer();
});

// ─────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────
async function createExpense({ token = ownerAToken, category = 'وقود', amount = 1250.75, description = 'ديزل' } = {}) {
  return api(base, 'POST', '/analytics/expenses', {
    token,
    body: { category, amount, description },
  });
}

async function createCustomer({ token = ownerAToken, name, phone, national_id } = {}) {
  return api(base, 'POST', '/customers', {
    token,
    body: {
      name,
      phone:       phone       || null,
      national_id: national_id || null,
    },
  });
}

async function createInventoryWithMin({ qty = 5, selling = 10000, min = null } = {}) {
  return db.inventory.create({
    data: {
      id: cuid(), showroom_id: IDS.showroomA, vehicle_type: 'CAR',
      brand: 'C3 Synth', model: `M-${crypto.randomBytes(3).toString('hex')}`,
      cost_price: 8000, selling_price: selling, quantity: qty, status: 'IN_STOCK',
      ...(min != null ? { min_price: min } : {}),
    },
  });
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
// C3-1 — EXPENSE FINANCIAL VALIDATION + AUDIT
// ─────────────────────────────────────────

test('C3-1: a negative expense amount is rejected — nothing is written', async () => {
  const res = await createExpense({ amount: -500 });
  assert.strictEqual(res.status, 400, 'negative amounts must be rejected');
  assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
  assert.strictEqual(res.body.message, 'مبلغ المصروف يجب أن يكون أكبر من صفر.');

  const count = await db.expense.count({ where: { showroom_id: IDS.showroomA } });
  assert.strictEqual(count, 0, 'no expense row may exist for the showroom yet');
});

test('C3-1: a zero expense amount is rejected', async () => {
  const res = await createExpense({ amount: 0 });
  assert.strictEqual(res.status, 400, 'zero amounts must be rejected');
  assert.strictEqual(res.body.message, 'مبلغ المصروف يجب أن يكون أكبر من صفر.');
  assert.strictEqual(await db.expense.count({ where: { showroom_id: IDS.showroomA } }), 0);
});

test('C3-1: malformed amounts and missing categories are rejected', async () => {
  const nan = await createExpense({ amount: 'abc' });
  assert.strictEqual(nan.status, 400, 'NaN amounts must be rejected');
  assert.strictEqual(nan.body.message, 'مبلغ المصروف قيمة غير صالحة.');

  const blank = await createExpense({ amount: '' });
  assert.strictEqual(blank.status, 400, 'empty amounts must be rejected');
  assert.strictEqual(blank.body.message, 'مبلغ المصروف مطلوب.');

  const noCat = await createExpense({ amount: 100, category: '' });
  assert.strictEqual(noCat.status, 400, 'blank categories must be rejected');
  assert.strictEqual(noCat.body.message, 'تصنيف المصروف مطلوب.');

  assert.strictEqual(await db.expense.count({ where: { showroom_id: IDS.showroomA } }), 0);
});

test('C3-1: a valid expense is recorded with the numeric amount, tenant-scoped', async () => {
  const res = await createExpense({ amount: '1250.75' });
  assert.strictEqual(res.status, 201, 'valid expenses must be accepted');
  assert.strictEqual(res.body.message, 'تم تسجيل المصروف.');
  assert.strictEqual(Number(res.body.data.amount), 1250.75, 'the stored amount must be the exact numeric value');

  const row = await db.expense.findUnique({ where: { id: res.body.data.id } });
  assert.ok(row, 'the expense row must exist');
  assert.strictEqual(row.showroom_id, IDS.showroomA, 'the expense must be tenant-scoped to the actor showroom');
  assert.strictEqual(row.category, 'وقود');
});

// Phase C.4 (money-out RBAC): the expense UPDATE route now carries
// ownerOnly — money leaving the showroom is an owner-only action, and
// STAFF is refused with 403 BEFORE any validation runs. The validation
// surface (negative/blank) is now exercised on the OWNER path, which
// still gets the exact 400s the C.3 fix introduced.
test('C3-1: updating an expense validates the amount and writes an UPDATE audit row — owners only (Phase C.4 money-out rule)', async () => {
  const created = await createExpense({ amount: 1250.75, category: 'وقود' });
  assert.strictEqual(created.status, 201);
  const expenseId = created.body.data.id;

  // STAFF (non-owner) may NOT update expenses anymore — route-level
  // ownerOnly, the launch-gate money-out separation.
  const denied = await api(base, 'PUT', `/analytics/expenses/${expenseId}`, {
    token: staffAToken, body: { amount: 2000 },
  });
  assert.strictEqual(denied.status, 403, 'STAFF must be refused before any mutation');
  assert.strictEqual(denied.body.code, 'INSUFFICIENT_ROLE');

  const bad = await api(base, 'PUT', `/analytics/expenses/${expenseId}`, {
    token: ownerAToken, body: { amount: -1 },
  });
  assert.strictEqual(bad.status, 400, 'a negative update must be rejected');
  assert.strictEqual(bad.body.message, 'مبلغ المصروف يجب أن يكون أكبر من صفر.');

  const blankCat = await api(base, 'PUT', `/analytics/expenses/${expenseId}`, {
    token: ownerAToken, body: { category: '' },
  });
  assert.strictEqual(blankCat.status, 400, 'a blank category update must be rejected');

  const unchanged = await db.expense.findUnique({ where: { id: expenseId } });
  assert.strictEqual(Number(unchanged.amount), 1250.75, 'a rejected update must leave the row untouched');
  assert.strictEqual(unchanged.category, 'وقود');

  const ok = await api(base, 'PUT', `/analytics/expenses/${expenseId}`, {
    token: ownerAToken, body: { amount: 2000, category: 'صيانة' },
  });
  assert.strictEqual(ok.status, 200, 'valid updates must succeed');
  assert.strictEqual(ok.body.message, 'تم تحديث المصروف.');

  const row = await waitFor(() =>
    db.auditLog.findFirst({
      where: { showroom_id: IDS.showroomA, action: 'UPDATE', entity: 'expense', entity_id: expenseId },
    })
  );
  assert.ok(row, 'the UPDATE audit entry must be written');
  assert.strictEqual(row.user_id, IDS.ownerA, 'the audit actor must be the authenticated user');
  assert.strictEqual(Number(row.old_data.amount), 1250.75, 'old_data must snapshot the pre-update amount');
  assert.strictEqual(Number(row.new_data.amount), 2000, 'new_data must snapshot the post-update amount');
  assert.strictEqual(row.new_data.category, 'صيانة');
});

test('C3-1: deleting an expense hard-deletes it and writes a DELETE audit row — owners only', async () => {
  const created = await createExpense({ amount: 500 });
  assert.strictEqual(created.status, 201);
  const expenseId = created.body.data.id;

  // DELETE is ownerOnly — STAFF must be refused.
  const denied = await api(base, 'DELETE', `/analytics/expenses/${expenseId}`, { token: staffAToken });
  assert.strictEqual(denied.status, 403, 'STAFF must not delete expenses');

  const res = await api(base, 'DELETE', `/analytics/expenses/${expenseId}`, { token: ownerAToken });
  assert.strictEqual(res.status, 200, 'owners may delete expenses');
  assert.strictEqual(res.body.message, 'تم حذف المصروف.');

  assert.strictEqual(await db.expense.findUnique({ where: { id: expenseId } }), null, 'the row must be hard-deleted');

  const row = await waitFor(() =>
    db.auditLog.findFirst({
      where: { showroom_id: IDS.showroomA, action: 'DELETE', entity: 'expense', entity_id: expenseId },
    })
  );
  assert.ok(row, 'the DELETE audit entry must be written');
  assert.strictEqual(Number(row.old_data.amount), 500, 'old_data must snapshot the removed record');
  assert.strictEqual(row.new_data, null, 'new_data must be null for deletions');
});

test('C3-1: expenses are tenant-isolated — other showrooms cannot see, update or delete them', async () => {
  const created = await createExpense({ amount: 900 });
  assert.strictEqual(created.status, 201);
  const expenseId = created.body.data.id;

  const list = await api(base, 'GET', '/analytics/expenses', { token: ownerBToken });
  assert.strictEqual(list.status, 200);
  assert.ok(!list.body.data.some((e) => e.id === expenseId), 'another showroom must not see the expense');

  const upd = await api(base, 'PUT', `/analytics/expenses/${expenseId}`, { token: ownerBToken, body: { amount: 1 } });
  assert.strictEqual(upd.status, 404, 'another showroom must not update the expense');

  const del = await api(base, 'DELETE', `/analytics/expenses/${expenseId}`, { token: ownerBToken });
  assert.strictEqual(del.status, 404, 'another showroom must not delete the expense');

  const intact = await db.expense.findUnique({ where: { id: expenseId } });
  assert.strictEqual(Number(intact.amount), 900, 'the cross-tenant attempts must leave the row untouched');
});

// ─────────────────────────────────────────
// C3-2 — CUSTOMER DUPLICATE PROTECTION ON UPDATE
// ─────────────────────────────────────────

test('C3-2: updating a customer to an existing phone conflicts — row unchanged', async () => {
  const a = await createCustomer({ name: 'عميل ألف', phone: `0100-1-${tag()}`, national_id: `nid-1-${tag()}` });
  const b = await createCustomer({ name: 'عميل باء', phone: `0100-2-${tag()}`, national_id: `nid-2-${tag()}` });
  assert.strictEqual(a.status, 201);
  assert.strictEqual(b.status, 201);
  const aPhone = a.body.data.phone;
  const bId = b.body.data.id;
  const bPhone = b.body.data.phone;

  const res = await api(base, 'PUT', `/customers/${bId}`, {
    token: ownerAToken, body: { phone: aPhone },
  });
  assert.strictEqual(res.status, 409, 'a duplicate phone must CONFLICT');
  assert.strictEqual(res.body.code, 'CONFLICT');
  assert.ok(res.body.message.includes('يوجد عميل مسجل بهذا الرقم (الاسم: عميل ألف)'), 'the conflict must name the existing customer');

  const row = await db.customer.findUnique({ where: { id: bId } });
  assert.strictEqual(row.phone, bPhone, 'the failed update must leave the phone untouched');
  assert.strictEqual(row.national_id, b.body.data.national_id, 'the failed update must leave the national_id untouched');
  assert.strictEqual(row.name, 'عميل باء');
});

test('C3-2: updating a customer to an existing national_id conflicts — row unchanged', async () => {
  const a = await createCustomer({ name: 'عميل ألف ٢', phone: `0100-3-${tag()}`, national_id: `nid-3-${tag()}` });
  const c = await createCustomer({ name: 'عميل جيم', phone: `0100-4-${tag()}`, national_id: `nid-4-${tag()}` });
  assert.strictEqual(a.status, 201);
  assert.strictEqual(c.status, 201);
  const aNid = a.body.data.national_id;
  const cId = c.body.data.id;
  const cNid = c.body.data.national_id;

  const res = await api(base, 'PUT', `/customers/${cId}`, {
    token: ownerAToken, body: { national_id: aNid },
  });
  assert.strictEqual(res.status, 409, 'a duplicate national_id must CONFLICT');
  assert.strictEqual(res.body.code, 'CONFLICT');
  assert.ok(res.body.message.includes('يوجد عميل مسجل بهذا الرقم الوطني (الاسم: عميل ألف ٢)'), 'the conflict must name the existing customer');

  const row = await db.customer.findUnique({ where: { id: cId } });
  assert.strictEqual(row.national_id, cNid, 'the failed update must leave the national_id untouched');
  assert.strictEqual(row.phone, c.body.data.phone, 'the failed update must leave the phone untouched');
});

test('C3-2: updating a customer with its own values — and with whitespace-padded duplicates — is handled correctly', async () => {
  const a = await createCustomer({ name: 'عميل ألف ٣', phone: `0100-5-${tag()}`, national_id: `nid-5-${tag()}` });
  const b = await createCustomer({ name: 'عميل باء ٣', phone: `0100-6-${tag()}`, national_id: `nid-6-${tag()}` });
  assert.strictEqual(a.status, 201);
  assert.strictEqual(b.status, 201);
  const aId = a.body.data.id;
  const aPhone = a.body.data.phone;
  const aNid = a.body.data.national_id;
  const bId = b.body.data.id;

  // Same values as stored → no conflict (NOT id exclusion).
  const own = await api(base, 'PUT', `/customers/${aId}`, {
    token: ownerAToken, body: { phone: aPhone, national_id: aNid },
  });
  assert.strictEqual(own.status, 200, 're-submitting the customer own identifiers must be accepted');

  // Whitespace-padded duplicate of A's phone on B — the trimmed
  // comparison must still catch it.
  const padded = await api(base, 'PUT', `/customers/${bId}`, {
    token: ownerAToken, body: { phone: `  ${aPhone}  ` },
  });
  assert.strictEqual(padded.status, 409, 'whitespace-padded duplicates must still conflict');
  assert.ok(padded.body.message.includes('يوجد عميل مسجل بهذا الرقم'), 'the padded conflict must carry the phone message');
});

test('C3-2: a failed update is all-or-nothing — name changes are not applied', async () => {
  const a = await createCustomer({ name: 'عميل ألف ٤', phone: `0100-7-${tag()}`, national_id: `nid-7-${tag()}` });
  const b = await createCustomer({ name: 'عميل باء ٤', phone: `0100-8-${tag()}`, national_id: `nid-8-${tag()}` });
  assert.strictEqual(a.status, 201);
  assert.strictEqual(b.status, 201);
  const aPhone = a.body.data.phone;
  const bId = b.body.data.id;
  const bPhone = b.body.data.phone;

  const res = await api(base, 'PUT', `/customers/${bId}`, {
    token: ownerAToken, body: { phone: aPhone, name: 'اسم لن يُحفظ' },
  });
  assert.strictEqual(res.status, 409, 'the duplicate phone must block the whole update');

  const row = await db.customer.findUnique({ where: { id: bId } });
  assert.strictEqual(row.name, 'عميل باء ٤', 'a conflicted update must not apply ANY field');
  assert.strictEqual(row.phone, bPhone);
});

test('C3-2: the same phone in ANOTHER showroom is a different customer — allowed', async () => {
  const sharedPhone = `0100-9-${tag()}`;
  const inB = await createCustomer({ token: ownerBToken, name: 'عميل معرض آخر', phone: sharedPhone, national_id: `nid-b-${tag()}` });
  assert.strictEqual(inB.status, 201);

  // Showroom A has no sharedPhone → updating A's customer to it must pass.
  const a = await createCustomer({ name: 'عميل ألف ٥', phone: `0100-10-${tag()}`, national_id: `nid-10-${tag()}` });
  assert.strictEqual(a.status, 201);
  const aId = a.body.data.id;

  const res = await api(base, 'PUT', `/customers/${aId}`, {
    token: ownerAToken, body: { phone: sharedPhone },
  });
  assert.strictEqual(res.status, 200, 'a phone held by another showroom must not conflict');
  const row = await db.customer.findUnique({ where: { id: aId } });
  assert.strictEqual(row.phone, sharedPhone);
});

// ─────────────────────────────────────────
// C3-3 — INVENTORY min_price ENFORCEMENT
// ─────────────────────────────────────────

test('C3-3: selling below min_price is rejected before any side effect — no sale, no sale items, no stock movement', async () => {
  const inv = await createInventoryWithMin({ qty: 5, selling: 10000, min: 9000 });
  const salesBefore = await db.sale.count({ where: { showroom_id: IDS.showroomA } });

  const res = await api(base, 'POST', '/sales', {
    token: ownerAToken,
    body: {
      sale_type: 'CASH',
      items:     [{ inventory_id: inv.id, quantity: 1, unit_price: 8000 }],
    },
  });
  assert.strictEqual(res.status, 400, 'undercutting the floor must be rejected');
  assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
  assert.ok(res.body.message.includes('أقل من الحد الأدنى المسموح'), 'the rejection must explain the floor breach');
  assert.ok(res.body.message.includes('C3 Synth'), 'the rejection must name the item');

  const salesAfter = await db.sale.count({ where: { showroom_id: IDS.showroomA } });
  assert.strictEqual(salesAfter, salesBefore, 'no sale row may be created');

  const itemRows = await db.saleItem.findMany({ where: { inventory_id: inv.id } });
  assert.strictEqual(itemRows.length, 0, 'no SaleItem may be created');

  const after = await db.inventory.findUnique({ where: { id: inv.id } });
  assert.strictEqual(after.quantity, 5, 'stock must not move on a rejected sale');
  assert.strictEqual(after.status, 'IN_STOCK', 'the item must stay IN_STOCK');
});

test('C3-3: selling exactly AT min_price succeeds', async () => {
  const inv = await createInventoryWithMin({ qty: 5, selling: 10000, min: 9000 });

  const res = await api(base, 'POST', '/sales', {
    token: ownerAToken,
    body: {
      sale_type: 'CASH',
      items:     [{ inventory_id: inv.id, quantity: 1, unit_price: 9000 }],
    },
  });
  assert.strictEqual(res.status, 201, 'price equal to the floor must be accepted');

  const after = await db.inventory.findUnique({ where: { id: inv.id } });
  assert.strictEqual(after.quantity, 4, 'the accepted sale consumes exactly one unit');
});

test('C3-3: selling above min_price succeeds', async () => {
  const inv = await createInventoryWithMin({ qty: 5, selling: 10000, min: 9000 });

  const res = await api(base, 'POST', '/sales', {
    token: ownerAToken,
    body: {
      sale_type: 'CASH',
      items:     [{ inventory_id: inv.id, quantity: 1, unit_price: 12000 }],
    },
  });
  assert.strictEqual(res.status, 201, 'price above the floor must be accepted');
});

test('C3-3: items without min_price keep the legacy behavior — no floor imposed', async () => {
  const inv = await createInventoryWithMin({ qty: 5, selling: 10000, min: null });

  const res = await api(base, 'POST', '/sales', {
    token: ownerAToken,
    body: {
      sale_type: 'CASH',
      items:     [{ inventory_id: inv.id, quantity: 1, unit_price: 7000 }],
    },
  });
  assert.strictEqual(res.status, 201, 'an item without min_price must sell at any price exactly as before');
});