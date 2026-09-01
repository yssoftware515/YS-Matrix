'use strict';
// Phase 3 (Platform Audit & Observability) — end-to-end integration tests
// for the /api/v1/admin/audit/* surface + the five write-side enablers.
// Real Express app, real test DB, real middleware.
//
// Coverage matrix:
//   • access: anon → 401; STAFF/OWNER → 403 INSUFFICIENT_SCOPE;
//     GLOBAL without key → 403 INSUFFICIENT_PERMISSION;
//     GLOBAL with platform_audit:read → 200; SUPER_ADMIN → 200 (raw)
//   • filters/pagination/validation/404 on the three endpoints
//   • server-side redaction: delegated viewer sees [REDACTED] PII,
//     SUPER_ADMIN sees raw
//   • write-side enablers: LOGIN_FAILED (3 shapes), AUTHZ_DENIED,
//     CROSS_TENANT_BLOCKED, IP on the two password events,
//     impersonation attribution (new_data.impersonated_by)
// =============================================================

const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');

const { startServer, stopServer, api, db } = require('../helpers/harness');
const { seedAll, tokenFor, IDS, PASSWORD } = require('../helpers/fixtures');

let base;
let sa, ownerA, staffA;
let auditorId, auditorToken;   // GLOBAL profile holding platform_audit:read
let noAuditToken;   // GLOBAL profile WITHOUT the audit key

const admin = (method, p, opts = {}) => api(base, method, `/admin${p}`, opts);

const login = async (email, password = PASSWORD) => {
  const r = await api(base, 'POST', '/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login(${email}) failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data.accessToken;
};

const auditVisible = async (action, user_id, timeoutMs = 2500, match = null) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hits = await db.baseClient.auditLog.findMany({
      where: { action, user_id },
      orderBy: { created_at: 'desc' },
      take: 20,
    });
    const hit = hits.find((h) => !match || match(h));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
};

const auditVisibleAnyUser = async (action, match = null, timeoutMs = 2500) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hits = await db.baseClient.auditLog.findMany({
      where: { action },
      orderBy: { created_at: 'desc' },
      take: 30,
    });
    const hit = hits.find((h) => !match || match(h));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
};

test.before(async () => {
  base = await startServer();
  await seedAll();

  sa     = await tokenFor(base, 'sa@test.local');
  ownerA = await tokenFor(base, 'owner-a@test.local');
  staffA = await tokenFor(base, 'staff-a@test.local');

  // GLOBAL profile WITH platform_audit:read
  const prof = await admin('POST', '/profiles', {
    token: sa,
    body:  { name: 'AUDIT_VIEWER', description: 'Test audit viewer', scope: 'GLOBAL', permissions: [{ permission: 'platform_audit:read', scope: 'GLOBAL' }] },
  });
  assert.strictEqual(prof.status, 201, JSON.stringify(prof.body));
  const auditor = await admin('POST', '/administrators', {
    token: sa,
    body:  { name: 'Auditor Admin', email: 'auditor@test.local', password: PASSWORD, profile_id: prof.body.data.id },
  });
  assert.strictEqual(auditor.status, 201, JSON.stringify(auditor.body));
  auditorId = auditor.body.data.id;
  auditorToken = await login('auditor@test.local');

  // GLOBAL profile WITHOUT the audit key (positive control)
  const noAuditProf = await admin('POST', '/profiles', {
    token: sa,
    body:  { name: 'NO_AUDIT_ADMIN', description: 'Test viewer without audit key', scope: 'GLOBAL', permissions: [{ permission: 'platform_profile:read', scope: 'GLOBAL' }] },
  });
  assert.strictEqual(noAuditProf.status, 201, JSON.stringify(noAuditProf.body));
  const noAudit = await admin('POST', '/administrators', {
    token: sa,
    body:  { name: 'No Audit Admin', email: 'noaudit@test.local', password: PASSWORD, profile_id: noAuditProf.body.data.id },
  });
  assert.strictEqual(noAudit.status, 201, JSON.stringify(noAudit.body));
  noAuditToken = await login('noaudit@test.local');
});

test.after(async () => {
  await stopServer();
});

