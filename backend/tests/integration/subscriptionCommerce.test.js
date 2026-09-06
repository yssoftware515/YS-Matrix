'use strict';
// ============================================================
// Phase 5 — Customer Commerce regression coverage.
//
// Covers the REQUIRED regressions for the commerce phase:
//   • registration hardening: weak password + privilege escalation
//   • showroom rename: related records remain attached to the id,
//     name change propagates to platform views only
//   • renewal-to-system-showroom regression (Phase 4 P1): a
//     SUPER_ADMIN renewal for showroom A must persist under A,
//     never under the system showroom; audit references A
//   • proof security: oversized, unsupported mime, fake magic bytes,
//     cross-tenant attach, platform surface is GLOBAL-scoped
//   • expiry scan writes the SUBSCRIPTION_EXPIRED audit row
// ============================================================
const test   = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, PASSWORD, IDS , unlockAll} = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');
const SECURITY = require('../../src/config/security');
const notificationService = require('../../src/services/notification.service');

// Real 1×1 transparent PNG (magic bytes: 89 50 4E 47 0D 0A 1A 0A)
const REAL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const DAY = 24 * 60 * 60 * 1000;

let base;
let superToken;
let ownerAToken, ownerBToken, staffBToken;

test.before(async () => {
  base = await startServer();
  await seedAll();

  // Tokens are cached — every login counts against the auth rate
  // limiter (10/15min per server instance), so fetch each identity
  // exactly once here.
  superToken  = await tokenFor(base, 'sa@test.local');
  ownerAToken = await tokenFor(base, 'owner-a@test.local');
  ownerBToken = await tokenFor(base, 'owner-b@test.local');
  staffBToken = await tokenFor(base, 'staff-b@test.local');

  // The proof-security tests exercise /subscriptions/request, which
  // resolves the plan server-side first — the fixtures seed no plans,
  // so create the canonical one these tests depend on.
  await db.plan.create({
    data: {
      id: 'plan-commerce-standard', name: 'الباقة الأساسية', code: 'STANDARD',
      price_amount: 500, currency: 'EGP', duration_months: 1, users_limit: 5,
    },
  });
});

test.after(async () => {
  await unlockAll();
  await stopServer();
});

// ─────────────────────────────────────────────
// REGISTRATION HARDENING
// ─────────────────────────────────────────────

