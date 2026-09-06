'use strict';
// ============================================================
// Phase C.7 — APPROVED FOUR-MARKET COMMERCIAL MODEL integration tests.
// (CORRECTED 2026-08-15 — supersedes the Egypt-only 10%/17% suite)
//
// Covers the approved commercial model end to end against the real DB:
//   • PUBLIC /subscriptions/pricing catalog (no auth, no tenant data)
//   • Approved prices (authoritative stored facts, NEVER recomputed
//     from monthly × months × (1 − discount)):
//       EGYPT/EGP   350 / 1,955 / 3,570
//       SAUDI/SAR   65  / 365   / 665
//       UAE/AED     65  / 365   / 665
//       GLOBAL/USD  19  / 105   / 195
//   • Displayed discount policy: 7% (6 months) / 15% (yearly)
//   • Trial = EXACTLY 5 days (backend authority, registerAccount +
//     catalog agree; no 3/10/14-day variants)
//   • billing_period is validated server-side; the client can never
//     set an amount, currency or market (server derives them from
//     MarketPricing rows)
//   • Legacy fallback: requests WITHOUT billing_period keep plan-row
//     pricing (pre-C.7 clients/fixtures stay green)
//   • Plan codes stay stable (STANDARD/PRO/ENTERPRISE, 350 base)
//   • Entitlement capability catalog (core now; addons registered,
//     NOT gated)
//   • Tenant isolation of the lifecycle surface
//   • Only the FOUR approved markets carry active pricing rows —
//     QAR/KWD/BHD/OMR never receive launch pricing
//   • Full purchase → approval → renewal regression with periods
// ============================================================
const test = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, PASSWORD, IDS , unlockAll} = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');

const { seedPricing, APPROVED_TIERS } = require('../../src/utils/seed.pricing');
const { seedPlans }   = require('../../src/utils/seed.plans');
const { TRIAL_DAYS, BILLING_PERIODS, SUPPORTED_MARKETS, derivePeriodDisplay, APPROVED_PRICING } = require('../../src/config/commercial');
const { resolvePrice, getPricingCatalog } = require('../../src/services/pricing.service');
const { hasCapability, getCapabilities, CAPABILITIES } = require('../../src/utils/entitlement');

const DAY = 24 * 60 * 60 * 1000;

// The approved table — single source of expected values in this suite.
const APPROVED = {
  EGYPT:        { currency: 'EGP', monthly: 350, six: 1955, yearly: 3570 },
  SAUDI_ARABIA: { currency: 'SAR', monthly: 65,  six: 365,  yearly: 665  },
  UAE:          { currency: 'AED', monthly: 65,  six: 365,  yearly: 665  },
  GLOBAL:       { currency: 'USD', monthly: 19,  six: 105,  yearly: 195  },
};

let base;
let superToken;
let ownerAToken;
let planStd;   // seeded STANDARD (350 base, 1mo)
let planCustom; // fixture plan (legacy fallback path)

// ── Unit: display derivation works off the STORED final amount ──
test('derivePeriodDisplay: approved four-market numbers, cents-exact', () => {
  // The final amounts are authoritative — derivation only produces
  // display facts (effective_monthly / savings) from the stored final.
  const monthly = derivePeriodDisplay(350, APPROVED.EGYPT.monthly, 'MONTHLY');
  assert.strictEqual(monthly.final_amount, 350);
  assert.strictEqual(monthly.discount_percent, 0);
  assert.strictEqual(monthly.effective_monthly, 350);
  assert.strictEqual(monthly.savings_amount, 0);
  assert.strictEqual(monthly.duration_months, 1);

  const six = derivePeriodDisplay(350, APPROVED.EGYPT.six, 'SIX_MONTHS');
  assert.strictEqual(six.final_amount, 1955);          // AUTHORITATIVE — not 1953
  assert.strictEqual(six.discount_percent, 7);
  assert.strictEqual(six.effective_monthly, 325.83);   // 1955/6
  assert.strictEqual(six.savings_amount, 145);         // 2100 − 1955
  assert.strictEqual(six.duration_months, 6);

  const yearly = derivePeriodDisplay(350, APPROVED.EGYPT.yearly, 'YEARLY');
  assert.strictEqual(yearly.final_amount, 3570);       // AUTHORITATIVE
  assert.strictEqual(yearly.discount_percent, 15);
  assert.strictEqual(yearly.effective_monthly, 297.5); // 3570/12
  assert.strictEqual(yearly.savings_amount, 630);      // 4200 − 3570
  assert.strictEqual(yearly.duration_months, 12);

  assert.throws(() => derivePeriodDisplay(350, 1955, 'WEEKLY'), (e) => e.code === 'VALIDATION_ERROR');
});

