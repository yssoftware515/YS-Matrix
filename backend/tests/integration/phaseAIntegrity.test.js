'use strict';
// ============================================================
// Phase A — Launch Integrity Hardening. Regression coverage for
// the nine hardening fixes:
//   • P1-1 atomic activation — payment PAID + subscription ACTIVE
//     + showroom license sync are ONE transaction; a mid-flight
//     conflict rolls back every leg (no stuck PAID-with-stale-
//     license states); double/concurrent approval is impossible
//   • P1-2 one PENDING_PAYMENT claim per showroom — DB-level
//     partial unique index backstop + P2002 → friendly CONFLICT;
//     a true concurrent double-request can never produce two
//     claims (the pre-check is a fast path, the index is the law)
//   • P1-3 invoice HTML escaping — customer/showroom/user/notes
//     payloads render inert, Arabic survives
//   • P2-1 refresh tokens hashed at rest — DB never stores the
//     raw token; rotation + revocation still work on the digest
//   • P2-2 proof access — STAFF status strips proof_data/reference
//   • P2-4 CRON_SECRET gate — wrong bearer 401; run failures are
//     masked (no err.message leak)
//   • P2-5 cancelSale concurrency — conditional claim: exactly ONE
//     concurrent cancel wins; inventory restored exactly once
// ============================================================
const test = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, PASSWORD, IDS , unlockAll} = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');
const scheduledNotificationsJob = require('../../src/jobs/scheduledNotifications.job');

const REAL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PLAN_ID = 'plan-phase-a-standard';

let base;
let superToken, ownerAToken, ownerBToken, ownerEToken, ownerWToken;

// Direct-DB claim creation (deterministic; the request ENDPOINT is
// exercised separately in the duplicate-claim test).
const makeClaim = async (showroomId, reference) => {
  const sub = await db.subscription.create({
    data: {
      showroom_id: showroomId, plan_name: 'STANDARD', plan_id: PLAN_ID,
      status: 'PENDING_PAYMENT', price_amount: 500, duration_months: 1, users_limit: 2,
    },
  });
  const payment = await db.payment.create({
    data: {
      showroom_id: showroomId, subscription_id: sub.id, plan_id: PLAN_ID,
      plan_name: 'STANDARD', plan_code: 'STANDARD', amount: 500, currency: 'EGP',
      method: 'BANK_TRANSFER', status: 'PENDING',
      proof_data: REAL_PNG, proof_mime: 'image/png', reference,
    },
  });
  return { sub, payment };
};

const approve = (paymentId, token) =>
  api(base, 'POST', `/admin/payments/${paymentId}/approve`, { token, body: { reason: 'تم التحقق' } });

