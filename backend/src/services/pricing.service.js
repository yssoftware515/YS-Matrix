// ============================================================
// YS-MATRIX ERP — Pricing Service (Phase C.7 — CORRECTED)
//
// The single server-side path that turns a (plan × billing period)
// selection into a real price. The client can never set an amount:
// every claim amount is derived here from the MarketPricing catalog
// (or, for legacy data, the plan row).
//
// Pricing correction (2026-08-15): the approved customer-facing
// amounts are AUTHORITATIVE STORED FACTS (market_pricing.final_amount).
// They are deliberate rounded commercial price points and are never
// recomputed from base × (1 − discount). The service reads the stored
// final amount and derives only DISPLAY facts (effective_monthly /
// savings) from it.
//
// Resolution contract (backward compatible):
//   * billing_period present in the request AND an active tier
//     exists for (market, currency, billing_period) with an
//     approved final_amount
//       → price = stored final_amount, duration = period months
//   * otherwise (no period, market/currency not configured yet, or
//     no approved final_amount)
//       → legacy plan-row pricing (plan.price_amount × plan duration)
// This keeps every pre-C.7 client and all legacy/fixture plans
// working unchanged, while the approved four-market model is fully
// data-driven.
//
// Only the four approved markets (EGYPT / SAUDI_ARABIA / UAE /
// GLOBAL) may carry active rows — see config/commercial.js and the
// phaseC7 tests. QAR/KWD/BHD/OMR stay registered currency codes
// without active pricing.
// ============================================================

'use strict';

// MarketPricing is GLOBAL configuration (market × currency × period
// catalog, never tenant-scoped) — the SAME reason the plan catalog
// runs on baseClient (see subscription.lifecycle.service.js). The
// scoped client would fail-closed on it (no showroomId in ALS).
const { baseClient: db } = require('../config/database');
const {
  TRIAL_DAYS,
  BILLING_PERIODS,
  SUPPORTED_MARKETS,
  SUPPORTED_CURRENCIES,
  MARKET_DEFAULTS,
  isBillingPeriod,
  derivePeriodDisplay,
} = require('../config/commercial');

const DEFAULT_MARKET  = 'EGYPT';
const DEFAULT_CURRENCY = 'EGP';

// ─────────────────────────────────────────────
// Catalog — public commercial surface
// GET /subscriptions/pricing (public: register page + billing page)
// ─────────────────────────────────────────────
// Returns the ACTIVE tiers of the requested market/currency with the
// APPROVED stored final amounts. Only rows the operator explicitly
// created + activated appear — nothing is ever invented here.
const getPricingCatalog = async ({ market = DEFAULT_MARKET, currency = DEFAULT_CURRENCY } = {}) => {
  if (!SUPPORTED_MARKETS.includes(market)) {
    throw Object.assign(new Error(`Market '${market}' is not registered.`), { code: 'VALIDATION_ERROR' });
  }
  if (!SUPPORTED_CURRENCIES.includes(currency)) {
    throw Object.assign(new Error(`Currency '${currency}' is not registered.`), { code: 'VALIDATION_ERROR' });
  }

  const tiers = await db.marketPricing.findMany({
    where: { market, currency, is_active: true },
  });

  const byPeriod = new Map(tiers.map((t) => [t.billing_period, t]));

  // Order follows the canonical billing-period sequence (not the
  // DB insertion order) so the UI is stable.
  const periods = [];
  for (const period of BILLING_PERIODS) {
    const tier = byPeriod.get(period.code);
    // A tier without an approved final_amount is never served.
    if (!tier || tier.final_amount === null) continue;
    const display = derivePeriodDisplay(tier.base_amount, tier.final_amount, period.code);
    periods.push({
      code:               period.code,
      duration_months:    period.duration_months,
      discount_percent:   period.discount_percent,
      base_amount:        display.base_amount,
      final_amount:       display.final_amount,
      effective_monthly:  display.effective_monthly,
      savings_amount:     display.savings_amount,
      label_en:           period.label_en,
      label_ar:           period.label_ar,
    });
  }

  const marketInfo = MARKET_DEFAULTS[market] || { name_en: market, name_ar: market };

  return {
    market,
    market_name_en: marketInfo.name_en,
    market_name_ar: marketInfo.name_ar,
    currency,
    trial_days:  TRIAL_DAYS, // display-only; the backend is the authority
    periods,
  };
};

// ─────────────────────────────────────────────
// Server-side price resolution for a claim
// ─────────────────────────────────────────────
// @returns { amount, currency, duration_months, billing_period, source }
//   source: 'pricing_tier' | 'plan' (legacy fallback)
const resolvePrice = async ({ plan, billingPeriod = null, market = DEFAULT_MARKET, currency = DEFAULT_CURRENCY }) => {
  // Tier path: only when the caller explicitly selected a billing
  // period AND the market has an active tier with an approved
  // final_amount for it.
  if (billingPeriod && isBillingPeriod(billingPeriod)) {
    const tier = await db.marketPricing.findUnique({
      where: {
        market_currency_billing_period: {
          market, currency, billing_period: billingPeriod,
        },
      },
    });

    if (tier && tier.is_active && tier.final_amount !== null) {
      const period = BILLING_PERIODS.find((p) => p.code === billingPeriod);
      return {
        amount:          parseFloat(tier.final_amount), // AUTHORITATIVE stored fact
        currency:        tier.currency,
        duration_months: period.duration_months,
        billing_period:  billingPeriod,
        market:          tier.market,
        source:          'pricing_tier',
      };
    }
  }

  // Legacy fallback: pre-C.7 data (plans without configured tiers,
  // fixture plans, operator-adjusted plan pricing) — the plan row
  // remains the source of truth for those.
  return {
    amount:          parseFloat(plan.price_amount),
    currency:        plan.currency || DEFAULT_CURRENCY,
    duration_months: plan.duration_months || 1,
    billing_period:  null,
    market:          null,
    source:          'plan',
  };
};

module.exports = {
  getPricingCatalog,
  resolvePrice,
  DEFAULT_MARKET,
  DEFAULT_CURRENCY,
};