test('commercial config: canonical periods + 4 approved markets + exactly 5 trial days', () => {
  assert.deepStrictEqual(
    BILLING_PERIODS.map((p) => p.code),
    ['MONTHLY', 'SIX_MONTHS', 'YEARLY']
  );
  assert.deepStrictEqual(BILLING_PERIODS.map((p) => p.discount_percent), [0, 7, 15]);
  assert.deepStrictEqual(SUPPORTED_MARKETS, ['EGYPT', 'SAUDI_ARABIA', 'UAE', 'GLOBAL']);
  assert.strictEqual(TRIAL_DAYS, 5);
  assert.ok(BILLING_PERIODS.every((p) => Number.isInteger(p.duration_months)));

  // APPROVED_PRICING matches the business-approved table exactly.
  for (const [market, spec] of Object.entries(APPROVED)) {
    const approved = APPROVED_PRICING[market];
    assert.ok(approved, `${market} must exist in APPROVED_PRICING`);
    assert.strictEqual(approved.currency, spec.currency);
    assert.strictEqual(approved.baseMonthly, spec.monthly);
    assert.strictEqual(approved.finals.MONTHLY, spec.monthly);
    assert.strictEqual(approved.finals.SIX_MONTHS, spec.six);
    assert.strictEqual(approved.finals.YEARLY, spec.yearly);
  }
});

test.before(async () => {
  base = await startServer();
  await seedAll();
  // The real seeder under test (idempotent, four approved markets)
  await seedPricing();
  await seedPlans();
  superToken = await tokenFor(base, 'sa@test.local');
  ownerAToken = await tokenFor(base, 'owner-a@test.local');

  planStd = await db.plan.findUnique({ where: { code: 'STANDARD' } });
  planCustom = await db.plan.create({
    data: {
      id: 'plan-c7-custom', name: 'باقة مخصصة', code: 'C7_CUSTOM',
      price_amount: 500, currency: 'EGP', duration_months: 1, users_limit: 2,
    },
  });
});

test.after(async () => {
  await unlockAll();
  await stopServer();
});

// ── Public catalog ───────────────────────────────────────────────
test('GET /subscriptions/pricing is PUBLIC and carries the approved Egypt offer', async () => {
  const r = await api(base, 'GET', '/subscriptions/pricing');
  assert.strictEqual(r.status, 200);

  const c = r.body.data;
  assert.strictEqual(c.market, 'EGYPT');
  assert.strictEqual(c.currency, 'EGP');
  assert.strictEqual(c.trial_days, 5);

  assert.deepStrictEqual(c.periods.map((p) => p.code), ['MONTHLY', 'SIX_MONTHS', 'YEARLY']);

  const byCode = Object.fromEntries(c.periods.map((p) => [p.code, p]));
  assert.strictEqual(byCode.MONTHLY.final_amount, 350);
  assert.strictEqual(byCode.MONTHLY.discount_percent, 0);
  assert.strictEqual(byCode.MONTHLY.effective_monthly, 350);

  assert.strictEqual(byCode.SIX_MONTHS.final_amount, 1955);
  assert.strictEqual(byCode.SIX_MONTHS.discount_percent, 7);
  assert.strictEqual(byCode.SIX_MONTHS.effective_monthly, 325.83);
  assert.strictEqual(byCode.SIX_MONTHS.savings_amount, 145);

  assert.strictEqual(byCode.YEARLY.final_amount, 3570);
  assert.strictEqual(byCode.YEARLY.discount_percent, 15);
  assert.strictEqual(byCode.YEARLY.effective_monthly, 297.5);
  assert.strictEqual(byCode.YEARLY.savings_amount, 630);
});