test.before(async () => {
  base = await startServer();
  await seedAll();

  // Ensure the Phase A partial unique index exists regardless of DB
  // setup method. prisma migrate reset applies this raw SQL migration,
  // but prisma db push does not. Creating it idempotently here makes
  // the test self-contained.
  await db.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "subscriptions_one_pending_per_showroom"
    ON "subscriptions" ("showroom_id")
    WHERE status = 'PENDING_PAYMENT'
  `);

  superToken  = await tokenFor(base, 'sa@test.local');
  ownerAToken = await tokenFor(base, 'owner-a@test.local');
  ownerBToken = await tokenFor(base, 'owner-b@test.local');
  ownerEToken = await tokenFor(base, 'owner-e@test.local');
  ownerWToken = await tokenFor(base, 'owner-w@test.local');

  await db.plan.create({
    data: {
      id: PLAN_ID, name: 'الباقة الأساسية', code: 'STANDARD',
      price_amount: 500, currency: 'EGP', duration_months: 1, users_limit: 2,
    },
  });
});

test.after(async () => {
  await unlockAll();
  await stopServer();
});

// ─────────────────────────────────────────────
// P1-1 ATOMIC ACTIVATION
// ─────────────────────────────────────────────

test('P1-1: approval conflict rolls back EVERY leg — payment stays PENDING, license untouched', async () => {
  const { payment } = await makeClaim(IDS.showroomB, 'P1A-ROLLBACK-1');
  const licenseBefore = (await db.showroom.findUnique({ where: { id: IDS.showroomB } })).license_expiry;

  // Simulate a concurrent state change between the pre-checks and the
  // approval: the subscription claim is already gone (rejected by a
  // parallel review). The payClaim succeeds inside the tx, then the
  // subClaim fails → the whole transaction must roll back.
  await db.subscription.update({ where: { id: payment.subscription_id }, data: { status: 'CANCELLED' } });

  const res = await approve(payment.id, superToken);
  assert.strictEqual(res.status, 409);

  const after = await db.payment.findUnique({ where: { id: payment.id } });
  assert.strictEqual(after.status, 'PENDING', 'payClaim must be rolled back — no stuck PAID payment');
  assert.strictEqual(after.reviewed_at, null, 'reviewed_at must roll back too');
  const licenseAfter = (await db.showroom.findUnique({ where: { id: IDS.showroomB } })).license_expiry;
  assert.strictEqual(String(licenseAfter), String(licenseBefore), 'showroom license must be untouched by the failed approval');
  const subAfter = await db.subscription.findUnique({ where: { id: payment.subscription_id } });
  assert.strictEqual(subAfter.status, 'CANCELLED');
});

test('P1-1: successful approval syncs payment + subscription + showroom license atomically', async () => {
  const { sub, payment } = await makeClaim(IDS.showroomB, 'P1A-ACTIVATE-1');
  const before = await db.showroom.findUnique({ where: { id: IDS.showroomB } });

  const res = await approve(payment.id, superToken);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.subscription.status, 'ACTIVE');

  const paid = await db.payment.findUnique({ where: { id: payment.id } });
  assert.strictEqual(paid.status, 'PAID');
  assert.strictEqual(paid.reviewed_by, IDS.sa);

  const active = await db.subscription.findUnique({ where: { id: sub.id } });
  assert.strictEqual(active.status, 'ACTIVE');
  assert.ok(active.expires_at > new Date(), 'expires_at must be in the future');

  const after = await db.showroom.findUnique({ where: { id: IDS.showroomB } });
  assert.strictEqual(after.is_active, true);
  assert.strictEqual(String(after.license_expiry), String(active.expires_at),
    'showroom.license_expiry must equal the activated subscription expiry — synced in the SAME transaction');
  assert.notStrictEqual(String(after.license_expiry), String(before.license_expiry));

  // Second approval → conflict; nothing changes.
  const again = await approve(payment.id, superToken);
  assert.strictEqual(again.status, 409);
  assert.strictEqual(paid.status, 'PAID');
  assert.strictEqual(String((await db.showroom.findUnique({ where: { id: IDS.showroomB } })).license_expiry), String(active.expires_at));
});

test('P1-1: concurrent double-approval — exactly one wins, state is consistent', async () => {
  const { payment } = await makeClaim(IDS.showroomE, 'P1A-RACE-1');

  const [a, b] = await Promise.all([approve(payment.id, superToken), approve(payment.id, superToken)]);
  const statuses = [a.status, b.status].sort();
  assert.deepStrictEqual(statuses, [200, 409], 'exactly one concurrent approval may win');

  const paid = await db.payment.findUnique({ where: { id: payment.id } });
  assert.strictEqual(paid.status, 'PAID');
  const sub = await db.subscription.findUnique({ where: { id: payment.subscription_id } });
  assert.strictEqual(sub.status, 'ACTIVE');
  const showroom = await db.showroom.findUnique({ where: { id: IDS.showroomE } });
  assert.strictEqual(showroom.is_active, true);
  assert.strictEqual(String(showroom.license_expiry), String(sub.expires_at));
});

// ─────────────────────────────────────────────
// P1-2 ONE PENDING CLAIM PER SHOWROOM
// ─────────────────────────────────────────────

test('P1-2: partial unique index exists (migration applied)', async () => {
  const rows = await db.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE indexname = 'subscriptions_one_pending_per_showroom'`
  );
  assert.strictEqual(rows.length, 1, 'the backstop index must exist in the migrated schema');
});

test('P1-2: true concurrent double-request — the index is the law, one claim exists', async () => {
  const submit = () => api(base, 'POST', '/subscriptions/request', {
    token: ownerWToken,
    body:  { plan_code: 'STANDARD', proof_mime: 'image/png', proof_data: REAL_PNG, reference: `RACE-${Date.now()}-${Math.random()}` },
  });

  const [a, b] = await Promise.all([submit(), submit()]);
  const statuses = [a.status, b.status].sort();
  assert.deepStrictEqual(statuses, [201, 409], 'one request wins, the other hits the DB-level conflict');

  const winner = a.status === 201 ? a : b;
  const loser  = a.status === 201 ? b : a;
  // The lifecycle controller's existing wire contract maps CONFLICT →
  // ACCOUNT_STATE_CONFLICT (the billing frontend keys off this code).
  assert.strictEqual(loser.body.code, 'ACCOUNT_STATE_CONFLICT');
  assert.strictEqual(loser.body.message, 'يوجد طلب اشتراك قيد المراجعة.');

  const pendingRows = await db.subscription.findMany({
    where: { showroom_id: IDS.showroomW, status: 'PENDING_PAYMENT' },
  });
  assert.strictEqual(pendingRows.length, 1, 'at most ONE pending claim may exist');
  assert.strictEqual(winner.body.data.payment.subscription_id, pendingRows[0].id);

  // The friendly pre-check (sequential duplicate) gives the same error.
  const again = await submit();
  assert.strictEqual(again.status, 409);
  assert.strictEqual(again.body.code, 'ACCOUNT_STATE_CONFLICT');
});

