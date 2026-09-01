'use strict';
// Phase 0.5 — REAL DATABASE tenant isolation regression (CURRENT behavior).
const test = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, api, db } = require('../helpers/harness');
const { seedAll, tokenFor, IDS } = require('../helpers/fixtures');

let base;
let ownerA, staffA, ownerB, staffB, sa;

test.before(async () => {
  base = await startServer();
  await seedAll();
  ownerA = await tokenFor(base, 'owner-a@test.local');
  staffA = await tokenFor(base, 'staff-a@test.local');
  ownerB = await tokenFor(base, 'owner-b@test.local');
  staffB = await tokenFor(base, 'staff-b@test.local');
  sa = await tokenFor(base, 'sa@test.local');
});

test.after(async () => {
  await stopServer();
});

test('isolation: OWNER A listing customers sees ONLY showroom A data', async () => {
  const r = await api(base, 'GET', '/customers', { token: ownerA });
  assert.strictEqual(r.status, 200);
  const ids = r.body.data.map((c) => c.id);
  assert.deepStrictEqual(ids, [IDS.custA1]);
});

test('isolation: STAFF B listing customers sees ONLY showroom B data', async () => {
  const r = await api(base, 'GET', '/customers', { token: staffB });
  assert.strictEqual(r.status, 200);
  const ids = r.body.data.map((c) => c.id);
  assert.deepStrictEqual(ids, [IDS.custB1]);
});

test('isolation: direct ID manipulation cannot read another showroom record (read)', async () => {
  const r = await api(base, 'GET', `/customers/${IDS.custB1}`, { token: ownerA });
  assert.strictEqual(r.status, 404, 'cross-showroom read by id must not resolve');
  assert.strictEqual(r.body.code, 'NOT_FOUND');
});

test('isolation: direct ID manipulation cannot mutate another showroom record (update)', async () => {
  const r = await api(base, 'PUT', `/customers/${IDS.custB1}`, { token: ownerA, body: { name: 'Hijacked', phone: '0' } });
  assert.strictEqual(r.status, 404, 'cross-showroom update must not resolve');
});

test('isolation: mutation through a scoped service rejects cross-showroom supplier', async () => {
  const r = await api(base, 'POST', `/suppliers/${IDS.supB1}/payments`, { token: ownerA, body: { amount: 10 } });
  assert.strictEqual(r.status, 404, 'supplier of another showroom must not resolve');
  assert.strictEqual(r.body.code, 'NOT_FOUND');
});

test('isolation: missing tenant context fails CLOSED at the Prisma layer', async () => {
  await assert.rejects(
    () => db.customer.findMany({}), // no AsyncLocalStorage context — scoped client must refuse
    /Tenant isolation violation/
  );
});

test('isolation: SUPER_ADMIN on scoped routes is locked to its own (system) showroom — no escalation', async () => {
  const r = await api(base, 'GET', '/customers', { token: sa });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.data, [], 'SUPER_ADMIN must see no tenant data on scoped tenant routes');
});

test('isolation: client-supplied mismatched showroom_id is rejected (query)', async () => {
  const r = await api(base, 'GET', `/customers?showroom_id=${IDS.showroomB}`, { token: ownerA });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'CROSS_TENANT_BLOCKED');
});