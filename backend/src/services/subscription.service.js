// ============================================================
// YS-MATRIX ERP — Subscription Service (Phase 2 Stage 3)
// ============================================================

'use strict';

const prisma = require('../config/database');
// baseClient — UNSCOPED Prisma client. Used ONLY for the two
// SuperAdmin-wide methods below (listAllSubscriptions, getSubscriptionSummary)
// that must see subscriptions across ALL showrooms, not just the
// SuperAdmin's current AsyncLocalStorage tenant context.
//
// WHY THIS MATTERS: tenantGuard injects `showroomId = systemShowroomId`
// into context for SuperAdmin requests that don't specify a target
// showroom. The tenant-scoped `prisma` client auto-filters every
// `subscription.*` query by that showroom_id (since 'subscription' is
// not in GLOBAL_MODELS). Without this fix, /subscriptions/all and
// /subscriptions/summary would silently return only the system
// showroom's data — no error, just wrong (near-empty) results.
const { baseClient } = require('../config/database');
// runWithShowroomContext — the controlled tenant passthrough for
// legitimate GLOBAL operations (Phase 4 P1 fix). renewSubscription
// is invoked from SUPER_ADMIN surfaces where the ambient ALS context
// is the SYSTEM showroom. Without an explicit context for the
// TARGET showroom, the tenant extension in database.js overwrites
// `subscription.create`'s showroom_id with the system showroom —
// renewals for showroom A were persisted against the system
// showroom while license_expiry was updated on A (data-integrity
// split). The wrapper scopes only this transaction to the target.
const { runWithShowroomContext } = require('../config/database');
const { getPagination, buildPaginationMeta } = require('../utils/pagination');

// ─────────────────────────────────────────
// GET CURRENT SUBSCRIPTION for a showroom
// ─────────────────────────────────────────
const getCurrentSubscription = async ({ showroomId }) => {
  const subscription = await prisma.subscription.findFirst({
    where:   { showroom_id: showroomId },
    orderBy: { created_at: 'desc' },
  });

  if (!subscription) return null;

  const now      = new Date();
  const expiry   = new Date(subscription.expires_at);
  const isExpired = now > expiry;
  const daysLeft  = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

  return {
    ...subscription,
    is_expired: isExpired,
    days_left:  isExpired ? 0 : daysLeft,
    status_live: !subscription.status
      ? 'UNKNOWN'
      : isExpired
        ? 'EXPIRED'
        : daysLeft <= 7
          ? 'EXPIRING_SOON'
          : 'ACTIVE',
  };
};