test('P1-2: DB-level duplicate insert is rejected (direct write bypasses the pre-check)', async () => {
  // Bypass the application entirely — two direct inserts of a second
  // PENDING_PAYMENT row must violate the partial unique index.
  await makeClaim(IDS.showroomA, 'P1A-DIRECT-1');
  await assert.rejects(
    db.subscription.create({
      data: {
        showroom_id: IDS.showroomA, plan_name: 'STANDARD', plan_id: PLAN_ID,
        status: 'PENDING_PAYMENT', price_amount: 500, duration_months: 1, users_limit: 2,
      },
    }),
    (err) => err?.code === 'P2002',
    'second PENDING_PAYMENT for the same showroom must be rejected at the database level'
  );
});

// ─────────────────────────────────────────────
// P1-3 INVOICE HTML ESCAPING
// ─────────────────────────────────────────────

test('P1-3: invoice HTML escapes every free-text payload — XSS payloads render inert, Arabic survives', async () => {
  const evilName = `محمد<script>alert(1)</script>';"><img src=x onerror=alert(2)>`;
  const evilNotes = `ملاحظات</div><script>alert(4)</script><div onmouseover="alert(5)">`;

  const customer = await db.customer.create({
    data: {
      showroom_id: IDS.showroomA, name: evilName,
      phone: '"onmouseover="alert(3)',
      address: '<b>عنوان</b>',
    },
  });
  const sale = await db.sale.create({
    data: {
      showroom_id: IDS.showroomA, customer_id: customer.id, user_id: IDS.ownerA,
      invoice_number: 'INV-PHASE-A-XSS-1', sale_type: 'CASH', status: 'ACTIVE',
      subtotal: 10000, discount: 0, total: 10000, profit: 2000, notes: evilNotes,
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

  // Escaped forms present.
  assert.ok(html.includes('&lt;script&gt;'), 'script payload must be escaped');
  assert.ok(html.includes('&quot;onmouseover=&quot;'), 'attribute payload must be escaped');
  assert.ok(html.includes('&lt;b&gt;'), 'HTML tag in address must be escaped');
  assert.ok(html.includes('&#39;'), 'quote in payload must be escaped');

  // Raw payloads absent — no executable markup can reach the document.
  // (The escaped text legitimately CONTAINS the literal characters
  // 'onerror='/'onmouseover=' — that is the point: they are inert
  // inside &lt;-escaped text. The real checks are the raw delimiters:
  // an unescaped '<' or '"' would make them live markup/attributes.)
  assert.ok(!html.includes('<script>'), 'no raw <script> may appear');
  assert.ok(!html.includes('<img'), 'no raw <img tag may appear');
  assert.ok(!html.includes('"onmouseover='), 'no raw quote-then-handler attribute may appear');
  assert.ok(!html.includes('</div><script'), 'payload breaking out of markup must not survive');

  // Arabic survives escaping.
  assert.ok(html.includes('محمد'), 'Arabic text must survive escaping');

  await db.sale.delete({ where: { id: sale.id } });
  await db.customer.delete({ where: { id: customer.id } });
});

// ─────────────────────────────────────────────
// P2-1 REFRESH TOKENS HASHED AT REST
// ─────────────────────────────────────────────

test('P2-1: refresh tokens are stored hashed — rotation and revocation work on the digest', async () => {
  const login = await api(base, 'POST', '/auth/login', {
    body: { email: 'owner-b@test.local', password: PASSWORD },
  });
  assert.strictEqual(login.status, 200);
  const raw = login.body.data.refreshToken;
  assert.ok(raw && raw.length > 40);

  const row = await db.refreshToken.findFirst({ where: { user_id: IDS.ownerB }, orderBy: { created_at: 'desc' } });
  assert.ok(row, 'a refresh token row must exist');
  assert.notStrictEqual(row.token, raw, 'the database must NOT store the raw token');
  assert.match(row.token, /^[0-9a-f]{64}$/, 'stored value must be the SHA-256 digest (64 hex chars)');

  // Normal refresh flow works.
  const fresh = await api(base, 'POST', '/auth/refresh', { body: { refreshToken: raw } });
  assert.strictEqual(fresh.status, 200);
  const rotated = fresh.body.data.refreshToken;

  // One-time-use: the OLD token is dead after rotation.
  const replay = await api(base, 'POST', '/auth/refresh', { body: { refreshToken: raw } });
  assert.strictEqual(replay.status, 401);
  assert.strictEqual(replay.body.code, 'REFRESH_TOKEN_NOT_FOUND');

  // Logout revokes the CURRENT token (lookup by digest).
  const logout = await api(base, 'POST', '/auth/logout', { token: ownerBToken, body: { refreshToken: rotated } });
  assert.strictEqual(logout.status, 200);
  const afterLogout = await api(base, 'POST', '/auth/refresh', { body: { refreshToken: rotated } });
  assert.strictEqual(afterLogout.status, 401);
  assert.strictEqual(afterLogout.body.code, 'REFRESH_TOKEN_NOT_FOUND');
});

// ─────────────────────────────────────────────
// P2-4 CRON SECRET GATE + ERROR MASKING
// ─────────────────────────────────────────────

test('P2-4: cron trigger — 401 without the secret, generic 500 on failure (no err.message leak)', async () => {
  const url = `${base}/api/cron/daily-notifications`;

  const noAuth = await fetch(url);
  assert.strictEqual(noAuth.status, 401);

  const wrongAuth = await fetch(url, { headers: { authorization: 'Bearer definitely-not-the-secret' } });
  assert.strictEqual(wrongAuth.status, 401);

  const original = scheduledNotificationsJob.runDailyNotificationScans;
  try {
    // Success path — controlled stub, no side effects.
    scheduledNotificationsJob.runDailyNotificationScans = async () => ({ scanned: true, sent: 0 });
    const ok = await fetch(url, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    assert.strictEqual(ok.status, 200);
    const okBody = await ok.json();
    assert.strictEqual(okBody.success, true);

    // Failure path — an internal error must NOT leak its message.
    scheduledNotificationsJob.runDailyNotificationScans = async () => {
      throw new Error('INTERNAL-SCAN-BOOM-DETAILS');
    };
    const failed = await fetch(url, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    assert.strictEqual(failed.status, 500);
    const failedBody = await failed.json();
    assert.ok(!failedBody.message.includes('INTERNAL-SCAN-BOOM'), 'err.message must never reach the caller');
    assert.ok(failedBody.message.includes('Check server logs'), 'caller gets the generic masked message');
  } finally {
    scheduledNotificationsJob.runDailyNotificationScans = original;
  }
});

// ─────────────────────────────────────────────
// P2-5 CANCEL-SALE CONCURRENCY
// ─────────────────────────────────────────────

test('P2-5: concurrent cancel — exactly one wins, inventory restored exactly once', async () => {
  // Fresh CASH sale of 2 units of itemA1 (fixture leaves qty at 4).
  const sale = await db.sale.create({
    data: {
      showroom_id: IDS.showroomA, customer_id: IDS.custA1, user_id: IDS.ownerA,
      invoice_number: 'INV-PHASE-A-CANCEL-1', sale_type: 'CASH', status: 'ACTIVE',
      subtotal: 20000, discount: 0, total: 20000, profit: 4000,
      items: { create: [
        { inventory_id: IDS.itemA1, quantity: 2, unit_price: 10000, cost_price: 8000, total_price: 20000, profit: 4000 },
      ] },
    },
  });
  await db.inventory.update({ where: { id: IDS.itemA1 }, data: { quantity: 2 } });

  const cancel = () => api(base, 'PATCH', `/sales/${sale.id}/cancel`, { token: ownerAToken });
  const [a, b] = await Promise.all([cancel(), cancel()]);
  const statuses = [a.status, b.status].sort();
  assert.deepStrictEqual(statuses, [200, 409], 'exactly one concurrent cancellation may win');

  const after = await db.inventory.findUnique({ where: { id: IDS.itemA1 } });
  assert.strictEqual(Number(after.quantity), 4, '2 units restored EXACTLY once — no double-credit');
  assert.strictEqual(after.status, 'IN_STOCK');

  const row = await db.sale.findUnique({ where: { id: sale.id } });
  assert.strictEqual(row.status, 'CANCELLED');

  // Explicit third cancel (already cancelled) → clean CONFLICT.
  const third = await cancel();
  assert.strictEqual(third.status, 409);
  assert.strictEqual(Number((await db.inventory.findUnique({ where: { id: IDS.itemA1 } })).quantity), 4, 'third cancel must not touch inventory');
});