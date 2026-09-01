'use strict';
// Phase 3 — E2E verification of the delegated-admin platform-audit flow
// against the dedicated isolated test database (localhost:5433/ys_matrix_test).
// Run: node scripts/phase3-e2e.js
//
// Real Express app + real HTTP + real test DB. Exercises the exact
// delegated-admin journey: SUPER_ADMIN grants platform_audit:read,
// the delegated auditor reads the platform trail, PII is redacted
// for the delegate and raw for SUPER_ADMIN, and the five write-side
// enablers produce truthful rows visible on the audit surface.

const assert = require('node:assert');

// harness loads .env.test + runs the fail-closed DB guard before
// anything else imports Prisma.
const { startServer, stopServer, api, db } = require('../tests/helpers/harness');
const { seedAll, tokenFor, IDS, PASSWORD } = require('../tests/helpers/fixtures');

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = '') => {
  if (cond) { console.log(`  ✅ ${label}`); pass++; }
  else { console.error(`  ❌ ${label} ${extra}`); fail++; }
};

const admin = (method, p, opts = {}) => api(base, method, `/admin${p}`, opts);
const login = async (email, password = PASSWORD) => {
  const r = await api(base, 'POST', '/auth/login', { body: { email, password } });
  assert.strictEqual(r.status, 200, `login(${email}) failed: ${JSON.stringify(r.body)}`);
  return r.body.data.accessToken;
};

const auditVisible = async (action, user_id, timeoutMs = 3000, match = null) => {
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

let base;

(async () => {
  console.log('PHASE 3 E2E — delegated-admin platform-audit flow');
  console.log('Environment: .env.test →', process.env.DATABASE_URL);

  base = await startServer();
  await seedAll();

  const sa     = await tokenFor(base, 'sa@test.local');
  const ownerA = await tokenFor(base, 'owner-a@test.local');
  const staffA = await tokenFor(base, 'staff-a@test.local');

  console.log('\n[1/8] SUPER_ADMIN grants platform_audit:read to a delegated GLOBAL admin');
  const prof = await admin('POST', '/profiles', {
    token: sa,
    body:  { name: 'AUDIT_VIEWER', description: 'E2E audit viewer', scope: 'GLOBAL', permissions: [{ permission: 'platform_audit:read', scope: 'GLOBAL' }] },
  });
  ok('profile created', prof.status === 201, JSON.stringify(prof.body));
  const auditor = await admin('POST', '/administrators', {
    token: sa,
    body:  { name: 'Auditor Admin', email: 'auditor@e2e.local', password: PASSWORD, profile_id: prof.body.data.id },
  });
  ok('delegated auditor created', auditor.status === 201, JSON.stringify(auditor.body));
  const auditToken = await login('auditor@e2e.local');

  console.log('\n[2/8] Delegated auditor reads the platform audit trail');
  const list = await admin('GET', '/audit/events', { token: auditToken });
  ok('GET /admin/audit/events → 200', list.status === 200, JSON.stringify(list.body));
  ok('list carries pagination meta', list.body.pagination && typeof list.body.pagination.total === 'number');

  console.log('\n[3/8] Access matrix spot checks');
  const anon = await admin('GET', '/audit/events');
  ok('anon → 401', anon.status === 401);
  const staff = await admin('GET', '/audit/events', { token: staffA });
  ok('STAFF → 403 INSUFFICIENT_SCOPE', staff.status === 403 && staff.body.code === 'INSUFFICIENT_SCOPE');
  const noKey = await admin('GET', '/audit/events', { token: ownerA });
  ok('OWNER → 403 INSUFFICIENT_SCOPE (scope before permission)', noKey.status === 403 && noKey.body.code === 'INSUFFICIENT_SCOPE');

  console.log('\n[4/8] AUTHZ_DENIED enabler: the STAFF denial is on the trail');
  const denied = await auditVisible('AUTHZ_DENIED', IDS.staffA, 3000, (h) => h.new_data?.reason === 'INSUFFICIENT_SCOPE');
  ok('STAFF denial row exists', !!denied);
  ok('denial row has context (path)', denied && typeof denied.new_data.path === 'string');

  console.log('\n[5/8] LOGIN_FAILED enabler: failed login lands on the trail');
  const bad = await api(base, 'POST', '/auth/login', { body: { email: 'owner-a@test.local', password: 'WrongPass#1' } });
  ok('wrong password → 401', bad.status === 401);
  const failed = await auditVisible('LOGIN_FAILED', IDS.ownerA, 3000, (h) => h.new_data?.reason === 'INVALID_CREDENTIALS');
  ok('LOGIN_FAILED row exists', !!failed);
  ok('LOGIN_FAILED carries IP', failed && !!failed.ip_address);
  const seeFailed = await admin('GET', '/audit/events?action=LOGIN_FAILED', { token: auditToken });
  ok('delegated auditor SEES the LOGIN_FAILED rows', seeFailed.status === 200 && seeFailed.body.data.length > 0);

  console.log('\n[6/8] PII redaction: delegate sees [REDACTED], SUPER_ADMIN sees raw');
  const created = await api(base, 'POST', '/customers', {
    token: ownerA,
    body:  { name: 'E2E PII Customer', phone: '+10001112222', national_id: 'NIDE2E-999' },
  });
  ok('customer created (audited)', [200, 201].includes(created.status), JSON.stringify(created.body));
  const row = await auditVisible('CREATE', IDS.ownerA, 3000, (h) => h.entity === 'customer' && h.new_data?.name === 'E2E PII Customer');
  ok('CREATE customer audit row exists', !!row);

  const asDelegate = await admin('GET', `/audit/${row.id}`, { token: auditToken });
  ok('delegate detail → 200', asDelegate.status === 200);
  ok('delegate sees [REDACTED] national_id', asDelegate.body.data.new_data?.national_id === '[REDACTED]');
  ok('delegate sees [REDACTED] phone', asDelegate.body.data.new_data?.phone === '[REDACTED]');

  const asSA = await admin('GET', `/audit/${row.id}`, { token: sa });
  ok('SA detail → 200', asSA.status === 200);
  ok('SA sees raw national_id', asSA.body.data.new_data?.national_id === 'NIDE2E-999');
  ok('SA sees raw phone', asSA.body.data.new_data?.phone === '+10001112222');

  console.log('\n[7/8] CROSS_TENANT_BLOCKED enabler');
  const cross = await api(base, 'GET', `/activity?showroom_id=${IDS.showroomB}`, { token: ownerA });
  ok('cross-tenant attempt → 403 CROSS_TENANT_BLOCKED', cross.status === 403 && cross.body.code === 'CROSS_TENANT_BLOCKED');
  const crossRow = await auditVisible('CROSS_TENANT_BLOCKED', IDS.ownerA, 3000, (h) => h.new_data?.requested_showroom === IDS.showroomB);
  ok('CROSS_TENANT_BLOCKED row exists on actor showroom', !!crossRow && crossRow.showroom_id === IDS.showroomA);

  console.log('\n[8/8] FILTERS endpoint + pagination');
  const filters = await admin('GET', '/audit/filters', { token: auditToken });
  ok('filters endpoint lists LOGIN_FAILED action', filters.status === 200 && filters.body.data.actions.includes('LOGIN_FAILED'));
  const paged = await admin('GET', '/audit/events?page=1&limit=2', { token: auditToken });
  ok('pagination limited rows to 2', paged.status === 200 && paged.body.data.length === 2 && paged.body.pagination.page === 1);

  await stopServer();

  console.log(`\nE2E RESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((err) => {
  console.error('E2E crashed:', err);
  process.exit(1);
});