'use strict';
// ============================================================
// Phase B.3 — Customer Self-Service & Operational Completion.
// Regression coverage for the self-service surface:
//   • F1 — staff management matrix: OWNER-only surface, STAFF can
//     never list/manage users, OWNER creation blocked on this path,
//     plan users_limit enforced (create + reactivation re-check),
//     self-deactivation blocked, OWNER targets protected,
//     deactivation revokes refresh tokens immediately, foreign
//     tenant user ids resolve to 404
//   • F2 — showroom profile self-service: /onboarding/status now
//     carries address/phone/email for form prefill; OWNER updates
//     via the canonical audited PATCH /onboarding; STAFF gets 403;
//     mass-assignment of protected fields is stripped by the schema
//   • F4 — invoice print security: XSS payloads stay inert, Arabic
//     survives, the print button is CSP-nonce-based (no inline
//     onclick), the response carries a document-scoped CSP, and
//     cross-tenant invoice access is denied for JSON and HTML
//   • F6 — notification tenant isolation: one showroom's
//     notifications are never visible to another
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, PASSWORD, IDS } = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');

const PLAN_ID = 'plan-b3-limited';

let base;
let superToken, ownerAToken, staffAToken, ownerBToken;

test.before(async () => {
  base = await startServer();
  await seedAll();

  superToken  = await tokenFor(base, 'sa@test.local');
  ownerAToken = await tokenFor(base, 'owner-a@test.local');
  staffAToken = await tokenFor(base, 'staff-a@test.local');
  ownerBToken = await tokenFor(base, 'owner-b@test.local');

  await db.plan.create({
    data: {
      id: PLAN_ID, name: 'باقة B3', code: 'B3LIMITED',
      price_amount: 100, currency: 'EGP', duration_months: 1, users_limit: 2,
    },
  });
});

test.after(async () => {
  await stopServer();
});

// ─────────────────────────────────────────────
// F1 — STAFF MANAGEMENT MATRIX
// ─────────────────────────────────────────────

test('B3-F1: the users surface is OWNER-only — STAFF gets 403 on list, create and toggle', async () => {
  const staffList = await api(base, 'GET', '/users', { token: staffAToken });
  assert.strictEqual(staffList.status, 403, 'STAFF must never list tenant users');

  const staffCreate = await api(base, 'POST', '/users', {
    token: staffAToken,
    body:  { name: 'Sneaky', email: 'sneaky@test.local', password: PASSWORD },
  });
  assert.strictEqual(staffCreate.status, 403, 'STAFF must never create users');

  const staffToggle = await api(base, 'PATCH', `/users/${IDS.staffA}`, {
    token: staffAToken, body: { is_active: false },
  });
  assert.strictEqual(staffToggle.status, 403, 'STAFF must never toggle users');
});

test('B3-F1: OWNER list is tenant-scoped and creation goes through the canonical register path as STAFF', async () => {
  const list = await api(base, 'GET', '/users', { token: ownerAToken });
  assert.strictEqual(list.status, 200);
  const emails = list.body.data.map((u) => u.email);
  assert.ok(emails.includes('owner-a@test.local') && emails.includes('staff-a@test.local'), 'OWNER sees their own tenant users');
  assert.ok(!emails.includes('owner-b@test.local') && !emails.includes('staff-b@test.local'), 'foreign tenant users must not leak');

  // Attempt to smuggle a higher role through the staff-creation path.
  const create = await api(base, 'POST', '/users', {
    token: ownerAToken,
    body:  { name: 'New Staff', email: 'new-staff@test.local', password: PASSWORD, role: 'OWNER' },
  });
  assert.strictEqual(create.status, 403, 'OWNER cannot create another OWNER through this surface');
  assert.strictEqual(create.body.code, 'INSUFFICIENT_ROLE');

  const createOk = await api(base, 'POST', '/users', {
    token: ownerAToken,
    body:  { name: 'New Staff', email: 'new-staff@test.local', password: PASSWORD, role: 'STAFF' },
  });
  assert.strictEqual(createOk.status, 201, 'OWNER can create a STAFF member');
  assert.strictEqual(createOk.body.data.role, 'STAFF');
});

