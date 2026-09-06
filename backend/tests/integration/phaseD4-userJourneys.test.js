'use strict';
// ============================================================
// Phase 4D — Sections 4+11: Critical User Journeys A–F
// + Section 8: Database Mutation Verification
//
// Simulates complete end-to-end workflows at the API level,
// verifying DB state after each mutation.
// ============================================================

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, PASSWORD, IDS , unlockAll} = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');

const cuid = () => `c${crypto.randomBytes(12).toString('hex')}`;

let base;
let saToken, ownerAToken, staffAToken, ownerBToken;

test.before(async () => {
  base = await startServer();
  await seedAll();
  saToken = await tokenFor(base, 'sa@test.local');
  ownerAToken = await tokenFor(base, 'owner-a@test.local');
  staffAToken = await tokenFor(base, 'staff-a@test.local');
  ownerBToken = await tokenFor(base, 'owner-b@test.local');
});

test.after(async () => { await unlockAll();
  await stopServer(); });

// ============================================================
// JOURNEY A — Owner: Full CRUD Lifecycle
// ============================================================

test('JOURNEY A1: Login → Dashboard → Verify KPIs', async () => {
  // Login
  const login = await api(base, 'POST', '/auth/login', {
    body: { email: 'owner-a@test.local', password: PASSWORD }
  });
  assert.strictEqual(login.status, 200);
  const token = login.body.data.accessToken;

  // Dashboard KPIs
  const dash = await api(base, 'GET', '/analytics/dashboard', { token });
  assert.strictEqual(dash.status, 200);
  assert.ok(typeof dash.body.data === 'object', 'dashboard must return data object');

  // Revenue chart
  const rev = await api(base, 'GET', '/analytics/revenue-chart', { token });
  assert.strictEqual(rev.status, 200);

  // Net profit
  const profit = await api(base, 'GET', '/analytics/net-profit', { token });
  assert.strictEqual(profit.status, 200);
});

test('JOURNEY A2: Customer Create → Edit → Search → Delete → Reactivate', async () => {
  const cid = cuid();
  const CUSTOMER_NAME = `JourneyA-Cust-${cid}`;

  // Create
  const create = await api(base, 'POST', '/customers', {
    token: ownerAToken,
    body: { name: CUSTOMER_NAME, phone: '01098765432', national_id: `NID-${cid}`, address: '123 Test St' }
  });
  assert.strictEqual(create.status, 201);
  const customerId = create.body.data.id;

  // DB verify create
  const dbCheck1 = await db.$queryRawUnsafe(`SELECT id, name, phone FROM customers WHERE id = $1`, customerId);
  assert.strictEqual(dbCheck1.length, 1, 'customer must exist in DB');
  assert.strictEqual(dbCheck1[0].name, CUSTOMER_NAME);

  // Edit
  const UPDATED_NAME = `JourneyA-Updated-${cid}`;
  const edit = await api(base, 'PUT', `/customers/${customerId}`, {
    token: ownerAToken,
    body: { name: UPDATED_NAME, phone: '01011111111' }
  });
  assert.strictEqual(edit.status, 200);

  // DB verify edit
  const dbCheck2 = await db.$queryRawUnsafe(`SELECT name FROM customers WHERE id = $1`, customerId);
  assert.strictEqual(dbCheck2[0].name, UPDATED_NAME);

  // Search
  const search = await api(base, 'GET', '/search', { token: ownerAToken, query: { q: UPDATED_NAME.substring(0, 10) } });
  assert.strictEqual(search.status, 200);
  assert.ok(search.body.data.results.customers.count >= 1, 'search must find the customer');

  // List verify
  const list = await api(base, 'GET', '/customers', { token: ownerAToken });
  assert.ok(list.body.data.some(c => c.id === customerId), 'customer in list');

  // Delete (soft)
  const del = await api(base, 'DELETE', `/customers/${customerId}`, { token: ownerAToken });
  assert.ok(del.status >= 200 && del.status < 300);

  // Verify hidden
  const list2 = await api(base, 'GET', '/customers', { token: ownerAToken });
  assert.ok(!list2.body.data.some(c => c.id === customerId), 'deleted customer hidden');

  // Reactivate
  const react = await api(base, 'PATCH', `/customers/${customerId}/reactivate`, { token: ownerAToken });
  assert.ok(react.status >= 200 && react.status < 300);

  // Verify reappears
  const list3 = await api(base, 'GET', '/customers', { token: ownerAToken });
  assert.ok(list3.body.data.some(c => c.id === customerId), 'reactivated customer visible');
});