// ── 1. Access matrix ──────────────────────────────────────────
test('platform audit: access matrix — scope gate first, then permission key', async () => {
  const anon = await admin('GET', '/audit/events');
  assert.strictEqual(anon.status, 401);

  const staff = await admin('GET', '/audit/events', { token: staffA });
  assert.strictEqual(staff.status, 403);
  assert.strictEqual(staff.body.code, 'INSUFFICIENT_SCOPE');

  const owner = await admin('GET', '/audit/events', { token: ownerA });
  assert.strictEqual(owner.status, 403);
  assert.strictEqual(owner.body.code, 'INSUFFICIENT_SCOPE');

  const noAudit = await admin('GET', '/audit/events', { token: noAuditToken });
  assert.strictEqual(noAudit.status, 403);
  assert.strictEqual(noAudit.body.code, 'INSUFFICIENT_PERMISSION');

  const auditor = await admin('GET', '/audit/events', { token: auditorToken });
  assert.strictEqual(auditor.status, 200, JSON.stringify(auditor.body));
  assert.ok(Array.isArray(auditor.body.data));
  assert.ok(auditor.body.pagination.total >= 0);

  const superAdmin = await admin('GET', '/audit/events', { token: sa });
  assert.strictEqual(superAdmin.status, 200);
});

// ── 2. Filters + pagination + validation ──────────────────────
test('platform audit: filters, pagination, and query validation bounds', async () => {
  // action filter
  const byAction = await admin('GET', '/audit/events?action=LOGIN', { token: auditorToken });
  assert.strictEqual(byAction.status, 200);
  assert.ok(byAction.body.data.length > 0);
  assert.ok(byAction.body.data.every((e) => e.action === 'LOGIN'), 'action filter must be exact');

  // showroom filter
  const byShowroom = await admin('GET', `/audit/events?showroom_id=${IDS.showroomA}`, { token: auditorToken });
  assert.strictEqual(byShowroom.status, 200);
  assert.ok(byShowroom.body.data.every((e) => e.showroom_id === IDS.showroomA));

  // pagination bounds
  const page = await admin('GET', '/audit/events?page=1&limit=2', { token: auditorToken });
  assert.strictEqual(page.status, 200);
  assert.ok(page.body.data.length <= 2);
  assert.strictEqual(page.body.pagination.page, 1);
  assert.strictEqual(page.body.pagination.limit, 2);

  // validation: oversized limit, negative page, broken dates
  const tooBig = await admin('GET', '/audit/events?limit=101', { token: auditorToken });
  assert.strictEqual(tooBig.status, 400);
  assert.strictEqual(tooBig.body.code, 'VALIDATION_ERROR');

  const badDate = await admin('GET', '/audit/events?date_to=garbage', { token: auditorToken });
  assert.strictEqual(badDate.status, 400);
  assert.strictEqual(badDate.body.code, 'VALIDATION_ERROR');

  const negPage = await admin('GET', '/audit/events?page=-1', { token: auditorToken });
  assert.strictEqual(negPage.status, 400);
});

// ── 3. Filters endpoint ───────────────────────────────────────
test('platform audit: filters endpoint returns distinct action/entity lists', async () => {
  const r = await admin('GET', '/audit/filters', { token: auditorToken });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.ok(Array.isArray(r.body.data.actions));
  assert.ok(Array.isArray(r.body.data.entities));
  assert.ok(r.body.data.actions.includes('LOGIN'), 'LOGIN rows exist from tokenFor before()');
  assert.ok(r.body.data.entities.includes('user'));
});

// ── 4. Detail endpoint ────────────────────────────────────────
test('platform audit: detail endpoint returns a single event; unknown id → 404', async () => {
  const list = await admin('GET', '/audit/events?limit=1', { token: auditorToken });
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.data.length === 1);

  const one = await admin('GET', `/audit/${list.body.data[0].id}`, { token: auditorToken });
  assert.strictEqual(one.status, 200, JSON.stringify(one.body));
  assert.strictEqual(one.body.data.id, list.body.data[0].id);

  const ghost = await admin('GET', '/audit/no-such-id', { token: auditorToken });
  assert.strictEqual(ghost.status, 404);
});

// ── 5. Server-side redaction ──────────────────────────────────
test('platform audit: PII redacted for delegated viewers, raw for SUPER_ADMIN', async () => {
  const created = await api(base, 'POST', '/customers', {
    token: ownerA,
    body:  { name: 'PII Customer', phone: '+10000009999', national_id: 'NIDPII-001' },
  });
  assert.ok([200, 201].includes(created.status), JSON.stringify(created.body));

  const row = await auditVisibleAnyUser('CREATE', (h) => h.entity === 'customer' && h.new_data?.name === 'PII Customer');
  assert.ok(row, 'customer CREATE audit row must exist');
  assert.strictEqual(row.new_data.national_id, 'NIDPII-001', 'raw row on disk holds the PII');
  assert.strictEqual(row.new_data.phone, '+10000009999');

  const asDelegate = await admin('GET', `/audit/${row.id}`, { token: auditorToken });
  assert.strictEqual(asDelegate.status, 200);
  assert.strictEqual(asDelegate.body.data.new_data.national_id, '[REDACTED]');
  assert.strictEqual(asDelegate.body.data.new_data.phone, '[REDACTED]');
  assert.strictEqual(asDelegate.body.data.new_data.name, 'PII Customer', 'non-PII fields survive');

  const asSA = await admin('GET', `/audit/${row.id}`, { token: sa });
  assert.strictEqual(asSA.status, 200);
  assert.strictEqual(asSA.body.data.new_data.national_id, 'NIDPII-001', 'SA sees the raw value');
  assert.strictEqual(asSA.body.data.new_data.phone, '+10000009999');
});