// ─────────────────────────────────────────
// LIST ALL SUBSCRIPTIONS for a showroom
// ─────────────────────────────────────────
const listSubscriptions = async ({ showroomId, query }) => {
  const { page, limit, skip } = getPagination(query);

  const [subscriptions, total] = await Promise.all([
    prisma.subscription.findMany({
      where:   { showroom_id: showroomId },
      skip,
      take:    limit,
      orderBy: { created_at: 'desc' },
      include: {
        renewed_by_user: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.subscription.count({ where: { showroom_id: showroomId } }),
  ]);

  return { subscriptions, pagination: buildPaginationMeta(total, page, limit) };
};

// ─────────────────────────────────────────
// RENEW — SuperAdmin creates a new subscription period
// Also syncs showroom.license_expiry for backward compat
// ─────────────────────────────────────────
const renewSubscription = async ({
  showroomId,
  renewedBy,
  months,
  newExpiryDate,
  planName      = 'STANDARD',
  amountPaid    = null,
  paymentMethod = null,
  notes         = null,
}) => {
  if (!months && !newExpiryDate) {
    throw Object.assign(
      new Error('months أو newExpiryDate مطلوب.'),
      { code: 'VALIDATION_ERROR' }
    );
  }

  const showroom = await prisma.showroom.findUnique({ where: { id: showroomId } });
  if (!showroom) throw Object.assign(new Error('المعرض غير موجود.'), { code: 'NOT_FOUND' });

  // Calculate new expiry
  let newExpiry;
  if (newExpiryDate) {
    newExpiry = new Date(newExpiryDate);
  } else {
    const base = new Date(showroom.license_expiry) > new Date()
      ? new Date(showroom.license_expiry)
      : new Date();
    newExpiry = new Date(base);
    newExpiry.setMonth(newExpiry.getMonth() + parseInt(months, 10));
  }

  // Transaction: create subscription record + update showroom license_expiry
  // PHASE 4 P1 FIX: the whole transaction runs under an explicit
  // tenant context scoped to the TARGET showroom (see header note).
  // This is the ONLY correct way to create a subscription row for a
  // showroom that differs from the ambient ALS context (SUPER_ADMIN
  // requests resolve to the system showroom). The explicit
  // `showroom_id` on create remains as documentation + defense for
  // any future path that bypasses the wrapper.
  const [subscription] = await runWithShowroomContext(showroomId, () =>
    prisma.$transaction([
      prisma.subscription.create({
        data: {
          showroom_id:    showroomId,
          plan_name:      planName,
          status:         'ACTIVE',
          started_at:     new Date(),
          expires_at:     newExpiry,
          renewed_by:     renewedBy || null,
          amount_paid:    amountPaid    ? parseFloat(amountPaid)  : null,
          payment_method: paymentMethod || null,
          notes:          notes         || null,
        },
      }),
      // Keep showroom.license_expiry in sync (backward compat with license middleware)
      prisma.showroom.update({
        where: { id: showroomId },
        data:  {
          license_expiry: newExpiry,
          is_active:      true,   // reactivate if was inactive
          license_warning_sent_days: null,
        },
      }),
    ])
  );

  // Defense-in-depth: verify the tenant extension actually honored
  // the target (guards against future refactors that remove the
  // wrapper above). Fail LOUDLY instead of silently mis-scoping.
  const verify = await baseClient.subscription.findUnique({
    where: { id: subscription.id },
    select: { id: true, showroom_id: true },
  });
  if (!verify || verify.showroom_id !== showroomId) {
    throw Object.assign(
      new Error(
        `Renewal tenant integrity check failed: expected showroom_id=${showroomId} ` +
        `but subscription ${subscription.id} was persisted under ${verify?.showroom_id ?? 'UNKNOWN'}.`
      ),
      { code: 'RENEWAL_TENANT_MISMATCH' }
    );
  }

  return { subscription, showroom_id: showroomId, new_expiry: newExpiry };
};

// ─────────────────────────────────────────
// LIST ALL — SuperAdmin view across all showrooms
// ─────────────────────────────────────────
const listAllSubscriptions = async ({ query }) => {
  const { page, limit, skip } = getPagination(query);
  const { status, showroom_id, expiring_in, search } = query;

  const where = {};
  if (status)      where.status      = status;
  if (showroom_id) where.showroom_id = showroom_id;
  if (expiring_in) {
    const days = parseInt(expiring_in, 10);
    where.expires_at = {
      lte: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
      gte: new Date(),
    };
  }
  // FIX: search was previously accepted as a query param by the
  // frontend but silently ignored here — this method never read
  // req.query.search at all, so the SuperAdmin subscriptions page's
  // search box did nothing despite looking functional. Subscription
  // rows have no searchable text of their own, so this searches by
  // showroom name via the relation, matching the page's placeholder
  // ("بحث بالاسم...").
  if (search) {
    where.showroom = { name: { contains: search, mode: 'insensitive' } };
  }

  const [subscriptions, total] = await Promise.all([
    baseClient.subscription.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { created_at: 'desc' },
      include: {
        // FIX: added email + phone — both real fields on Showroom
        // (confirmed in schema.prisma) that were previously omitted
        // from this select. The SuperAdmin subscriptions page needs
        // showroom contact info to reach out about renewals/billing;
        // without these, the page's showroom.email/phone always
        // rendered as undefined even though the data exists.
        showroom:        { select: { id: true, name: true, slug: true, is_active: true, email: true, phone: true } },
        renewed_by_user: { select: { id: true, name: true } },
      },
    }),
    baseClient.subscription.count({ where }),
  ]);

  const now = new Date();
  const enriched = subscriptions.map((s) => {
    const expiry   = new Date(s.expires_at);
    const expired  = now > expiry;
    const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
    return {
      ...s,
      is_expired: expired,
      days_left:  expired ? 0 : daysLeft,
    };
  });

  return { subscriptions: enriched, pagination: buildPaginationMeta(total, page, limit) };
};

// ─────────────────────────────────────────
// SUMMARY — for SuperAdmin dashboard
// ─────────────────────────────────────────
const getSubscriptionSummary = async () => {
  const now = new Date();

  const [total, active, expiringSoon, expired] = await Promise.all([
    baseClient.subscription.count(),
    baseClient.subscription.count({
      where: { status: 'ACTIVE', expires_at: { gt: now } },
    }),
    baseClient.subscription.count({
      where: {
        status:     'ACTIVE',
        expires_at: {
          gt:  now,
          lte: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      },
    }),
    baseClient.subscription.count({
      where: { expires_at: { lt: now } },
    }),
  ]);

  const revenueAgg = await baseClient.subscription.aggregate({
    _sum: { amount_paid: true },
  });

  return {
    total,
    active,
    expiring_soon: expiringSoon,
    expired,
    total_revenue: parseFloat(revenueAgg._sum.amount_paid || 0),
  };
};

module.exports = {
  getCurrentSubscription,
  listSubscriptions,
  renewSubscription,
  listAllSubscriptions,
  getSubscriptionSummary,
};