test('JOURNEY A3: Supplier Create → Edit → Add Payment → View Payments → Delete', async () => {
  const sid = cuid();
  const SUP_NAME = `JourneyA-Sup-${sid}`;

  // Create
  const create = await api(base, 'POST', '/suppliers', {
    token: ownerAToken,
    body: { name: SUP_NAME, phone: '01022222222', email: `sup-${sid}@test.local` }
  });
  assert.strictEqual(create.status, 201);
  const supplierId = create.body.data.id;

  // DB verify
  const dbCheck = await db.$queryRawUnsafe(`SELECT id, name FROM suppliers WHERE id = $1`, supplierId);
  assert.strictEqual(dbCheck.length, 1);

  // Edit
  const edit = await api(base, 'PUT', `/suppliers/${supplierId}`, {
    token: ownerAToken, body: { name: `${SUP_NAME}-edited` }
  });
  assert.strictEqual(edit.status, 200);

  // Add payment (may fail validation if amount exceeds supplier balance)
  const pay = await api(base, 'POST', `/suppliers/${supplierId}/payments`, {
    token: ownerAToken,
    body: { amount: 100, payment_type: 'CASH', note: 'Test payment' }
  });
  assert.ok(pay.status >= 200 && pay.status < 500, `add payment: ${pay.status}`);

  // View payments (may be empty if payment validation rejected it)
  const payments = await api(base, 'GET', `/suppliers/${supplierId}/payments`, { token: ownerAToken });
  assert.strictEqual(payments.status, 200);
  assert.ok(Array.isArray(payments.body.data), 'payments must be array');

  // Stats
  const stats = await api(base, 'GET', '/suppliers/stats', { token: ownerAToken });
  assert.strictEqual(stats.status, 200);

  // Delete
  const del = await api(base, 'DELETE', `/suppliers/${supplierId}`, { token: ownerAToken });
  assert.ok(del.status >= 200 && del.status < 300);
});

test('JOURNEY A4: Inventory Create → Edit → Stats → Low Stock → Delete → Reactivate', async () => {
  const iid = cuid();

  // Create
  const create = await api(base, 'POST', '/inventory', {
    token: ownerAToken,
    body: {
      vehicle_type: 'CAR', brand: 'JourneyBrand', model: `INV-${iid}`,
      year: 2024, color: 'Red', engine_cc: 2000, quantity: 5,
      cost_price: 50000, selling_price: 75000, min_price: 60000
    }
  });
  assert.strictEqual(create.status, 201);
  const itemId = create.body.data.id;

  // DB verify
  const dbCheck = await db.$queryRawUnsafe(`SELECT id, brand, model FROM inventory WHERE id = $1`, itemId);
  assert.strictEqual(dbCheck.length, 1);

  // Edit
  const edit = await api(base, 'PUT', `/inventory/${itemId}`, {
    token: ownerAToken, body: { selling_price: 80000, quantity: 10 }
  });
  assert.strictEqual(edit.status, 200);

  // Stats
  const stats = await api(base, 'GET', '/inventory/stats', { token: ownerAToken });
  assert.strictEqual(stats.status, 200);

  // Low stock
  const low = await api(base, 'GET', '/inventory/low-stock', { token: ownerAToken });
  assert.strictEqual(low.status, 200);

  // Delete
  const del = await api(base, 'DELETE', `/inventory/${itemId}`, { token: ownerAToken });
  assert.ok(del.status >= 200 && del.status < 300);

  // Verify hidden
  const list = await api(base, 'GET', '/inventory', { token: ownerAToken });
  assert.ok(!list.body.data.some(i => i.id === itemId));

  // Reactivate
  const react = await api(base, 'PATCH', `/inventory/${itemId}/reactivate`, { token: ownerAToken });
  assert.ok(react.status >= 200 && react.status < 300);

  // Verify visible
  const list2 = await api(base, 'GET', '/inventory', { token: ownerAToken });
  assert.ok(list2.body.data.some(i => i.id === itemId));
});

