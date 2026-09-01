'use strict';
// Phase 0.5 — authorization PARITY contract for the CURRENT role model
// (SUPER_ADMIN / OWNER / STAFF). Regression contract BEFORE Phase 1.
const test = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, api, db } = require('../helpers/harness');
const { seedAll, tokenFor, IDS } = require('../helpers/fixtures');

let base;
let ownerA, staffA, sa;

test.before(async () => {
  base = await startServer();
  await seedAll();
  ownerA = await tokenFor(base, 'owner-a@test.local');
  staffA = await tokenFor(base, 'staff-a@test.local');
  sa = await tokenFor(base, 'sa@test.local');
});

test.after(async () => {
  await stopServer();
});

test('parity CURRENT: unauthenticated protected route → 401 TOKEN_MISSING', async () => {
  const r = await api(base, 'GET', '/suppliers');
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.code, 'TOKEN_MISSING');
});

test('parity CURRENT: STAFF CAN read shared tenant data (GET /suppliers)', async () => {
  // fixture supA1 is intentionally inactive (reactivate tests below),
  // and the default list only returns active suppliers — include_inactive
  // mirrors the current API contract without changing fixture state.
  const r = await api(base, 'GET', '/suppliers?include_inactive=true', { token: staffA });
  assert.strictEqual(r.status, 200);
  const ids = r.body.data.map((s) => s.id);
  assert.deepStrictEqual(ids, [IDS.supA1]);
});

test('parity CURRENT: STAFF CANNOT perform owner-only action (supplier reactivate) → 403 INSUFFICIENT_ROLE', async () => {
  const r = await api(base, 'PATCH', `/suppliers/${IDS.supA1}/reactivate`, { token: staffA });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'INSUFFICIENT_ROLE');
});

test('parity CURRENT: OWNER CAN perform owner-only action (supplier reactivate) → 200', async () => {
  const r = await api(base, 'PATCH', `/suppliers/${IDS.supA1}/reactivate`, { token: ownerA });
  assert.strictEqual(r.status, 200);
});

test('parity CURRENT: STAFF CANNOT cancel a sale (ownerOnly) → 403', async () => {
  const r = await api(base, 'PATCH', `/sales/${IDS.saleCashA}/cancel`, { token: staffA });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'INSUFFICIENT_ROLE');
});

test('parity CURRENT: OWNER CAN cancel a CASH sale; DB state consistent (status + inventory restored)', async () => {
  const r = await api(base, 'PATCH', `/sales/${IDS.saleCashA}/cancel`, { token: ownerA });
  assert.strictEqual(r.status, 200);

  const sale = await db.baseClient.sale.findUnique({ where: { id: IDS.saleCashA } });
  assert.strictEqual(sale.status, 'CANCELLED');

  const inv = await db.baseClient.inventory.findUnique({ where: { id: IDS.itemA1 } });
  assert.strictEqual(inv.quantity, 5, 'cancelled sale must restore full quantity');
  assert.strictEqual(inv.status, 'IN_STOCK');
});

test('parity CURRENT: non-SUPER_ADMIN blocked from superadmin surface → 403', async () => {
  const r = await api(base, 'GET', '/superadmin/system-stats', { token: ownerA });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'INSUFFICIENT_ROLE');
});

test('parity CURRENT: SUPER_ADMIN CAN access superadmin surface → 200', async () => {
  const r = await api(base, 'GET', '/superadmin/system-stats', { token: sa });
  assert.strictEqual(r.status, 200);
});