test('B3-F1: self-deactivation and OWNER targets are protected, and foreign user ids resolve to 404', async () => {
  const self = await api(base, 'PATCH', `/users/${IDS.ownerA}`, {
    token: ownerAToken, body: { is_active: false },
  });
  assert.strictEqual(self.status, 400, 'OWNER cannot deactivate themselves');

  const ownTarget = await api(base, 'PATCH', `/users/${IDS.ownerA}`, {
    token: ownerAToken, body: { is_active: false },
  });
  assert.strictEqual(ownTarget.status, 400, 'OWNER account is a protected target');

  const foreign = await api(base, 'PATCH', `/users/${IDS.staffB}`, {
    token: ownerAToken, body: { is_active: false },
  });
  assert.strictEqual(foreign.status, 404, 'cross-tenant user id must resolve to 404, never a leak');

  const foreignList = await api(base, 'GET', '/users', { token: ownerBToken });
  const foreignEmails = foreignList.body.data.map((u) => u.email);
  assert.ok(!foreignEmails.includes('new-staff@test.local'), 'tenant B must not see tenant A staff');
});

test('B3-F1: deactivation revokes refresh tokens immediately — the target cannot refresh back in', async () => {
  const created = await api(base, 'POST', '/users', {
    token: ownerAToken,
    body:  { name: 'Token Victim', email: 'token-victim@test.local', password: PASSWORD },
  });
  assert.strictEqual(created.status, 201);
  const victimId = created.body.data.id;

  const login = await api(base, 'POST', '/auth/login', {
    body: { email: 'token-victim@test.local', password: PASSWORD },
  });
  assert.strictEqual(login.status, 200);
  const refreshToken = login.body.data.refreshToken;

  const deactivate = await api(base, 'PATCH', `/users/${victimId}`, {
    token: ownerAToken, body: { is_active: false },
  });
  assert.strictEqual(deactivate.status, 200);
  assert.strictEqual(deactivate.body.data.is_active, false);

  const refresh = await api(base, 'POST', '/auth/refresh', { body: { refreshToken } });
  assert.strictEqual(refresh.status, 401, 'revoked refresh token must be rejected after deactivation');

  const victimLogin = await api(base, 'POST', '/auth/login', {
    body: { email: 'token-victim@test.local', password: PASSWORD },
  });
  assert.strictEqual(victimLogin.status, 401, 'deactivated user is treated as invalid credentials (no account-enumeration leak)');

  const reactivate = await api(base, 'PATCH', `/users/${victimId}`, {
    token: ownerAToken, body: { is_active: true },
  });
  assert.strictEqual(reactivate.status, 200, 'reactivation is allowed while under the limit');
  assert.strictEqual(reactivate.body.data.is_active, true);
});

test('B3-F1: plan users_limit is enforced at create and re-checked at reactivation', async () => {
  // Fresh account → trial → pick the 2-user plan → platform approves.
  const reg = await api(base, 'POST', '/auth/register-account', {
    body: { name: 'B3 Limit', email: 'b3-limit@test.local', password: PASSWORD, showroom_name: 'B3 Limit Room' },
  });
  assert.strictEqual(reg.status, 201);
  const ownerToken = await tokenFor(base, 'b3-limit@test.local');

  const req = await api(base, 'POST', '/subscriptions/request', {
    token: ownerToken, body: { plan_code: 'B3LIMITED' },
  });
  assert.strictEqual(req.status, 201);
  const paymentId = req.body.data.payment.id;

  const approve = await api(base, 'POST', `/admin/payments/${paymentId}/approve`, { token: superToken });
  assert.strictEqual(approve.status, 200, 'platform approves the payment → ACTIVE plan with users_limit 2');

  // owner (1) + staff1 (2) = at the limit → staff2 must be rejected.
  const staff1 = await api(base, 'POST', '/users', {
    token: ownerToken, body: { name: 'Limit One', email: 'limit-one@test.local', password: PASSWORD },
  });
  assert.strictEqual(staff1.status, 201, 'first staff slot (owner + 1) fits the 2-user plan');

  const staff2 = await api(base, 'POST', '/users', {
    token: ownerToken, body: { name: 'Limit Two', email: 'limit-two@test.local', password: PASSWORD },
  });
  assert.strictEqual(staff2.status, 403, 'third active user must hit PLAN_LIMIT_REACHED');
  assert.strictEqual(staff2.body.code, 'PLAN_LIMIT_REACHED');

  // Deactivating frees the slot; reactivating re-checks the limit.
  const deactivate = await api(base, 'PATCH', `/users/${staff1.body.data.id}`, {
    token: ownerToken, body: { is_active: false },
  });
  assert.strictEqual(deactivate.status, 200);

  const staff2b = await api(base, 'POST', '/users', {
    token: ownerToken, body: { name: 'Limit Two B', email: 'limit-two-b@test.local', password: PASSWORD },
  });
  assert.strictEqual(staff2b.status, 201, 'deactivated users freed their slot');

  const reactivate = await api(base, 'PATCH', `/users/${staff1.body.data.id}`, {
    token: ownerToken, body: { is_active: true },
  });
  assert.strictEqual(reactivate.status, 403, 'reactivation must re-check the plan limit');
  assert.strictEqual(reactivate.body.code, 'PLAN_LIMIT_REACHED');
});