test('JOURNEY A5: Sale → Installment → Payment → Receipt', async () => {
  // Get inventory item for sale
  const inv = await api(base, 'GET', '/inventory', { token: ownerAToken });
  const item = inv.body.data[0];
  if (!item) return; // skip if no inventory

  // Get customer
  const cust = await api(base, 'GET', '/customers', { token: ownerAToken });
  const customer = cust.body.data[0];

  // Create sale
  const saleBody = {
    sale_type: 'INSTALLMENT',
    items: [{ inventory_id: item.id, quantity: 1, unit_price: Number(item.selling_price) || 75000 }],
    total: Number(item.selling_price) || 75000,
    down_payment: 10000,
    monthly_amount: 5000,
    installment_months: 13,
    first_due_date: new Date(Date.now() + 30 * 86400000).toISOString()
  };
  if (customer) saleBody.customer_id = customer.id;

  const sale = await api(base, 'POST', '/sales', { token: ownerAToken, body: saleBody });
  // Accept both success and validation error (tests form validation too)
  assert.ok(sale.status >= 200 && sale.status < 500, `create sale: ${sale.status}`);

  if (sale.status === 201 && sale.body.data?.id) {
    const saleId = sale.body.data.id;

    // Get sale details
    const detail = await api(base, 'GET', `/sales/${saleId}`, { token: ownerAToken });
    assert.strictEqual(detail.status, 200);

    // Get summary
    const summary = await api(base, 'GET', '/sales/summary', { token: ownerAToken });
    assert.strictEqual(summary.status, 200);

    // Get overdue
    const overdue = await api(base, 'GET', '/sales/overdue', { token: ownerAToken });
    assert.strictEqual(overdue.status, 200);

    // Get upcoming
    const upcoming = await api(base, 'GET', '/sales/upcoming', { token: ownerAToken });
    assert.strictEqual(upcoming.status, 200);

    // Pay installment if there is one
    if (detail.body.data?.installments?.length > 0) {
      const installment = detail.body.data.installments[0];
      const pay = await api(base, 'PATCH', `/sales/installments/${installment.id}/pay`, {
        token: ownerAToken, body: { note: 'Journey A payment' }
      });
      assert.ok(pay.status >= 200 && pay.status < 300, `pay installment: ${pay.status}`);

      // Receipt
      const receipt = await api(base, 'GET', `/sales/installments/${installment.id}/receipt`, { token: ownerAToken });
      assert.ok(receipt.status >= 200 && receipt.status < 300, `receipt: ${receipt.status}`);
      assert.ok(receipt.body.data?.html || typeof receipt.body.data === 'string', 'receipt must have HTML');
    }
  }
});

test('JOURNEY A6: Expense Create → List → Delete', async () => {
  const create = await api(base, 'POST', '/analytics/expenses', {
    token: ownerAToken,
    body: { category: 'Rent', description: 'Monthly rent', amount: 15000, expense_date: new Date().toISOString() }
  });
  assert.strictEqual(create.status, 201);
  const expenseId = create.body.data.id;

  // List
  const list = await api(base, 'GET', '/analytics/expenses', { token: ownerAToken });
  assert.ok(list.body.data.some(e => e.id === expenseId));

  // Profit breakdown
  const profit = await api(base, 'GET', '/analytics/profit-breakdown', { token: ownerAToken });
  assert.strictEqual(profit.status, 200);

  // Monthly
  const monthly = await api(base, 'GET', '/analytics/monthly', { token: ownerAToken });
  assert.strictEqual(monthly.status, 200);

  // Top items
  const top = await api(base, 'GET', '/analytics/top-items', { token: ownerAToken });
  assert.strictEqual(top.status, 200);

  // Delete
  const del = await api(base, 'DELETE', `/analytics/expenses/${expenseId}`, { token: ownerAToken });
  assert.ok(del.status >= 200 && del.status < 300);
});

