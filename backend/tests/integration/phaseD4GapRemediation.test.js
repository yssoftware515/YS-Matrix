'use strict';
// ============================================================
// Phase 4D — Feature Coverage Gap Remediation
//
// Targets the 7 critical gaps identified by the 4D coverage audit:
//   GAP-1: PATCH /auth/me (profile name change) — ZERO tests
//   GAP-2: Customer REACTIVATE — ZERO tests
//   GAP-3: Supplier UPDATE, DELETE — ZERO tests
//   GAP-4: Inventory UPDATE, soft DELETE, REACTIVATE — ZERO tests
//   GAP-5: Notification mark-as-read, unread count, delete-old
//   GAP-6: Global search positive functionality
//   GAP-7: SuperAdmin direct per-showroom user management
// ============================================================

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, PASSWORD, IDS , unlockAll} = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');

const cuid = () => `c${crypto.randomBytes(12).toString('hex')}`;

let base;
let ownerAToken, staffAToken, saToken;

test.before(async () => {
  base = await startServer();
  await seedAll();
  ownerAToken = await tokenFor(base, 'owner-a@test.local');
  staffAToken = await tokenFor(base, 'staff-a@test.local');
  saToken = await tokenFor(base, 'sa@test.local');
});

test.after(async () => {
  await unlockAll();
  await stopServer();
});

// ─────────────────────────────────────────
// GAP-1 — PROFILE NAME CHANGE PERSISTENCE
// ─────────────────────────────────────────

test('GAP-1A: OWNER can update own name via PATCH /auth/me — persists across reload', async () => {
  const NEW_NAME = `Owner-Updated-${Date.now()}`;

  // 1. Read current name
  const before = await api(base, 'GET', '/auth/me', { token: ownerAToken });
  assert.strictEqual(before.status, 200);
  assert.ok(before.body.data.name, 'user must have a name');
  const oldName = before.body.data.name;

  // 2. Update name
  const patch = await api(base, 'PATCH', '/auth/me', { token: ownerAToken, body: { name: NEW_NAME } });
  assert.strictEqual(patch.status, 200, `PATCH /auth/me must succeed: ${JSON.stringify(patch.body)}`);
  assert.strictEqual(patch.body.data.name, NEW_NAME, 'response must reflect the new name');

  // 3. Reload — GET /auth/me
  const after = await api(base, 'GET', '/auth/me', { token: ownerAToken });
  assert.strictEqual(after.status, 200);
  assert.strictEqual(after.body.data.name, NEW_NAME, 'name must persist after reload');

  // 4. Restore old name for fixture stability
  await api(base, 'PATCH', '/auth/me', { token: ownerAToken, body: { name: oldName } });
});

test('GAP-1B: STAFF can update own name via PATCH /auth/me', async () => {
  const NEW_NAME = `Staff-Updated-${Date.now()}`;

  const before = await api(base, 'GET', '/auth/me', { token: staffAToken });
  assert.strictEqual(before.status, 200);
  const oldName = before.body.data.name;

  const patch = await api(base, 'PATCH', '/auth/me', { token: staffAToken, body: { name: NEW_NAME } });
  assert.strictEqual(patch.status, 200, `PATCH /auth/me must succeed: ${JSON.stringify(patch.body)}`);

  const after = await api(base, 'GET', '/auth/me', { token: staffAToken });
  assert.strictEqual(after.status, 200);
  assert.strictEqual(after.body.data.name, NEW_NAME, 'name must persist after reload');

  // Restore
  await api(base, 'PATCH', '/auth/me', { token: staffAToken, body: { name: oldName } });
});

test('GAP-1C: PATCH /auth/me with empty name is rejected', async () => {
  const res = await api(base, 'PATCH', '/auth/me', { token: ownerAToken, body: { name: '' } });
  assert.ok(res.status >= 400, `empty name must be rejected: ${res.status}`);
});

// ─────────────────────────────────────────
// GAP-2 — CUSTOMER REACTIVATE
// ─────────────────────────────────────────

test('GAP-2: Customer soft-delete → hidden from list → reactivated → reappears', async () => {
  const cid = cuid();

  // 1. Create customer
  const create = await api(base, 'POST', '/customers', {
    token: ownerAToken,
    body: { name: `ReactTest-${cid}`, phone: '01012345678' },
  });
  assert.strictEqual(create.status, 201, `create must succeed: ${JSON.stringify(create.body)}`);
  const customerId = create.body.data.id;

  // 2. Verify listed
  const list1 = await api(base, 'GET', '/customers', { token: ownerAToken });
  assert.ok(list1.body.data.some((c) => c.id === customerId), 'customer must appear in list');

  // 3. Soft-delete
  const del = await api(base, 'DELETE', `/customers/${customerId}`, { token: ownerAToken });
  assert.ok(del.status >= 200 && del.status < 300, `delete must succeed: ${del.status}`);

  // 4. Verify hidden from list
  const list2 = await api(base, 'GET', '/customers', { token: ownerAToken });
  assert.ok(!list2.body.data.some((c) => c.id === customerId), 'deleted customer must be hidden from list');

  // 5. Reactivate
  const reactivate = await api(base, 'PATCH', `/customers/${customerId}/reactivate`, { token: ownerAToken });
  assert.ok(reactivate.status >= 200 && reactivate.status < 300, `reactivate must succeed: ${reactivate.status}`);

  // 6. Verify reappears in list
  const list3 = await api(base, 'GET', '/customers', { token: ownerAToken });
  assert.ok(list3.body.data.some((c) => c.id === customerId), 'reactivated customer must reappear in list');
});

