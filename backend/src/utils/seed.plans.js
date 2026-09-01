// ============================================================
// YS-MATRIX ERP — Subscription Plan Seeder (Phase C.4 — SUB-01)
//
// P0 LAUNCH BLOCKER: plans table ships EMPTY (no seed, no data
// migration) — the /subscriptions/plans catalog and the whole
// self-service purchase flow return zero plans until this runs.
// This seeder makes the catalog deterministic and idempotent.
//
// Idempotent: upsert by `id` (the stable slug-like code) — safe to
// run any number of times, additive only. NEVER deletes existing
// plans, NEVER touches subscription/payment rows. If a price was
// already changed in the DB (operator-adjusted), this seeder
// deliberately SKIPS the price/limit fields on update — the DB row
// is treated as the operator's source of truth after first seed.
// Run via: npm run db:seed:plans
// ============================================================

'use strict';

const { baseClient: db } = require('../config/database');

// ─────────────────────────────────────────────
// CANONICAL PLAN CATALOG
//
// NOTE ON PRICING (approved commercial model — Phase C.7):
// The business owner APPROVED a single Egypt offering price of
// 350 EGP/month. Plans are TIERS (users_limit / entitlements), NOT
// price points: the price of a period comes from the MarketPricing
// catalog (market × currency × billing period, see seed.pricing.js)
// — plan.price_amount below is the 350 EGP monthly BASE fallback
// for pre-C.7 / unconfigured environments. Re-running the seed
// never overwrites operator-adjusted rows (see seedPlans below).
// ─────────────────────────────────────────────
const PLANS = [
  {
    id:              'standard',   // slug-like stable id — matches Plan.id convention
    name:            'الباقة الأساسية',
    code:            'STANDARD',
    price_amount:    '350.00',    // approved EGP monthly base (billing periods add discounts)
    currency:        'EGP',
    duration_months: 1,
    users_limit:     3,
    sort_order:      1,
    is_active:       true,
    features: {
      title: 'إدارة كاملة للمعرض',
      items: [
        'المخزون والمبيعات والعملاء',
        'الأقساط والمتابعة اليومية',
        'التقارير والإحصائيات الأساسية',
        'دعم فني عبر البريد',
      ],
      // Phase C.7: capability ids (see utils/entitlement.js). Every
      // current plan ships 'core'; add-on modules arrive in future
      // phases as data — never as hard-coded plan conditionals.
      capabilities: ['core'],
    },
  },
  {
    id:              'pro',
    name:            'الباقة الاحترافية',
    code:            'PRO',
    price_amount:    '350.00',
    currency:        'EGP',
    duration_months: 1,
    users_limit:     10,
    sort_order:      2,
    is_active:       true,
    features: {
      title: 'الاحترافية لمتاجر النمو',
      items: [
        'كل مزايا الباقة الأساسية',
        'الموردون والمصروفات',
        'تقارير صافي الربح المتقدمة',
        'أولوية في الدعم الفني',
      ],
      capabilities: ['core'],
    },
  },
  {
    id:              'enterprise',
    name:            'باقة المؤسسات',
    code:            'ENTERPRISE',
    price_amount:    '350.00',
    currency:        'EGP',
    duration_months: 1,
    users_limit:     100,
    sort_order:      3,
    is_active:       true,
    features: {
      title: 'للمؤسسات والفروع المتعددة',
      items: [
        'كل مزايا الباقة الاحترافية',
        'مدير حسابات مخصص',
        'إعداد متخصص حسب الاحتياج',
        'فواتير ضريبية رسمية',
      ],
      capabilities: ['core'],
    },
  },
];

async function seedPlans() {
  let created = 0;
  let skipped = 0;

  for (const plan of PLANS) {
    const existing = await db.plan.findUnique({ where: { id: plan.id } });
    if (existing) {
      // Operator may have adjusted pricing/limits — leave those alone.
      // Only the display/shape fields get synced (name/features/sort).
      await db.plan.update({
        where: { id: plan.id },
        data: {
          name:       plan.name,
          features:   plan.features,
          sort_order: plan.sort_order,
        },
      });
      skipped++;
      continue;
    }

    await db.plan.create({
      data: {
        id:              plan.id,
        name:            plan.name,
        code:            plan.code,
        price_amount:    plan.price_amount,
        currency:        plan.currency,
        duration_months: plan.duration_months,
        users_limit:     plan.users_limit,
        features:        plan.features,
        is_active:       plan.is_active,
        sort_order:      plan.sort_order,
      },
    });
    created++;
  }

  return { total: PLANS.length, created, skipped };
}

// Direct CLI execution (npm run db:seed:plans)
if (require.main === module) {
  seedPlans()
    .then((summary) => {
      // eslint-disable-next-line no-console
      console.log(`[PLAN-SEED] PASS — ${summary.total} plans (${summary.created} created, ${summary.skipped} already present).`);
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[PLAN-SEED] FAIL —', err);
      process.exit(1);
    });
}

module.exports = { seedPlans, PLANS };