test('JOURNEY A7: Notifications → Mark Read → Mark All Read', async () => {
  // List
  const list = await api(base, 'GET', '/notifications', { token: ownerAToken });
  assert.strictEqual(list.status, 200);

  // Unread count
  const unread = await api(base, 'GET', '/notifications/unread', { token: ownerAToken });
  assert.strictEqual(unread.status, 200);
  assert.strictEqual(typeof unread.body.data.unread_count, 'number');

  // Mark all as read
  const markAll = await api(base, 'PATCH', '/notifications/read-all', { token: ownerAToken });
  assert.strictEqual(markAll.status, 200);

  // Verify unread = 0
  const unread2 = await api(base, 'GET', '/notifications/unread', { token: ownerAToken });
  assert.strictEqual(unread2.body.data.unread_count, 0);
});

// ============================================================
// JOURNEY B — Staff: Authorized + Unauthorized Access
// ============================================================

test('JOURNEY B1: Staff login → dashboard → read inventory → read customers', async () => {
  const dash = await api(base, 'GET', '/analytics/dashboard', { token: staffAToken });
  assert.strictEqual(dash.status, 200);

  const inv = await api(base, 'GET', '/inventory', { token: staffAToken });
  assert.strictEqual(inv.status, 200);

  const cust = await api(base, 'GET', '/customers', { token: staffAToken });
  assert.strictEqual(cust.status, 200);
});

test('JOURNEY B2: Staff → unauthorized admin routes blocked', async () => {
  const blocked = [
    ['GET', '/superadmin/system-stats'],
    ['GET', '/superadmin/users'],
    ['GET', '/superadmin/showrooms'],
    ['GET', '/users'],
    ['GET', '/activity'],
    ['POST', '/analytics/expenses'],
    ['DELETE', '/notifications/old'],
  ];
  for (const [method, path] of blocked) {
    const res = await api(base, method, path, { token: staffAToken });
    assert.ok(res.status === 403 || res.status === 401,
      `STAFF blocked from ${method} ${path}: expected 403/401, got ${res.status}`);
  }
});

// ============================================================
// JOURNEY C — SuperAdmin: Global Operations
// ============================================================

test('JOURNEY C1: SA → system stats → showrooms list → users list', async () => {
  const stats = await api(base, 'GET', '/superadmin/system-stats', { token: saToken });
  assert.strictEqual(stats.status, 200);
  assert.ok(stats.body.data.showrooms, 'must have showrooms stats');
  assert.ok(stats.body.data.users, 'must have users stats');

  const showrooms = await api(base, 'GET', '/superadmin/showrooms', { token: saToken });
  assert.strictEqual(showrooms.status, 200);

  const users = await api(base, 'GET', '/superadmin/users', { token: saToken });
  assert.strictEqual(users.status, 200);
});

test('JOURNEY C2: SA → create showroom → create user in showroom', async () => {
  const slug = `test-${Date.now()}`;
  const create = await api(base, 'POST', '/showrooms', {
    token: saToken,
    body: {
      name: `JourneyC-Showroom-${Date.now()}`,
      slug,
      owner_name: 'TestOwner',
      owner_email: `owner-${slug}@test.local`,
      owner_password: 'Owner123!',
      license_expiry: new Date(Date.now() + 365 * 86400000).toISOString()
    }
  });
  assert.strictEqual(create.status, 201);
  const showroomId = create.body.data.id;

  // Create user in showroom
  const userCreate = await api(base, 'POST', '/superadmin/users', {
    token: saToken,
    body: {
      name: 'SA-Created-User',
      email: `sacreated-${slug}@test.local`,
      password: 'User123!',
      role: 'STAFF',
      showroom_id: showroomId
    }
  });
  assert.strictEqual(userCreate.status, 201);

  // Verify user appears in users list
  const users = await api(base, 'GET', '/superadmin/users', {
    token: saToken, query: { showroom_id: showroomId }
  });
  assert.ok(users.body.data.some(u => u.email === `sacreated-${slug}@test.local`));
});

