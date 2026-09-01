// ============================================================
// YS-MATRIX ERP — Commercial Configuration (Phase C.7 — CORRECTED)
//
// THE SINGLE AUTHORITATIVE SOURCE for the commercial model:
//   - billing periods (MONTHLY / SIX_MONTHS / YEARLY)
//   - displayed discount policy per period (7% / 15%)
//   - trial duration (exactly 5 days — backend authoritative;
//     the frontend only ever DISPLAYS this value via the
//     public /subscriptions/pricing endpoint)
//   - the FOUR approved markets (EGYPT / SAUDI_ARABIA / UAE /
//     GLOBAL) with their APPROVED customer-facing final amounts
//
// Pricing correction (2026-08-15, business-owner decision):
//   The previous C.7 model (Egypt-only, 10%/17%) was SUPERSEDED.
//   Final approved customer-facing prices are DELIBERATE rounded
//   commercial price points — they are NOT derived from
//   monthly × months × (1 − discount) and must never be
//   "corrected" back to mathematically exact percentages.
//   The authoritative amount is APPROVED_PRICING (below) and the
//   final_amount column of market_pricing — stored facts, never
//   recalculated.
//
//   effective_monthly / savings_amount are DISPLAY facts derived
//   from the stored final amount (they are not pricing decisions).
//
// Do NOT scatter magic numbers (30/180/365 days) in service code —
// duration always comes from BILLING_PERIODS below.
// ============================================================

'use strict';

// ─────────────────────────────────────────────
// BILLING PERIODS (canonical)
// discount_percent here is the DISPLAYED commercial policy
// (7% for 6 months, 15% for yearly) — the final amounts in
// APPROVED_PRICING are authoritative and are not recomputed from it.
// ─────────────────────────────────────────────
const BILLING_PERIODS = Object.freeze([
  {
    code:            'MONTHLY',
    duration_months: 1,
    discount_percent: 0,
    label_en:        'Monthly',
    label_ar:        'شهري',
    sort_order:      1,
  },
  {
    code:            'SIX_MONTHS',
    duration_months: 6,
    discount_percent: 7,
    label_en:        '6 Months',
    label_ar:        '6 أشهر',
    sort_order:      2,
  },
  {
    code:            'YEARLY',
    duration_months: 12,
    discount_percent: 15,
    label_en:        'Yearly',
    label_ar:        'سنوي',
    sort_order:      3,
  },
]);

// ─────────────────────────────────────────────
// MARKETS & CURRENCIES
// ─────────────────────────────────────────────
// The four APPROVED markets with live pricing. The registered
// currency list is intentionally wider (QAR/KWD/BHD/OMR may remain
// registered as supported codes) but NO pricing row may be created
// for them until the business owner explicitly approves it (see
// test "only the four approved markets carry active pricing").
const SUPPORTED_MARKETS = Object.freeze([
  'EGYPT',
  'SAUDI_ARABIA',
  'UAE',
  'GLOBAL',
]);

const SUPPORTED_CURRENCIES = Object.freeze([
  'EGP', 'SAR', 'AED', 'QAR', 'KWD', 'BHD', 'OMR', 'USD',
]);

const MARKET_DEFAULTS = Object.freeze({
  EGYPT: {
    currency: 'EGP',
    name_en:  'Egypt',
    name_ar:  'مصر',
  },
  SAUDI_ARABIA: {
    currency: 'SAR',
    name_en:  'Saudi Arabia',
    name_ar:  'السعودية',
  },
  UAE: {
    currency: 'AED',
    name_en:  'United Arab Emirates',
    name_ar:  'الإمارات',
  },
  GLOBAL: {
    currency: 'USD',
    name_en:  'Global',
    name_ar:  'العالمية',
  },
});

// ─────────────────────────────────────────────
// TRIAL (exactly 5 days — approved commercial model)
// ─────────────────────────────────────────────
// One authoritative value, consumed by registerAccount and exposed
// (read-only) through the pricing catalog. The frontend never
// determines the trial duration.
const TRIAL_DAYS = 5;

// ─────────────────────────────────────────────
// APPROVED FINAL PRICES — THE AUTHORITATIVE COMMERCIAL TABLE
// (business-owner approved 2026-08-15; YS-MATRIX / YS-SOFTWARE)
//
// baseMonthly  — the single-month price of the offering in the
//                market's currency
// finals       — the APPROVED customer-facing amount per billing
//                period. These are deliberate rounded commercial
//                price points; do NOT recompute them from the
//                displayed discount policy.
// ─────────────────────────────────────────────
const APPROVED_PRICING = Object.freeze({
  EGYPT: Object.freeze({
    currency:    'EGP',
    baseMonthly: 350,
    finals:      Object.freeze({ MONTHLY: 350, SIX_MONTHS: 1955, YEARLY: 3570 }),
  }),
  SAUDI_ARABIA: Object.freeze({
    currency:    'SAR',
    baseMonthly: 65,
    finals:      Object.freeze({ MONTHLY: 65, SIX_MONTHS: 365, YEARLY: 665 }),
  }),
  UAE: Object.freeze({
    currency:    'AED',
    baseMonthly: 65,
    finals:      Object.freeze({ MONTHLY: 65, SIX_MONTHS: 365, YEARLY: 665 }),
  }),
  GLOBAL: Object.freeze({
    currency:    'USD',
    baseMonthly: 19,
    finals:      Object.freeze({ MONTHLY: 19, SIX_MONTHS: 105, YEARLY: 195 }),
  }),
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
const getBillingPeriod = (code) =>
  BILLING_PERIODS.find((p) => p.code === code) || null;

const isBillingPeriod = (code) => BILLING_PERIODS.some((p) => p.code === code);

const isSupportedCurrency = (currency) => SUPPORTED_CURRENCIES.includes(currency);

const getApprovedPricing = (market) => APPROVED_PRICING[market] || null;

// ─────────────────────────────────────────────
// Display derivation (money-safe, cents-exact)
// ─────────────────────────────────────────────
// Takes the AUTHORITATIVE stored final amount (never recomputes it)
// and derives the display facts customers see: the undiscounted
// whole-period base, the effective per-month rate and the savings
// vs. paying monthly. All math is integer cents — no float drift.
const toCents = (amount) => Math.round(parseFloat(amount) * 100);

const derivePeriodDisplay = (baseMonthlyAmount, finalAmount, periodCode) => {
  const period = getBillingPeriod(periodCode);
  if (!period) {
    throw Object.assign(
      new Error(`Billing period '${periodCode}' is not configured.`),
      { code: 'VALIDATION_ERROR' }
    );
  }

  const baseCents = toCents(baseMonthlyAmount) * period.duration_months;
  const finalCents = toCents(finalAmount);
  const effectiveCents = Math.round(finalCents / period.duration_months);

  return {
    billing_period:     period.code,
    duration_months:    period.duration_months,
    discount_percent:   period.discount_percent,
    base_amount:        baseCents / 100,
    final_amount:       finalCents / 100,
    effective_monthly:  effectiveCents / 100,
    savings_amount:     (baseCents - finalCents) / 100,
  };
};

module.exports = {
  BILLING_PERIODS,
  SUPPORTED_MARKETS,
  SUPPORTED_CURRENCIES,
  MARKET_DEFAULTS,
  APPROVED_PRICING,
  TRIAL_DAYS,
  getBillingPeriod,
  isBillingPeriod,
  isSupportedCurrency,
  getApprovedPricing,
  derivePeriodDisplay,
};