test('registration: weak password is rejected (400)', async () => {
  const r = await api(base, 'POST', '/auth/register-account', {
    body: { name: 'Weak PW', email: 'weak-pw@test.local', password: '1234567', showroom_name: 'Weak PW Room' },
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.success, false);
});

test('registration: privilege escalation fields are rejected (strict schema)', async () => {
  const r = await api(base, 'POST', '/auth/register-account', {
    body: {
      name: 'Escalation', email: 'escalate@test.local', password: PASSWORD,
      showroom_name: 'Escalation Room', role: 'SUPER_ADMIN', scope: 'GLOBAL', profile_id: 'p-super',
    },
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.code, 'VALIDATION_ERROR');

  const created = await db.user.findUnique({ where: { email: 'escalate@test.local' } });
  assert.strictEqual(created, null, 'no account may be created with escalation fields');
});

// ─────────────────────────────────────────────
// SHOWROOM NAME / CUSTOMER IDENTITY
// ─────────────────────────────────────────────

test('showroom rename: every relation stays attached to the id, name propagates to views', async () => {
  // Fixtures create related records under sh-a (users, customers,
  // inventory, suppliers, sales). Add a payment + subscription so the
  // commerce surface is covered too.
  const sub = await db.subscription.create({
    data: {
      showroom_id: IDS.showroomA,
      plan_name:   'STANDARD',
      status:      'ACTIVE',
      started_at:  new Date(),
      expires_at:  new Date(Date.now() + 30 * DAY),
    },
  });
  const payment = await db.payment.create({
    data: {
      id: 'pay-rename-a',
      showroom_id: IDS.showroomA,
      subscription_id: sub.id,
      plan_name: 'STANDARD', plan_code: 'STANDARD',
      amount: 500, currency: 'EGP', method: 'MANUAL', provider: 'MANUAL',
      status: 'PAID', reference: 'REN-CK-001',
    },
  });

  const r = await api(base, 'PUT', `/showrooms/${IDS.showroomA}`, {
    token: superToken,
    body:  { name: 'Showroom A Renamed' },
  });
  assert.strictEqual(r.status, 200);

  const showroom = await db.showroom.findUnique({ where: { id: IDS.showroomA } });
  assert.strictEqual(showroom.name, 'Showroom A Renamed');
  assert.strictEqual(showroom.id, IDS.showroomA, 'id must never change on rename');
  assert.strictEqual(showroom.slug, 'showroom-a', 'slug must not regenerate on rename');

  // All foreign-key relations keep their showroom_id — nothing moves.
  const checks = await Promise.all([
    db.user.count({ where: { showroom_id: IDS.showroomA, is_active: true } }),
    db.customer.count({ where: { showroom_id: IDS.showroomA } }),
    db.sale.count({ where: { showroom_id: IDS.showroomA } }),
    db.inventory.count({ where: { showroom_id: IDS.showroomA } }),
    db.subscription.count({ where: { showroom_id: IDS.showroomA } }),
    db.payment.count({ where: { showroom_id: IDS.showroomA } }),
  ]);
  assert.deepStrictEqual(checks, [2, 1, 2, 1, 1, 1], 'all relations remain under sh-a after rename');
  assert.strictEqual((await db.payment.findUnique({ where: { id: 'pay-rename-a' } })).showroom_id, IDS.showroomA);

  // Platform views read the NEW name.
  const list = await api(base, 'GET', '/admin/subscriptions', {
    token: superToken, query: { search: 'Renamed' },
  });
  assert.strictEqual(list.status, 200);
  assert.ok(list.body.data.length >= 1, 'admin subscription search finds the renamed showroom');
  assert.strictEqual(list.body.data[0].showroom.name, 'Showroom A Renamed');

  const detail = await api(base, 'GET', `/admin/showrooms/${IDS.showroomA}/account`, {
    token: superToken,
  });
  assert.strictEqual(detail.status, 200);
  assert.strictEqual(detail.body.data.showroom.name, 'Showroom A Renamed');
});

// ─────────────────────────────────────────────
// RENEWAL REGRESSION (Phase 4 P1)
// ─────────────────────────────────────────────

test('renewal: platform admin renewing showroom A never writes to the system showroom', async () => {
  const beforeSysCount = await db.subscription.count({
    where: { showroom_id: SECURITY.tenant.systemShowroomId },
  });

  const r = await api(base, 'POST', '/subscriptions/renew', {
    token: superToken,
    body:  { showroom_id: IDS.showroomA, months: 1, notes: 'commerce regression renew' },
  });
  assert.strictEqual(r.status, 201);

  // The renewed row belongs to A, ALWAYS.
  assert.strictEqual(r.body.data.subscription.showroom_id, IDS.showroomA);
  assert.strictEqual(r.body.data.showroom_id, IDS.showroomA);

  const persisted = await db.subscription.findUnique({ where: { id: r.body.data.subscription.id } });
  assert.strictEqual(persisted.showroom_id, IDS.showroomA, 'persisted row must stay under showroom A');
  assert.strictEqual(persisted.status, 'ACTIVE');
  assert.ok(persisted.expires_at > new Date(), 'expiration date is in the future');

  // The system showroom received NO accidental record.
  const afterSysCount = await db.subscription.count({
    where: { showroom_id: SECURITY.tenant.systemShowroomId },
  });
  assert.strictEqual(afterSysCount, beforeSysCount, 'system showroom must not gain renewal rows');

  // showroom.license_expiry is synced (backward-compat license gate).
  const showroom = await db.showroom.findUnique({ where: { id: IDS.showroomA } });
  assert.ok(showroom.license_expiry >= persisted.expires_at - (60 * 1000));

  // The audit event references showroom A (not the system showroom).
  const audit = await db.auditLog.findFirst({
    where: {
      action: 'RENEW_SUBSCRIPTION',
      entity_id: persisted.id,
    },
    orderBy: { created_at: 'desc' },
  });
  assert.ok(audit, 'RENEW_SUBSCRIPTION audit must exist');
  assert.strictEqual(audit.showroom_id, IDS.showroomA, 'audit row must be attributed to showroom A');
  assert.strictEqual(audit.new_data.showroom_id, IDS.showroomA);
});

// ─────────────────────────────────────────────
// PAYMENT PROOF SECURITY
// ─────────────────────────────────────────────

test('proof upload: fake PNG magic bytes are rejected (400)', async () => {
  const r = await api(base, 'POST', '/subscriptions/request', {
    token: ownerAToken,
    body:  {
      plan_code: 'STANDARD',
      proof_mime: 'image/png',
      proof_data: Buffer.from('definitely-not-an-image').toString('base64'),
    },
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.code, 'VALIDATION_ERROR');
});

test('proof upload: unsupported mime is rejected (400)', async () => {
  const r = await api(base, 'POST', '/subscriptions/request', {
    token: ownerAToken,
    body:  {
      plan_code: 'STANDARD',
      proof_mime: 'image/gif',
      proof_data: REAL_PNG,
    },
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.code, 'VALIDATION_ERROR');
});

test('proof upload: oversized file is rejected (400)', async () => {
  const big = Buffer.alloc(4 * 1024 * 1024, 0x89); // ~3 MB raw — well over the 2 MB cap
  const r = await api(base, 'POST', '/subscriptions/request', {
    token: ownerAToken,
    body:  {
      plan_code: 'STANDARD',
      proof_mime: 'image/png',
      proof_data: big.toString('base64'),
    },
  });
  assert.strictEqual(r.status, 400);
});

test('cross-tenant: another tenant cannot attach proof to showroom A payment', async () => {
  const paymentA = await db.payment.create({
    data: {
      id: 'pay-xt-a',
      showroom_id: IDS.showroomA,
      plan_name: 'STANDARD', plan_code: 'STANDARD',
      amount: 500, currency: 'EGP', method: 'MANUAL', provider: 'MANUAL',
      status: 'PENDING',
    },
  });
  // No-leak semantics: the foreign owner passes ownerOnly (they ARE an
  // owner), then the tenant-scoped lookup finds nothing → 404. The 404
  // (not 403) deliberately avoids revealing that the payment exists.
  const r = await api(base, 'PATCH', `/subscriptions/payments/${paymentA.id}`, {
    token: ownerBToken,
    body:  { proof_mime: 'image/png', proof_data: REAL_PNG },
  });
  assert.strictEqual(r.status, 404, 'foreign tenant must not see the payment at all');

  // And the foreign owner's own history never contains A's payment.
  const own = await api(base, 'GET', '/subscriptions/payments', {
    token: ownerBToken,
  });
  assert.strictEqual(own.status, 200);
  assert.ok(!own.body.data.some((p) => p.id === paymentA.id), 'own payment list must not leak foreign payments');

  // Owner A can attach to their own payment.
  const ok = await api(base, 'PATCH', `/subscriptions/payments/${paymentA.id}`, {
    token: ownerAToken,
    body:  { proof_mime: 'image/png', proof_data: REAL_PNG, reference: 'XTR-9' },
  });
  assert.strictEqual(ok.status, 200);
});

test('platform payment review surface is GLOBAL-scoped (tenant user → 403)', async () => {
  const r = await api(base, 'GET', '/admin/payments', {
    token: ownerAToken,
  });
  assert.strictEqual(r.status, 403);

  const one = await api(base, 'GET', '/admin/payments/pay-xt-a', {
    token: staffBToken,
  });
  assert.strictEqual(one.status, 403);
});

// ─────────────────────────────────────────────
// EXPIRY AUDIT
// ─────────────────────────────────────────────

test('expiry scan writes a SUBSCRIPTION_EXPIRED audit row on the flip', async () => {
  const r = await api(base, 'POST', '/auth/register-account', {
    body: { name: 'Audit Expire', email: 'audit-expire@test.local', password: PASSWORD, showroom_name: 'Audit Expire Room' },
  });
  const showroomId = r.body.data.showroom.id;
  const claim = await db.subscription.findFirst({ where: { showroom_id: showroomId } });

  await db.subscription.update({
    where: { id: claim.id },
    data:  { expires_at: new Date(Date.now() - DAY) },
  });

  const result = await notificationService.runSubscriptionExpiryScan();
  assert.ok(result.expired >= 1, 'the short trial claim must be flipped');

  const flipped = await db.subscription.findUnique({ where: { id: claim.id } });
  assert.strictEqual(flipped.status, 'EXPIRED');

  const audit = await db.auditLog.findFirst({
    where: { action: 'SUBSCRIPTION_EXPIRED', entity_id: claim.id },
    orderBy: { created_at: 'desc' },
  });
  assert.ok(audit, 'SUBSCRIPTION_EXPIRED audit must exist');
  assert.strictEqual(audit.showroom_id, showroomId);
  assert.strictEqual(audit.new_data.from_status, 'TRIAL');

  const notif = await db.notification.findFirst({
    where: { showroom_id: showroomId, type: 'SUBSCRIPTION_EXPIRED' },
  });
  assert.ok(notif, 'expired notification must exist');
});