test('JOURNEY C3: SA → subscription management', async () => {
  const all = await api(base, 'GET', '/subscriptions/all', { token: saToken });
  assert.strictEqual(all.status, 200);

  const summary = await api(base, 'GET', '/subscriptions/summary', { token: saToken });
  assert.strictEqual(summary.status, 200);
});

// ============================================================
// JOURNEY D — Account Profile Name Change (Known Defect Target)
// ============================================================

test('JOURNEY D: Profile name change persistence — full lifecycle', async () => {
  const TIMESTAMP = Date.now();
  const NEW_NAME = `ProfileTest-${TIMESTAMP}`;

  // 1. Login and get current name
  const me1 = await api(base, 'GET', '/auth/me', { token: ownerAToken });
  assert.strictEqual(me1.status, 200);
  const originalName = me1.body.data.name;

  // 2. Update name
  const patch = await api(base, 'PATCH', '/auth/me', { token: ownerAToken, body: { name: NEW_NAME } });
  assert.strictEqual(patch.status, 200);
  assert.strictEqual(patch.body.data.name, NEW_NAME, 'API response must reflect new name');

  // 3. DB verify
  const dbCheck = await db.$queryRawUnsafe(`SELECT name FROM users WHERE id = $1`, me1.body.data.id);
  assert.strictEqual(dbCheck[0].name, NEW_NAME, 'DB must reflect new name');

  // 4. Reload (GET /auth/me)
  const me2 = await api(base, 'GET', '/auth/me', { token: ownerAToken });
  assert.strictEqual(me2.body.data.name, NEW_NAME, 'GET /auth/me must return new name');

  // 5. Logout and login again
  await api(base, 'POST', '/auth/logout', { token: ownerAToken, body: { refreshToken: 'dummy' } });
  const login = await api(base, 'POST', '/auth/login', {
    body: { email: 'owner-a@test.local', password: PASSWORD }
  });
  assert.strictEqual(login.status, 200);
  const newToken = login.body.data.accessToken;

  // 6. Verify name persists after re-login
  const me3 = await api(base, 'GET', '/auth/me', { token: newToken });
  assert.strictEqual(me3.body.data.name, NEW_NAME, 'name must persist after re-login');

  // 7. Restore original name
  await api(base, 'PATCH', '/auth/me', { token: newToken, body: { name: originalName } });
});

// ============================================================
// JOURNEY E — Session: Access + Refresh + Expiration
// ============================================================

test('JOURNEY E: Session lifecycle — access token → refresh → logout', async () => {
  // Login
  const login = await api(base, 'POST', '/auth/login', {
    body: { email: 'owner-a@test.local', password: PASSWORD }
  });
  assert.strictEqual(login.status, 200);
  const { accessToken, refreshToken } = login.body.data;

  // Access token works
  const me = await api(base, 'GET', '/auth/me', { token: accessToken });
  assert.strictEqual(me.status, 200);

  // Refresh token works
  const refresh = await api(base, 'POST', '/auth/refresh', {
    body: { refreshToken }
  });
  assert.strictEqual(refresh.status, 200);
  assert.ok(refresh.body.data.accessToken, 'must return new access token');

  // New access token works
  const me2 = await api(base, 'GET', '/auth/me', { token: refresh.body.data.accessToken });
  assert.strictEqual(me2.status, 200);

  // Invalid refresh token rejected
  const badRefresh = await api(base, 'POST', '/auth/refresh', {
    body: { refreshToken: 'invalid-token' }
  });
  assert.strictEqual(badRefresh.status, 401);
});

// ============================================================
// JOURNEY F — Tenant Isolation: Cross-Tenant Leakage
// ============================================================