test('public catalog serves ALL four approved markets with their approved amounts', async () => {
  for (const [market, spec] of Object.entries(APPROVED)) {
    const r = await api(base, 'GET', `/subscriptions/pricing?market=${market}&currency=${spec.currency}`);
    assert.strictEqual(r.status, 200, `${market} must be served`);
    const c = r.body.data;
    assert.strictEqual(c.market, market);
    assert.strictEqual(c.currency, spec.currency);

    const byCode = Object.fromEntries(c.periods.map((p) => [p.code, p]));
    assert.strictEqual(byCode.MONTHLY.final_amount, spec.monthly, `${market} monthly`);
    assert.strictEqual(byCode.MONTHLY.discount_percent, 0);
    assert.strictEqual(byCode.SIX_MONTHS.final_amount, spec.six, `${market} six-month`);
    assert.strictEqual(byCode.SIX_MONTHS.discount_percent, 7);
    assert.strictEqual(byCode.YEARLY.final_amount, spec.yearly, `${market} yearly`);
    assert.strictEqual(byCode.YEARLY.discount_percent, 15);
  }
});

test('public catalog leaks NO tenant data and rejects unregistered market/currency', async () => {
  const r = await api(base, 'GET', '/subscriptions/pricing');
  const raw = JSON.stringify(r.body);
  assert.ok(!raw.includes('showroom'), 'catalog must not expose showroom data');
  assert.ok(!raw.includes('password'), 'catalog must not expose credentials');

  const badMarket = await api(base, 'GET', '/subscriptions/pricing?market=ATLANTIS');
  assert.strictEqual(badMarket.status, 400);

  const badCur = await api(base, 'GET', '/subscriptions/pricing?currency=XYZ');
  assert.strictEqual(badCur.status, 400);
});

test('ONLY the four approved markets carry active pricing — no QAR/KWD/BHD/OMR launch pricing', async () => {
  const rows = await db.marketPricing.findMany();
  assert.strictEqual(rows.length, APPROVED_TIERS.length, 'exactly the approved 12 tiers');

  const keys = new Set(rows.map((r) => `${r.market}|${r.currency}`));
  for (const market of SUPPORTED_MARKETS) {
    assert.ok(keys.has(`${market}|${APPROVED[market].currency}`), `${market} must be seeded`);
  }
  assert.ok(!keys.has('QATAR|QAR') && !keys.has('KUWAIT|KWD') && !keys.has('BAHRAIN|BHD') && !keys.has('OMAN|OMR'),
    'unapproved markets must never be seeded');

  // Every active row carries an approved final_amount.
  for (const row of rows) {
    assert.ok(row.final_amount !== null, `final_amount required for ${row.market}/${row.billing_period}`);
    const spec = APPROVED[row.market];
    assert.ok(spec, `only approved markets may exist, got ${row.market}`);
    const expected = { MONTHLY: spec.monthly, SIX_MONTHS: spec.six, YEARLY: spec.yearly }[row.billing_period];
    assert.strictEqual(parseFloat(row.final_amount), expected, `${row.market} ${row.billing_period}`);
  }

  // A registered-but-unapproved currency in an approved market has no prices.
  const qar = await getPricingCatalog({ market: 'EGYPT', currency: 'QAR' });
  assert.deepStrictEqual(qar.periods, [], 'QAR must have NO active prices');

  // Seeder is idempotent — re-running never duplicates or overwrites.
  const before = await db.marketPricing.count();
  await seedPricing();
  const after = await db.marketPricing.count();
  assert.strictEqual(after, before);
});