// ─────────────────────────────────────────────
// F2 — SHOWROOM PROFILE SELF-SERVICE
// ─────────────────────────────────────────────

test('B3-F2: /onboarding/status carries the business-profile fields for form prefill', async () => {
  const status = await api(base, 'GET', '/onboarding/status', { token: ownerAToken });
  assert.strictEqual(status.status, 200);
  assert.ok('address' in status.body.data, 'address field must be present');
  assert.ok('phone' in status.body.data, 'phone field must be present');
  assert.ok('email' in status.body.data, 'email field must be present');
  assert.strictEqual(status.body.data.showroom_id, IDS.showroomA);
});

test('B3-F2: OWNER updates the business profile through the audited PATCH /onboarding', async () => {
  const update = await api(base, 'PATCH', '/onboarding', {
    token: ownerAToken,
    body:  {
      name: 'Showroom A — جديد',
      address: 'شارع الصناعات، تعز',
      phone: '+967777123456',
      email: 'shop@showroom-a.local',
    },
  });
  assert.strictEqual(update.status, 200, 'OWNER may update the business profile');
  assert.strictEqual(update.body.data.address, 'شارع الصناعات، تعز');
  assert.strictEqual(update.body.data.phone, '+967777123456');
  assert.strictEqual(update.body.data.email, 'shop@showroom-a.local');

  const status = await api(base, 'GET', '/onboarding/status', { token: ownerAToken });
  assert.strictEqual(status.body.data.address, 'شارع الصناعات، تعز', 'GET reflects the saved profile');
  assert.strictEqual(status.body.data.phone, '+967777123456');
});

test('B3-F2: STAFF is read-only — PATCH is rejected 403, and mass-assignment of protected fields is stripped', async () => {
  const staffPatch = await api(base, 'PATCH', '/onboarding', {
    token: staffAToken,
    body:  { name: 'Staff Takeover', address: 'hacked' },
  });
  assert.strictEqual(staffPatch.status, 403, 'STAFF must never mutate the showroom profile');

  const massAssign = await api(base, 'PATCH', '/onboarding', {
    token: ownerAToken,
    body:  { name: 'Showroom A — جديد', is_active: false, is_onboarded: false, role: 'SUPER_ADMIN', users_limit: 999 },
  });
  assert.strictEqual(massAssign.status, 200, 'unknown/protected keys are stripped, the request still succeeds');
  const status = await api(base, 'GET', '/onboarding/status', { token: ownerAToken });
  assert.strictEqual(status.body.data.is_onboarded, true, 'is_onboarded must not be spoofable through the body');
});

// ─────────────────────────────────────────────
// F4 — INVOICE PRINT SECURITY (CSP + no inline handlers)
// ─────────────────────────────────────────────