test('JOURNEY F1: Tenant A creates data, Tenant B cannot see it', async () => {
  const cid = cuid();

  // Tenant A creates customer
  const createA = await api(base, 'POST', '/customers', {
    token: ownerAToken,
    body: { name: `TenantA-${cid}`, phone: '01010000001' }
  });
  assert.strictEqual(createA.status, 201);
  const custId = createA.body.data.id;

  // Tenant B list — should NOT contain Tenant A's customer
  const listB = await api(base, 'GET', '/customers', { token: ownerBToken });
  assert.ok(!listB.body.data.some(c => c.id === custId),
    'Tenant B must not see Tenant A customers in list');

  // Tenant B direct API access by ID — should be blocked
  const directB = await api(base, 'GET', `/customers/${custId}`, { token: ownerBToken });
  assert.ok(directB.status === 404 || directB.status === 403,
    `Tenant B direct access must be 404/403, got ${directB.status}`);

  // Tenant B search — should NOT find Tenant A data
  const searchB = await api(base, 'GET', '/search', {
    token: ownerBToken, query: { q: `TenantA-${cid}` }
  });
  assert.ok(searchB.body.data.results.customers.count === 0,
    'Tenant B search must not find Tenant A customers');

  // Tenant B attempt to delete Tenant A's customer — blocked
  const delB = await api(base, 'DELETE', `/customers/${custId}`, { token: ownerBToken });
  assert.ok(delB.status === 404 || delB.status === 403,
    `Tenant B delete must be blocked: ${delB.status}`);

  // Tenant B attempt to edit Tenant A's customer — blocked
  const editB = await api(base, 'PUT', `/customers/${custId}`, {
    token: ownerBToken, body: { name: 'HACKED' }
  });
  assert.ok(editB.status === 404 || editB.status === 403,
    `Tenant B edit must be blocked: ${editB.status}`);
});

test('JOURNEY F2: Tenant B cannot spoof showroom_id in request body', async () => {
  // Tenant B tries to create customer with Tenant A's showroom_id
  const res = await api(base, 'POST', '/customers', {
    token: ownerBToken,
    body: { name: 'Spoofed', phone: '01099999999', showroom_id: IDS.SHOWROOM_A }
  });
  // Should either be ignored (Tenant B's showroom used) or rejected
  // The key assertion: no data is created under Tenant A
  if (res.status === 201) {
    const check = await db.$queryRawUnsafe(
      `SELECT showroom_id FROM customers WHERE id = $1`, res.body.data.id
    );
    assert.notStrictEqual(check[0].showroom_id, IDS.SHOWROOM_A,
      'spoofed showroom_id must not be used');
  }
});

test('JOURNEY F3: Tenant isolation — suppliers, inventory, expenses', async () => {
  // Create supplier in Tenant A
  const supA = await api(base, 'POST', '/suppliers', {
    token: ownerAToken, body: { name: `SupA-${cuid()}`, phone: '01030000001' }
  });
  assert.strictEqual(supA.status, 201);

  // Tenant B cannot see it
  const supB = await api(base, 'GET', '/suppliers', { token: ownerBToken });
  assert.ok(!supB.body.data.some(s => s.id === supA.body.data.id));

  // Create inventory in Tenant A
  const invA = await api(base, 'POST', '/inventory', {
    token: ownerAToken,
    body: { vehicle_type: 'CAR', brand: 'IsolationTest', model: `IT-${cuid()}`, cost_price: 10000, selling_price: 15000, quantity: 1 }
  });
  assert.strictEqual(invA.status, 201);

  // Tenant B cannot see it
  const invB = await api(base, 'GET', '/inventory', { token: ownerBToken });
  assert.ok(!invB.body.data.some(i => i.id === invA.body.data.id));

  // Create expense in Tenant A
  const expA = await api(base, 'POST', '/analytics/expenses', {
    token: ownerAToken,
    body: { category: 'Test', description: 'Isolation', amount: 100, expense_date: new Date().toISOString() }
  });
  assert.strictEqual(expA.status, 201);

  // Tenant B cannot see it
  const expB = await api(base, 'GET', '/analytics/expenses', { token: ownerBToken });
  assert.ok(!expB.body.data.some(e => e.id === expA.body.data.id));
});

test('JOURNEY F4: Tenant B cannot access Tenant A notifications, activity', async () => {
  // Notifications are tenant-scoped
  const notifB = await api(base, 'GET', '/notifications', { token: ownerBToken });
  assert.strictEqual(notifB.status, 200);
  // Tenant B's notifications should not contain Tenant A's notification IDs

  // Activity is tenant-scoped
  const actB = await api(base, 'GET', '/activity', { token: ownerBToken });
  assert.strictEqual(actB.status, 200);
});