// ── Plans & entitlements ─────────────────────────────────────────
test('plan codes stay stable (STANDARD/PRO/ENTERPRISE) with 350 EGP monthly base', async () => {
  assert.ok(planStd, 'STANDARD must exist');
  for (const code of ['STANDARD', 'PRO', 'ENTERPRISE']) {
    const plan = await db.plan.findUnique({ where: { code } });
    assert.ok(plan, `${code} must exist`);
    assert.strictEqual(parseFloat(plan.price_amount), 350);
    assert.strictEqual(plan.duration_months, 1);
    assert.strictEqual(plan.currency, 'EGP');
    assert.ok(plan.is_active);
  }
});

test('entitlement catalog: every plan carries core; addons are registered, not gated', async () => {
  for (const plan of await db.plan.findMany()) {
    assert.ok(hasCapability(plan, 'core'), `${plan.code} must have core capability`);
    assert.strictEqual(hasCapability(plan, 'crm'), false, 'CRM must NOT be active yet');
    assert.strictEqual(hasCapability(plan, 'ai_assistant'), false, 'AI must NOT be active yet');
  }
  assert.deepStrictEqual(getCapabilities(null), ['core'], 'legacy plans default to core');
  const ids = CAPABILITIES.map((c) => c.id);
  assert.ok(ids.includes('digital_showroom'), 'Digital Showroom registered for future phases');
  assert.ok(ids.includes('messaging') && ids.includes('advanced_analytics'));
});