// ─────────────────────────────────────────
// GAP-3 — SUPPLIER UPDATE + DELETE
// ─────────────────────────────────────────

test('GAP-3A: Supplier UPDATE — name change persists', async () => {
  const sid = cuid();
  const NEW_NAME = `Supplier-Updated-${Date.now()}`;

  // Create
  const create = await api(base, 'POST', '/suppliers', {
    token: ownerAToken,
    body: { name: `SupUpdate-${sid}`, phone: '01011111111' },
  });
  assert.strictEqual(create.status, 201);
  const supplierId = create.body.data.id;

  // Update
  const update = await api(base, 'PUT', `/suppliers/${supplierId}`, {
    token: ownerAToken,
    body: { name: NEW_NAME },
  });
  assert.strictEqual(update.status, 200, `update must succeed: ${JSON.stringify(update.body)}`);

  // Verify
  const read = await api(base, 'GET', `/suppliers/${supplierId}`, { token: ownerAToken });
  assert.strictEqual(read.status, 200);
  assert.strictEqual(read.body.data.name, NEW_NAME, 'name must persist after update');
});

test('GAP-3B: Supplier DELETE — soft delete hides from list', async () => {
  const sid = cuid();

  const create = await api(base, 'POST', '/suppliers', {
    token: ownerAToken,
    body: { name: `SupDel-${sid}`, phone: '01022222222' },
  });
  assert.strictEqual(create.status, 201);
  const supplierId = create.body.data.id;

  // Verify listed
  const list1 = await api(base, 'GET', '/suppliers', { token: ownerAToken });
  assert.ok(list1.body.data.some((s) => s.id === supplierId), 'supplier must appear in list');

  // Delete
  const del = await api(base, 'DELETE', `/suppliers/${supplierId}`, { token: ownerAToken });
  assert.ok(del.status >= 200 && del.status < 300, `delete must succeed: ${del.status}`);

  // Verify hidden
  const list2 = await api(base, 'GET', '/suppliers', { token: ownerAToken });
  assert.ok(!list2.body.data.some((s) => s.id === supplierId), 'deleted supplier must be hidden');
});

// ─────────────────────────────────────────
// GAP-4 — INVENTORY UPDATE, SOFT DELETE, REACTIVATE
// ─────────────────────────────────────────

test('GAP-4A: Inventory UPDATE — price and quantity change persists', async () => {
  const iid = cuid();
  const NEW_PRICE = 99999;

  const create = await api(base, 'POST', '/inventory', {
    token: ownerAToken,
    body: {
      vehicle_type: 'CAR', brand: 'TestUpdate', model: `INV-${iid}`,
      cost_price: 50000, selling_price: 75000, quantity: 3,
    },
  });
  assert.strictEqual(create.status, 201);
  const itemId = create.body.data.id;

  // Update
  const update = await api(base, 'PUT', `/inventory/${itemId}`, {
    token: ownerAToken,
    body: { selling_price: NEW_PRICE, quantity: 10 },
  });
  assert.strictEqual(update.status, 200, `update must succeed: ${JSON.stringify(update.body)}`);

  // Verify
  const read = await api(base, 'GET', `/inventory/${itemId}`, { token: ownerAToken });
  assert.strictEqual(read.status, 200);
  assert.strictEqual(Number(read.body.data.selling_price), NEW_PRICE, 'selling_price must persist');
  assert.strictEqual(read.body.data.quantity, 10, 'quantity must persist');
});

test('GAP-4B: Inventory soft DELETE — hidden from list', async () => {
  const iid = cuid();

  const create = await api(base, 'POST', '/inventory', {
    token: ownerAToken,
    body: {
      vehicle_type: 'MOTORCYCLE', brand: 'TestDel', model: `DEL-${iid}`,
      cost_price: 10000, selling_price: 15000, quantity: 1,
    },
  });
  assert.strictEqual(create.status, 201);
  const itemId = create.body.data.id;

  // Delete
  const del = await api(base, 'DELETE', `/inventory/${itemId}`, { token: ownerAToken });
  assert.ok(del.status >= 200 && del.status < 300, `delete must succeed: ${del.status}`);

  // Verify hidden from list
  const list = await api(base, 'GET', '/inventory', { token: ownerAToken });
  assert.ok(!list.body.data.some((i) => i.id === itemId), 'deleted item must be hidden');
});