// ── 6. LOGIN_FAILED enabler ───────────────────────────────────
test('platform audit: failed logins are written for wrong password, unknown email, disabled account', async () => {
  // wrong password for an existing user
  const wrong = await api(base, 'POST', '/auth/login', { body: { email: 'owner-a@test.local', password: 'TotallyWrong#1' } });
  assert.strictEqual(wrong.status, 401);
  const wrongRow = await auditVisible('LOGIN_FAILED', IDS.ownerA, 2500, (h) => h.new_data?.reason === 'INVALID_CREDENTIALS');
  assert.ok(wrongRow, 'LOGIN_FAILED row for wrong password');
  assert.strictEqual(wrongRow.showroom_id, IDS.showroomA);
  assert.ok(wrongRow.ip_address, 'LOGIN_FAILED carries IP');

  // unknown email → no identity, system showroom
  const unknown = await api(base, 'POST', '/auth/login', { body: { email: 'ghost@nowhere.test', password: 'Whatever#1' } });
  assert.strictEqual(unknown.status, 401);
  const unknownRow = await auditVisibleAnyUser('LOGIN_FAILED', (h) => h.user_id === null && h.new_data?.email === 'ghost@nowhere.test');
  assert.ok(unknownRow, 'LOGIN_FAILED row for unknown email');
  assert.strictEqual(unknownRow.showroom_id, IDS.sys, 'unknown-identity attempts land on the system showroom');
  assert.strictEqual(unknownRow.new_data.reason, 'INVALID_CREDENTIALS', 'identical anti-enumeration reason');

  // disabled account
  await db.baseClient.user.create({
    data: {
      id: 'u-disabled',
      showroom_id: IDS.showroomA,
      name: 'Disabled User',
      email: 'disabled@test.local',
      password_hash: bcrypt.hashSync(PASSWORD, 4),
      role: 'STAFF',
      is_active: false,
    },
  });
  const dis = await api(base, 'POST', '/auth/login', { body: { email: 'disabled@test.local', password: PASSWORD } });
  assert.strictEqual(dis.status, 401);
  assert.strictEqual(dis.body.code, 'ACCOUNT_DISABLED');
  const disRow = await auditVisible('LOGIN_FAILED', 'u-disabled', 2500, (h) => h.new_data?.reason === 'ACCOUNT_DISABLED');
  assert.ok(disRow, 'LOGIN_FAILED row for disabled account');
  assert.strictEqual(disRow.showroom_id, IDS.showroomA);
});

// ── 7. AUTHZ_DENIED enabler ───────────────────────────────────
test('platform audit: route-level denials become AUTHZ_DENIED rows with context', async () => {
  // STAFF denied at scope level (from test 1) — poll for its row now
  const scopeRow = await auditVisible('AUTHZ_DENIED', IDS.staffA, 2500, (h) => h.new_data?.reason === 'INSUFFICIENT_SCOPE');
  assert.ok(scopeRow, 'scope denial must be audited');
  assert.strictEqual(scopeRow.new_data.reason, 'INSUFFICIENT_SCOPE');
  assert.strictEqual(scopeRow.showroom_id, IDS.showroomA, 'attributed to the actor own showroom');
  assert.ok(scopeRow.ip_address);

  // GLOBAL without the key denied at permission level — find by actor email
  const permByEmail = await auditVisibleAnyUser('AUTHZ_DENIED', (h) => h.new_data?.actor === 'noaudit@test.local' && h.new_data?.permission === 'platform_audit:read');
  assert.ok(permByEmail, 'permission denial must be audited with the missing key');
  assert.strictEqual(permByEmail.new_data.reason, 'INSUFFICIENT_PERMISSION');
  assert.strictEqual(permByEmail.showroom_id, IDS.sys, 'delegated admins live on the system showroom');
});

