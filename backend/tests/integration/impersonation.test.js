'use strict';
// Phase 0.5 — impersonation behavior against the real database (CURRENT).
// No future MFA/step-up design is tested here.
const test = require('node:test');
const assert = require('node:assert');
const jwt = require('jsonwebtoken');

const { startServer, stopServer, api, db } = require('../helpers/harness');
const { seedAll, tokenFor, IDS } = require('../helpers/fixtures');

let base;
let sa, ownerA;

test.before(async () => {
  base = await startServer();
  await seedAll();
  sa = await tokenFor(base, 'sa@test.local');
  ownerA = await tokenFor(base, 'owner-a@test.local');
});

test.after(async () => {
  await stopServer();
});

test('impersonation CURRENT: authorizes ONLY SUPER_ADMIN → others get 403', async () => {
  const r = await api(base, 'POST', `/superadmin/showrooms/${IDS.showroomA}/impersonate`, { token: ownerA });
  assert.strictEqual(r.status, 403);
  assert.strictEqual(r.body.code, 'INSUFFICIENT_ROLE');
});

test('impersonation CURRENT: issues 30-minute ACCESS-ONLY token for the target OWNER', async () => {
  const r = await api(base, 'POST', `/superadmin/showrooms/${IDS.showroomA}/impersonate`, { token: sa });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));

  const decoded = jwt.decode(r.body.data.accessToken);
  assert.strictEqual(decoded.exp - decoded.iat, 30 * 60, 'expiry must be exactly 30 minutes');
  assert.strictEqual(decoded.impersonatedBy, IDS.sa);
  assert.strictEqual(decoded.role, 'OWNER');
  assert.strictEqual(decoded.userId, IDS.ownerA, 'identity must be the target OWNER, not the SuperAdmin');
});

test('impersonation CURRENT: the token acts as the OWNER on tenant routes', async () => {
  const imp = await api(base, 'POST', `/superadmin/showrooms/${IDS.showroomA}/impersonate`, { token: sa });
  const r = await api(base, 'GET', '/customers', { token: imp.body.data.accessToken });
  assert.strictEqual(r.status, 200);
  const ids = r.body.data.map((c) => c.id);
  assert.deepStrictEqual(ids, [IDS.custA1]);
});

test('impersonation CURRENT: unknown showroom → 404; inactive showroom → 400', async () => {
  const missing = await api(base, 'POST', '/superadmin/showrooms/no-such-showroom/impersonate', { token: sa });
  assert.strictEqual(missing.status, 404);

  const inactive = await api(base, 'POST', `/superadmin/showrooms/${IDS.showroomD}/impersonate`, { token: sa });
  assert.strictEqual(inactive.status, 400, 'inactive showroom cannot be impersonated');
});

test('impersonation CURRENT: sensitive action is audit-logged', async () => {
  await api(base, 'POST', `/superadmin/showrooms/${IDS.showroomA}/impersonate`, { token: sa });

  // auditLog is fire-and-forget — poll briefly for the row.
  let row = null;
  for (let attempt = 0; attempt < 20 && !row; attempt++) {
    row = await db.baseClient.auditLog.findFirst({
      where: { action: 'IMPERSONATE_SHOWROOM', entity_id: IDS.showroomA },
      orderBy: { created_at: 'desc' },
    });
    if (!row) await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(row, 'IMPERSONATE_SHOWROOM audit row must exist');
  assert.strictEqual(row.new_data.impersonated_user_id, IDS.ownerA);
});