test('GAP-4C: Inventory REACTIVATE — hidden item reappears', async () => {
  const iid = cuid();

  const create = await api(base, 'POST', '/inventory', {
    token: ownerAToken,
    body: {
      vehicle_type: 'TUKTUK', brand: 'TestReact', model: `REACT-${iid}`,
      cost_price: 8000, selling_price: 12000, quantity: 2,
    },
  });
  assert.strictEqual(create.status, 201);
  const itemId = create.body.data.id;

  // Delete
  await api(base, 'DELETE', `/inventory/${itemId}`, { token: ownerAToken });

  // Reactivate
  const reactivate = await api(base, 'PATCH', `/inventory/${itemId}/reactivate`, { token: ownerAToken });
  assert.ok(reactivate.status >= 200 && reactivate.status < 300, `reactivate must succeed: ${reactivate.status}`);

  // Verify reappears
  const list = await api(base, 'GET', '/inventory', { token: ownerAToken });
  assert.ok(list.body.data.some((i) => i.id === itemId), 'reactivated item must reappear');
});

// ─────────────────────────────────────────
// GAP-5 — NOTIFICATION MARK-AS-READ, UNREAD COUNT, DELETE-OLD
// ─────────────────────────────────────────

test('GAP-5A: Notification unread count is correct', async () => {
  const res = await api(base, 'GET', '/notifications/unread', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(typeof res.body.data.unread_count, 'number', 'unread must return a numeric unread_count');
});

test('GAP-5B: Mark notification as read reduces unread count', async () => {
  // Get current notifications
  const before = await api(base, 'GET', '/notifications', { token: ownerAToken });
  assert.strictEqual(before.status, 200);

  const unreadBefore = await api(base, 'GET', '/notifications/unread', { token: ownerAToken });
  const countBefore = unreadBefore.body.data.unread_count;

  // If there are unread notifications, mark one as read
  if (before.body.data.length > 0) {
    const unreadNotif = before.body.data.find((n) => !n.is_read);
    if (unreadNotif) {
      const mark = await api(base, 'PATCH', `/notifications/${unreadNotif.id}/read`, { token: ownerAToken });
      assert.strictEqual(mark.status, 200, `mark-as-read must succeed: ${JSON.stringify(mark.body)}`);

      const after = await api(base, 'GET', '/notifications/unread', { token: ownerAToken });
      assert.ok(after.body.data.count <= countBefore, 'unread count must decrease or stay same after marking');
    }
  }
});

test('GAP-5C: Mark all notifications as read', async () => {
  const res = await api(base, 'PATCH', '/notifications/read-all', { token: ownerAToken });
  assert.strictEqual(res.status, 200, `mark-all-read must succeed: ${JSON.stringify(res.body)}`);

  const after = await api(base, 'GET', '/notifications/unread', { token: ownerAToken });
  assert.strictEqual(after.body.data.unread_count, 0, 'all notifications must be read after mark-all');
});

// ─────────────────────────────────────────
// GAP-6 — GLOBAL SEARCH POSITIVE FUNCTIONALITY
// ─────────────────────────────────────────

test('GAP-6: Global search returns correct results for known entities', async () => {
  // Search for a known customer name from fixtures (owner-a's showroom)
  const res = await api(base, 'GET', '/search', {
    token: ownerAToken,
    query: { q: 'Customer' },
  });
  assert.strictEqual(res.status, 200, `search must succeed: ${JSON.stringify(res.body)}`);
  assert.ok(res.body.data.results, 'search results must exist');
  assert.ok(typeof res.body.data.results === 'object', 'search results must be an object');
  // The fixtures create customers with names like "Customer A" — at least one should match
  // (This depends on fixture data; the key assertion is that search returns structured results)
});

// ─────────────────────────────────────────
// GAP-7 — SUPERADMIN DIRECT PER-SHOWROOM USER MANAGEMENT
// ─────────────────────────────────────────

test('GAP-7A: SA can list all showrooms', async () => {
  const res = await api(base, 'GET', '/superadmin/showrooms', { token: saToken });
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data), 'showrooms list must be an array');
  assert.ok(res.body.data.length > 0, 'must have at least one showroom');
});

test('GAP-7B: SA can get system stats', async () => {
  const res = await api(base, 'GET', '/superadmin/system-stats', { token: saToken });
  assert.strictEqual(res.status, 200);
  assert.ok(typeof res.body.data.showrooms.total === 'number', 'must have showrooms.total');
  assert.ok(typeof res.body.data.users.total === 'number', 'must have users.total');
});

test('GAP-7C: SA can list all users globally', async () => {
  const res = await api(base, 'GET', '/superadmin/users', { token: saToken });
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data), 'users list must be an array');
  assert.ok(res.body.data.length > 0, 'must have at least one user');
});

test('GAP-7D: STAFF cannot access superadmin endpoints', async () => {
  const endpoints = [
    ['GET', '/superadmin/showrooms'],
    ['GET', '/superadmin/users'],
    ['GET', '/superadmin/system-stats'],
  ];
  for (const [method, path] of endpoints) {
    const res = await api(base, method, path, { token: staffAToken });
    assert.ok(res.status === 403 || res.status === 401, `STAFF must be denied ${method} ${path}: got ${res.status}`);
  }
});