// ── 8. CROSS_TENANT_BLOCKED enabler ───────────────────────────
test('platform audit: CROSS_TENANT_BLOCKED is written to the actor own showroom', async () => {
  const r = await api(base, 'GET', `/activity?showroom_id=${IDS.showroomB}`, { token: ownerA });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'CROSS_TENANT_BLOCKED');

  const row = await auditVisible('CROSS_TENANT_BLOCKED', IDS.ownerA, 2500, (h) => h.new_data?.requested_showroom === IDS.showroomB);
  assert.ok(row, 'CROSS_TENANT_BLOCKED row must exist');
  assert.strictEqual(row.showroom_id, IDS.showroomA, 'written against the actor real showroom');
  assert.strictEqual(row.new_data.own_showroom, IDS.showroomA);
  assert.strictEqual(row.new_data.requested_showroom, IDS.showroomB);
  assert.ok(row.ip_address);
});

// ── 9. Password events carry IP ───────────────────────────────
test('platform audit: both password events now carry ip_address', async () => {
  // forgot-password request (anonymous flow, one call — 3/15min limiter)
  const forgot = await api(base, 'POST', '/auth/forgot-password-request', { body: { email: 'owner-a@test.local' } });
  assert.strictEqual(forgot.status, 200, JSON.stringify(forgot.body));
  const resetReq = await auditVisible('PASSWORD_RESET_REQUESTED', IDS.ownerA, 2500);
  assert.ok(resetReq, 'PASSWORD_RESET_REQUESTED row must exist');
  assert.ok(resetReq.ip_address, 'IP must be recorded on PASSWORD_RESET_REQUESTED');
  // Console transport (EMAIL_TRANSPORT=console — Phase 2 F-01) simulates
  // the send, so the success path is exercised end-to-end, network-free.
  assert.strictEqual(resetReq.new_data.status, 'EMAIL_SENT', 'simulated send must record EMAIL_SENT');

  // SUPER_ADMIN direct reset — target must be a cuid user id (delegated
  // admins are user rows created by the platform surface)
  const reset = await api(base, 'POST', '/superadmin/reset-user-password', {
    token: sa,
    body:  { user_id: auditorId, new_password: 'NewPass#123456' },
  });
  assert.strictEqual(reset.status, 200, JSON.stringify(reset.body));
  const resetRow = await auditVisible('SUPERADMIN_PASSWORD_RESET', IDS.sa, 2500, (h) => h.entity_id === auditorId);
  assert.ok(resetRow, 'SUPERADMIN_PASSWORD_RESET row must exist');
  assert.strictEqual(resetRow.showroom_id, IDS.sys, 'row lands on the target showroom');
  assert.ok(resetRow.ip_address, 'IP must be recorded on SUPERADMIN_PASSWORD_RESET');
});

// ── 10. Impersonation attribution ─────────────────────────────
test('platform audit: actions during impersonation are attributed to the real SUPER_ADMIN', async () => {
  const imp = await api(base, 'POST', `/superadmin/showrooms/${IDS.showroomA}/impersonate`, { token: sa });
  assert.strictEqual(imp.status, 200, JSON.stringify(imp.body));
  const impToken = imp.body.data.accessToken;

  const created = await api(base, 'POST', '/customers', {
    token: impToken,
    body:  { name: 'Imp Person', phone: '+10000007777', national_id: 'NIDIMP-001' },
  });
  assert.ok([200, 201].includes(created.status), JSON.stringify(created.body));

  const row = await auditVisibleAnyUser('CREATE', (h) => h.entity === 'customer' && h.new_data?.name === 'Imp Person');
  assert.ok(row, 'CREATE row from the impersonated session must exist');
  assert.strictEqual(row.user_id, IDS.ownerA, 'row is written as the impersonated OWNER');
  assert.strictEqual(row.showroom_id, IDS.showroomA, 'row lands on the impersonated showroom');
  assert.ok(row.new_data.impersonated_by, 'attribution must be present');
  assert.strictEqual(row.new_data.impersonated_by.user_id, IDS.sa, 'attributed to the real SUPER_ADMIN');

  // redaction also applies to attributed rows for delegated viewers
  const asDelegate = await admin('GET', `/audit/${row.id}`, { token: auditorToken });
  assert.strictEqual(asDelegate.status, 200);
  assert.strictEqual(asDelegate.body.data.new_data.national_id, '[REDACTED]');
  assert.strictEqual(asDelegate.body.data.new_data.impersonated_by.user_id, IDS.sa, 'attribution itself stays visible');
});