// ── Purchase flow with billing periods (server-derived amounts) ──
test('client-supplied amount is REJECTED (strict schema, 400)', async () => {
  const r = await api(base, 'POST', '/subscriptions/request', {
    token: ownerAToken,
    body: { plan_code: 'STANDARD', billing_period: 'SIX_MONTHS', amount: 1 },
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.code, 'VALIDATION_ERROR');
  assert.ok(r.body.errors?._root, 'unknown field (amount) must be rejected');
});

test('client-supplied currency/market override is REJECTED (strict schema, 400)', async () => {
  const r = await api(base, 'POST', '/subscriptions/request', {
    token: ownerAToken,
    body: { plan_code: 'STANDARD', billing_period: 'SIX_MONTHS', currency: 'USD' },
  });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(r.body.code, 'VALIDATION_ERROR');
});

test('purchase with billing_period: 6-month tier resolves server-side (1,955)', async () => {
  const r = await api(base, 'POST', '/subscriptions/request', {
    token: ownerAToken,
    body: { plan_code: 'STANDARD', billing_period: 'SIX_MONTHS', reference: 'C7-REF-1' },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.data.price_amount, 1955);
  assert.strictEqual(r.body.data.currency, 'EGP');
  assert.strictEqual(r.body.data.subscription.billing_period, 'SIX_MONTHS');
  assert.strictEqual(r.body.data.subscription.duration_months, 6);
  assert.strictEqual(r.body.data.subscription.price_amount, '1955');

  const payment = await db.payment.findFirst({ where: { status: 'PENDING', reference: 'C7-REF-1' } });
  assert.ok(payment);
  assert.strictEqual(parseFloat(payment.amount), 1955);
  assert.strictEqual(payment.currency, 'EGP');

  const sub = await db.subscription.findUnique({ where: { id: r.body.data.subscription.id } });
  assert.strictEqual(sub.billing_period, 'SIX_MONTHS');
  assert.strictEqual(sub.duration_months, 6);
});

test('purchase with billing_period YEARLY resolves 3,570 (12 months)', async () => {
  const showroomId = (await db.subscription.findFirst({ where: { status: 'PENDING_PAYMENT' } })).showroom_id;
  await db.subscription.updateMany({ where: { showroom_id: showroomId, status: 'PENDING_PAYMENT' }, data: { status: 'CANCELLED' } });
  await db.payment.updateMany({ where: { showroom_id: showroomId, status: 'PENDING' }, data: { status: 'EXPIRED' } });

  const r = await api(base, 'POST', '/subscriptions/request', {
    token: ownerAToken,
    body: { plan_code: 'STANDARD', billing_period: 'YEARLY' },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.data.price_amount, 3570);
  assert.strictEqual(r.body.data.subscription.duration_months, 12);
  assert.strictEqual(r.body.data.subscription.billing_period, 'YEARLY');
});

test('billing_period is validated server-side (enum 400)', async () => {
  const r = await api(base, 'POST', '/subscriptions/request', {
    token: ownerAToken,
    body: { plan_code: 'STANDARD', billing_period: 'WEEKLY' },
  });
  assert.strictEqual(r.status, 400);
});

test('approval activates the period claim and license extends for the purchased months', async () => {
  const payment = await db.payment.findFirst({
    where: { status: 'PENDING', subscription: { billing_period: 'YEARLY' } },
    orderBy: { created_at: 'desc' },
  });
  assert.ok(payment, 'YEARLY pending claim must exist');
  const r = await api(base, 'POST', `/admin/payments/${payment.id}/approve`, { token: superToken });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.body.data.subscription.status, 'ACTIVE');

  const sub = await db.subscription.findUnique({ where: { id: r.body.data.subscription.id } });
  const boughtMonths = sub.duration_months;
  assert.strictEqual(sub.billing_period, 'YEARLY');
  const showroom = await db.showroom.findUnique({ where: { id: r.body.data.showroom_id } });
  assert.ok(showroom.license_expiry > new Date(Date.now() + (boughtMonths - 1) * 30 * DAY),
    `license_expiry must cover ${boughtMonths} purchased months`);
});

test('LEGACY fallback: request without billing_period uses plan-row pricing', async () => {
  const pending = await db.subscription.findFirst({ where: { status: 'PENDING_PAYMENT' } });
  if (pending) {
    await db.subscription.updateMany({ where: { showroom_id: pending.showroom_id, status: 'PENDING_PAYMENT' }, data: { status: 'CANCELLED' } });
    await db.payment.updateMany({ where: { showroom_id: pending.showroom_id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
  }
  // The approved YEARLY claim is ACTIVE — lapse it so the plain
  // purchase path is reachable again (same pattern as the Phase 4
  // lifecycle suite).
  const active = await db.subscription.findFirst({ where: { status: 'ACTIVE' } });
  if (active) {
    await db.showroom.update({ where: { id: active.showroom_id }, data: { license_expiry: new Date(Date.now() - DAY) } });
    await db.subscription.updateMany({ where: { showroom_id: active.showroom_id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
  }

  const r = await api(base, 'POST', '/subscriptions/request', {
    token: ownerAToken,
    body: { plan_code: 'C7_CUSTOM' },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.data.price_amount, 500); // fixture plan price — untouched by C.7
  assert.strictEqual(r.body.data.subscription.billing_period, null);
  assert.strictEqual(r.body.data.currency, 'EGP');

  const price = await resolvePrice({ plan: planCustom });
  assert.strictEqual(price.source, 'plan');
  assert.strictEqual(price.amount, 500);
  assert.strictEqual(price.billing_period, null);
});

test('resolvePrice: tier path for approved markets, plan fallback for unapproved currency', async () => {
  // Egypt tier path — approved stored final (1,955), NOT derived.
  const tier = await resolvePrice({ plan: planStd, billingPeriod: 'SIX_MONTHS' });
  assert.strictEqual(tier.source, 'pricing_tier');
  assert.strictEqual(tier.amount, 1955);
  assert.strictEqual(tier.duration_months, 6);

  // Saudi tier path — approved market serves its own amounts.
  const sar = await resolvePrice({ plan: planStd, billingPeriod: 'YEARLY', market: 'SAUDI_ARABIA', currency: 'SAR' });
  assert.strictEqual(sar.source, 'pricing_tier');
  assert.strictEqual(sar.amount, 665);
  assert.strictEqual(sar.currency, 'SAR');

  // QAR is a registered currency but has NO approved pricing → legacy plan fallback.
  const missing = await resolvePrice({ plan: planStd, billingPeriod: 'YEARLY', market: 'EGYPT', currency: 'QAR' });
  assert.strictEqual(missing.source, 'plan', 'no QAR tier → legacy plan fallback');
  assert.strictEqual(missing.amount, 350);
});

test('renewal request with a billing period extends from the new period (server-side)', async () => {
  const pending = await db.subscription.findFirst({ where: { status: 'PENDING_PAYMENT' } });
  if (pending) {
    await db.subscription.updateMany({ where: { showroom_id: pending.showroom_id, status: 'PENDING_PAYMENT' }, data: { status: 'CANCELLED' } });
    await db.payment.updateMany({ where: { showroom_id: pending.showroom_id, status: 'PENDING' }, data: { status: 'EXPIRED' } });
  }

  const r = await api(base, 'POST', '/subscriptions/renew-request', {
    token: ownerAToken,
    body: { plan_code: 'STANDARD', billing_period: 'SIX_MONTHS' },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.data.price_amount, 1955);
  assert.strictEqual(r.body.data.subscription.billing_period, 'SIX_MONTHS');

  const showroomId = r.body.data.subscription.showroom_id;
  const payment = await db.payment.findFirst({ where: { status: 'PENDING' }, orderBy: { created_at: 'desc' } });
  const approve = await api(base, 'POST', `/admin/payments/${payment.id}/approve`, { token: superToken });
  assert.strictEqual(approve.status, 200);
  assert.strictEqual(approve.body.data.subscription.duration_months, 6);
  const showroom = await db.showroom.findUnique({ where: { id: showroomId } });
  assert.ok(showroom.license_expiry > new Date(Date.now() + 5 * 30 * DAY),
    'license_expiry must extend ~6 months on renewal');
});

// ── Trial = exactly 5 days, backend-authoritative ────────────────
test('registerAccount trial is EXACTLY 5 days and matches the catalog', async () => {
  const r = await api(base, 'POST', '/auth/register-account', {
    body: {
      name: 'C7 Trial Owner', email: 'c7-trial@test.local', password: PASSWORD, showroom_name: 'C7 Trial',
    },
  });
  assert.strictEqual(r.status, 201);
  assert.strictEqual(r.body.data.trial.days, 5);
  assert.strictEqual(r.body.data.trial.days, TRIAL_DAYS);

  const catalog = await getPricingCatalog();
  assert.strictEqual(r.body.data.trial.days, catalog.trial_days, 'register + catalog must agree');

  const showroom = await db.showroom.findUnique({ where: { id: r.body.data.showroom.id } });
  const days = Math.round((showroom.license_expiry - new Date()) / DAY);
  assert.ok(days >= 4 && days <= 5, `trial license_expiry ≈ 5 days, got ${days}`);
});

// ── Tenant isolation on the commercial surface ───────────────────
test('tenant isolation: showroom B never sees showroom A claims', async () => {
  const ownerBToken = await tokenFor(base, 'owner-b@test.local');
  const statusB = await api(base, 'GET', '/subscriptions/status', { token: ownerBToken });
  assert.strictEqual(statusB.status, 200);
  const bRaw = JSON.stringify(statusB.body.data);

  const claimsA = await db.subscription.findMany({ where: { showroom_id: IDS.showroomA } });
  for (const c of claimsA) {
    assert.ok(!bRaw.includes(c.id), 'showroom B must not see showroom A subscription ids');
  }

  const payB = await api(base, 'GET', '/subscriptions/payments', { token: ownerBToken });
  assert.strictEqual(payB.status, 200);
  assert.ok(Array.isArray(payB.body.data), 'payments endpoint returns a plain array');
  assert.strictEqual(payB.body.data.length, 0, 'showroom B has no payments of its own');
});