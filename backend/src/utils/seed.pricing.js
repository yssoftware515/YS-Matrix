// ============================================================
// YS-MATRIX ERP — Market Pricing Seeder (Phase C.7 — CORRECTED)
//
// APPROVED COMMERCIAL MODEL (business-owner approved 2026-08-15;
// supersedes the previous Egypt-only 350/1,890/3,486 — 10%/17% model):
//
//   Market      Cur   Monthly  6 mo     6-mo disc   Yearly   Annual disc
//   EGYPT       EGP   350      1,955    7%          3,570    15%
//   SAUDI_ARABIA SAR  65       365      7%          665      15%
//   UAE         AED   65       365      7%          665      15%
//   GLOBAL      USD   19       105      7%          195      15%
//   Trial: 5 days (config/commercial.js — backend authority)
//
// The final amounts are AUTHORITATIVE rounded commercial price
// points — they are stored as-is (final_amount) and NEVER recomputed
// from base × (1 − discount). Only the four approved markets are
// seeded. QAR/KWD/BHD/OMR remain registered currency codes without
// active pricing until the business owner explicitly approves them.
//
// Idempotent: upsert by (market, currency, billing_period). Rows
// already present (operator-adjusted) are SKIPPED — the DB row is
// the operator's source of truth after first seed, mirroring
// seed.plans.js. NEVER deletes or deactivates existing rows; the
// migration 20260815010000 backfills final_amount on any previously
// seeded rows so old 10%/17% Egypt data converges to the approved
// 7%/15% model without touching operator values.
// Run via: npm run db:seed:pricing
// ============================================================

'use strict';

const { baseClient: db } = require('../config/database');
const {
  BILLING_PERIODS,
  APPROVED_PRICING,
} = require('../config/commercial');

// ─────────────────────────────────────────────
// APPROVED FOUR-MARKET CATALOG
// ─────────────────────────────────────────────
// base_amount = the approved monthly base; final_amount = the
// APPROVED customer-facing amount for the period (never derived);
// discount_percent = the displayed commercial policy.
const buildApprovedTiers = () => {
  const tiers = [];
  for (const [market, spec] of Object.entries(APPROVED_PRICING)) {
    for (const period of BILLING_PERIODS) {
      const finalAmount = spec.finals[period.code];
      tiers.push({
        market,
        currency:        spec.currency,
        billing_period:  period.code,
        base_amount:     String(spec.baseMonthly.toFixed(2)),
        discount_percent: String(period.discount_percent.toFixed(2)),
        final_amount:    String(finalAmount.toFixed(2)),
        is_active:       true,
      });
    }
  }
  return tiers;
};

const APPROVED_TIERS = buildApprovedTiers();

async function seedPricing() {
  let created = 0;
  let skipped = 0;

  for (const tier of APPROVED_TIERS) {
    const existing = await db.marketPricing.findUnique({
      where: {
        market_currency_billing_period: {
          market:         tier.market,
          currency:       tier.currency,
          billing_period: tier.billing_period,
        },
      },
    });
    if (existing) {
      // Operator may have adjusted base/discount/final — never overwrite.
      skipped++;
      continue;
    }

    await db.marketPricing.create({
      data: {
        market:          tier.market,
        currency:        tier.currency,
        billing_period:  tier.billing_period,
        base_amount:     tier.base_amount,
        discount_percent: tier.discount_percent,
        final_amount:    tier.final_amount,
        is_active:       tier.is_active,
      },
    });
    created++;
  }

  return { total: APPROVED_TIERS.length, created, skipped };
}

// Direct CLI execution (npm run db:seed:pricing)
if (require.main === module) {
  seedPricing()
    .then((summary) => {
      // eslint-disable-next-line no-console
      console.log(`[PRICING-SEED] PASS — ${summary.total} approved tiers across 4 markets (${summary.created} created, ${summary.skipped} already present).`);
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[PRICING-SEED] FAIL —', err);
      process.exit(1);
    });
}

module.exports = { seedPricing, APPROVED_TIERS };