test('B3-F4: invoice print HTML carries a nonce-based CSP, no inline onclick, and keeps XSS inert', async () => {
  const evilName = `أحمد<img src=x onerror=alert(7)><script>alert(8)</script>`;
  const customer = await db.customer.create({
    data: {
      showroom_id: IDS.showroomA, name: evilName, phone: `<script>alert(9)</script>`,
    },
  });
  const sale = await db.sale.create({
    data: {
      showroom_id: IDS.showroomA, customer_id: customer.id, user_id: IDS.ownerA,
      invoice_number: 'INV-B3-XSS-1', sale_type: 'CASH', status: 'ACTIVE',
      subtotal: 10000, discount: 0, total: 10000, profit: 2000,
      items: { create: [
        { inventory_id: IDS.itemA1, quantity: 1, unit_price: 10000, cost_price: 8000, total_price: 10000, profit: 2000 },
      ] },
    },
  });

  const res = await fetch(`${base}/api/v1/invoices/${sale.id}/print`, {
    headers: { authorization: `Bearer ${ownerAToken}` },
  });
  assert.strictEqual(res.status, 200);
  const html = await res.text();

  assert.ok(!html.includes('<script>alert'), 'no raw executable script may reach the document');
  assert.ok(html.includes('&lt;script&gt;'), 'script payload must be escaped');
  assert.ok(html.includes('&lt;img'), 'img payload must be escaped');
  assert.ok(html.includes('أحمد'), 'Arabic text survives escaping');

  const csp = res.headers.get('content-security-policy') || '';
  assert.ok(csp.includes(`script-src 'self' 'nonce-`), 'print response must carry a nonce-based CSP');
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp), 'script-src must never allow inline handlers');
  assert.ok(!html.includes('onclick='), 'no inline event handler may exist in the template');
});

test('B3-F4: cross-tenant invoice access is denied for both the JSON and the print document', async () => {
  const foreignJson = await api(base, 'GET', `/invoices/${IDS.saleCashA}`, { token: ownerBToken });
  assert.strictEqual(foreignJson.status, 404, 'foreign tenant must never read the invoice JSON');

  const foreignPrint = await fetch(`${base}/api/v1/invoices/${IDS.saleCashA}/print`, {
    headers: { authorization: `Bearer ${ownerBToken}` },
  });
  assert.strictEqual(foreignPrint.status, 404, 'foreign tenant must never read the print document');
});

// ─────────────────────────────────────────────
// F6 — NOTIFICATION TENANT ISOLATION
// ─────────────────────────────────────────────

test('B3-F6: notifications are tenant-isolated — one showroom never sees anothers events', async () => {
  // The sale schema validates cuid ids, so the API-created customer and
  // inventory rows get genuine cuid-compliant ids (the fixed string
  // fixture ids are intentionally NOT cuids).
  const cuid = () => `c${crypto.randomBytes(12).toString('hex')}`;
  const apiCustomer = await db.customer.create({
    data: { id: cuid(), showroom_id: IDS.showroomA, name: 'B3 API Customer', phone: '+10000000009' },
  });
  const apiItem = await db.inventory.create({
    data: {
      id: cuid(), showroom_id: IDS.showroomA, vehicle_type: 'CAR', brand: 'Synth', model: 'B3-1',
      cost_price: 8000, selling_price: 10000, quantity: 3, status: 'IN_STOCK',
    },
  });

  // API-driven sale creation fires SALE_CREATED inside the same flow.
  const sale = await api(base, 'POST', '/sales', {
    token: ownerAToken,
    body:  {
      customer_id: apiCustomer.id,
      sale_type:   'CASH',
      items:       [{ inventory_id: apiItem.id, quantity: 1, unit_price: 10000 }],
    },
  });
  assert.strictEqual(sale.status, 201, 'owner can create a cash sale');
  const invoiceNumber = sale.body.data.invoice_number;

  const ownerList = await api(base, 'GET', '/notifications', { token: ownerAToken });
  assert.strictEqual(ownerList.status, 200);
  assert.ok(
    ownerList.body.data.some((n) => n.type === 'SALE_CREATED' && n.data?.invoice_number === invoiceNumber),
    'SALE_CREATED notification must exist for the owning showroom'
  );

  const staffList = await api(base, 'GET', '/notifications', { token: staffAToken });
  assert.ok(
    staffList.body.data.some((n) => n.type === 'SALE_CREATED' && n.data?.invoice_number === invoiceNumber),
    'team members of the same showroom see the event (tenant-wide delivery)'
  );

  const ownerBList = await api(base, 'GET', '/notifications', { token: ownerBToken });
  assert.ok(
    !ownerBList.body.data.some((n) => n.type === 'SALE_CREATED' && n.data?.invoice_number === invoiceNumber),
    'another showroom must never see the notification'
  );
});
