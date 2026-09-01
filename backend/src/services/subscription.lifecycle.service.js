// ============================================================
// YS-MATRIX ERP — Subscription Lifecycle Service (Phase 4)
//
// Account/subscription/payment lifecycle + payment boundary.
//
// Separation of concerns:
//   account_status      — PENDING_SUBSCRIPTION | PENDING_PAYMENT | ACTIVE | SUSPENDED | EXPIRED
//   subscription_status — PENDING_PAYMENT | ACTIVE | EXPIRED | CANCELLED (row status)
//   license_status      — derived from showrooms.license_expiry (license middleware, unchanged)
//   user status         — users.is_active (unchanged)
//
// This module owns the CANONICAL ACTIVATION path the whole
// subscription lifecycle funnels through — manual admin approval
// today, gateway webhooks tomorrow. It never knows (or cares) which
// provider confirmed the payment: payment PAID + PENDING_PAYMENT
// subscription is the only contract it reacts to.
//
// Tenant safety: every write is wrapped in
// runWithShowroomContext(showroomId) — the narrow explicit tenant
// passthrough. Reads of cross-tenant data use baseClient and are
// gated by GLOBAL-scope platform permissions at the route layer.
// ============================================================

'use strict';

const prisma                      = require('../config/database');
const { baseClient, runWithShowroomContext } = require('../config/database');
const { getPagination, buildPaginationMeta } = require('../utils/pagination');
const { validatePaymentProof }    = require('../utils/paymentProof');
const { auditLog }                = require('../middleware/audit.middleware');
const { createNotification }      = require('./notification.service');
const logger                      = require('../config/logger');
const SECURITY                    = require('../config/security');

// ═══════════════════════════════════════════════════════════
// DERIVATION (pure)
// ═══════════════════════════════════════════════════════════

const deriveAccountStatus = ({ showroom, latestSubscription }) => {
  if (!showroom || !showroom.is_active) return 'SUSPENDED';
  if (!latestSubscription) return 'PENDING';
  if (latestSubscription.status === 'TRIAL') {
    // TRIAL = registerAccount just created the account — no plan
    // chosen, no payment yet. Phases the account through the store
    // (pick plan → PENDING_PAYMENT → ACTIVE). Account production is
    // PENDING until a real claim exists; ERP routes are gated on
    // this (account.middleware — trial surface stays open). A
    // lapsed TRIAL is flipped to EXPIRED by the expiry cron; before
    // the cron runs, license_expiry (set = trial end) already
    // blocks access — the derivation below is then cosmetic.
    return 'PENDING';
  }
  if (latestSubscription.status === 'PENDING_PAYMENT') return 'PENDING_PAYMENT';
  if (latestSubscription.status === 'ACTIVE') {
    if (latestSubscription.expires_at && new Date(latestSubscription.expires_at) > new Date()) return 'ACTIVE';
    return 'EXPIRED';
  }
  return 'EXPIRED';
};

const enrichSubscription = (subscription) => {
  if (!subscription) return null;
  const now       = new Date();
  const isExpired = !!subscription.expires_at && now > new Date(subscription.expires_at);
  const daysLeft  = subscription.expires_at && !isExpired
    ? Math.ceil((new Date(subscription.expires_at) - now) / (1000 * 60 * 60 * 24))
    : 0;
  return {
    ...subscription,
    is_expired:  isExpired,
    days_left:   isExpired ? 0 : daysLeft,
    status_live: subscription.status === 'PENDING_PAYMENT'
      ? 'PENDING_PAYMENT'
      : isExpired
        ? 'EXPIRED'
        : daysLeft <= 7
          ? 'EXPIRING_SOON'
          : 'ACTIVE',
  };
};

// ═══════════════════════════════════════════════════════════
// PLANS — the sellable catalog
// ═══════════════════════════════════════════════════════════

const getPlans = async ({ activeOnly = true } = {}) => {
  const plans = await baseClient.plan.findMany({
    where:   activeOnly ? { is_active: true } : undefined,
    orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
  });
  return plans.map((p) => ({ ...p, price_amount: parseFloat(p.price_amount) }));
};

// ═══════════════════════════════════════════════════════════
// OWN STATUS — drives the customer subscription UI
// ═══════════════════════════════════════════════════════════

// Phase A (P2-2): the /status payload is tenant-scoped but NOT
// role-homogeneous — proof_data (base64 bank-transfer receipt) and the
// customer-supplied transfer reference are sensitive evidence. They
// are served ONLY to the account OWNER (and platform authorities, who
// have their own access-locked review surface) — never to STAFF. The
// field is excluded server-side, not hidden in the frontend.
const getAccountStatus = async ({ showroomId, viewerRole }) => {
  const includeProof = viewerRole === 'OWNER' || viewerRole === 'SUPER_ADMIN';

  const [showroom, latestSubscription, latestPayment, activeUsers] = await Promise.all([
    baseClient.showroom.findUnique({
      where:  { id: showroomId },
      select: { id: true, name: true, is_active: true, license_expiry: true, is_onboarded: true, created_at: true },
    }),
    // F3: CANCELLED rows are non-actionable — an owner who cancels a
    // renewal claim must derive back to their ACTIVE subscription,
    // not to EXPIRED. The payment history still shows the full story.
    baseClient.subscription.findFirst({
      where:   { showroom_id: showroomId, status: { not: 'CANCELLED' } },
      orderBy: { created_at: 'desc' },
    }),
    baseClient.payment.findFirst({
      where:   { showroom_id: showroomId },
      orderBy: { created_at: 'desc' },
      // Explicit field allowlist — never the full row. proof_data and
      // reference are added only for proof-authorized viewers.
      select:  {
        id: true, subscription_id: true, plan_id: true, plan_name: true, plan_code: true,
        amount: true, currency: true, method: true, provider: true, status: true,
        proof_mime: true, rejection_reason: true, reviewed_by: true, reviewed_at: true,
        created_at: true, updated_at: true,
        ...(includeProof ? { proof_data: true, reference: true } : {}),
      },
    }),
    baseClient.user.count({
      where: { showroom_id: showroomId, is_active: true },
    }),
  ]);

  return {
    account_status:  deriveAccountStatus({ showroom, latestSubscription }),
    subscription:    enrichSubscription(latestSubscription),
    latest_payment:  latestPayment || null,
    // Live usage vs the canonical plan limit (the same snapshot
    // enforceUserLimit enforces at user:create) — displayed in the
    // billing dashboard, but NEVER trusted as the enforcement point.
    usage: {
      users: {
        limit:   latestSubscription?.status === 'ACTIVE' ? latestSubscription.users_limit ?? null : null,
        current: activeUsers,
      },
    },
    // Backend-authoritative manual-transfer instructions for the
    // billing UI (display copy only — see config/security.js).
    payment_instructions: SECURITY.payment.manualInstructions,
    showroom: showroom
      ? {
          id:             showroom.id,
          name:           showroom.name,
          is_active:      showroom.is_active,
          license_expiry: showroom.license_expiry,
          is_onboarded:   showroom.is_onboarded,
        }
      : null,
  };
};

// ═══════════════════════════════════════════════════════════
// REQUEST — customer purchase (OWNER only at the route level)
// ═══════════════════════════════════════════════════════════
// Creates a PENDING_PAYMENT subscription + PENDING Payment in one
// transaction. amount/currency come from the PLAN row server-side —
// never from client input. Rejects when another request is pending
// or a subscription is currently active.

// Shared core: resolve the plan + validate any attached proof BEFORE
// any write. Used by both the first-purchase and renewal paths so
// pricing/proof rules can never drift apart.
//
// Phase C.7: the AMOUNT is resolved by pricing.service.js — from the
// MarketPricing catalog when the caller selected a billing period
// (approved Egypt model), else from the plan row (legacy). The
// client never supplies a price.
const { resolvePrice } = require('./pricing.service');

const resolvePlan = async (planCode, proofData, proofMime, billingPeriod = null) => {
  const plan = await baseClient.plan.findUnique({ where: { code: planCode } });
  if (!plan || !plan.is_active) {
    throw Object.assign(new Error('الباقة غير موجودة أو غير متاحة.'), { code: 'NOT_FOUND' });
  }

  let proof = null;
  if (proofData || proofMime) {
    proof = validatePaymentProof(proofData, proofMime);
    if (!proof.ok) throw Object.assign(new Error(proof.reason), { code: 'VALIDATION_ERROR' });
  }

  const price = await resolvePrice({ plan, billingPeriod });

  return { plan, price, proof };
};

// Shared claim-creation core: the PENDING_PAYMENT subscription +
// PENDING Payment pair, inside the caller's transaction. Callers are
// responsible for the pre-flight state checks (pending/active
// conflicts) that differ between first-purchase and renewal.
const createPendingClaim = async ({ tx, showroomId, plan, price, proof, requestedBy, method = 'MANUAL', reference = null, notes = null }) => {
  const subscription = await tx.subscription.create({
    data: {
      showroom_id:     showroomId,
      plan_id:         plan.id,
      plan_name:       plan.name,
      status:          'PENDING_PAYMENT',
      started_at:      null,
      expires_at:      null,
      price_amount:    price.amount,
      duration_months: price.duration_months,
      users_limit:     plan.users_limit,
      // Phase C.7: billing-period snapshot (null on the legacy path)
      billing_period:  price.billing_period,
      renewed_by:      requestedBy || null,
      notes,
    },
  });

  const payment = await tx.payment.create({
    data: {
      showroom_id:     showroomId,
      subscription_id: subscription.id,
      plan_id:         plan.id,
      plan_name:       plan.name,
      plan_code:       plan.code,
      amount:          price.amount,
      currency:        price.currency,
      method,
      provider:        'MANUAL',
      status:          'PENDING',
      reference:       reference || null,
      proof_mime:      proof ? proof.mime : null,
      proof_data:      proof ? proof.base64 : null,
    },
  });

  return {
    subscription,
    payment: { ...payment, amount: price.amount },
    price_amount: price.amount,
    currency:     price.currency,
  };
};

// Shared claim-creation runner: single transaction + database-level
// duplicate protection (Phase A P1-2). The friendly pre-checks give
// the common path a fast, clear error; the partial unique index
// (showroom_id) WHERE status = 'PENDING_PAYMENT' is the backstop that
// makes concurrent duplicates IMPOSSIBLE — a simultaneous second
// request violates the index and is translated here into the SAME
// user-facing conflict as the pre-check. No raw Prisma errors escape.
const runClaimCreation = (showroomId, fn) =>
  runWithShowroomContext(showroomId, () =>
    prisma.$transaction(async (tx) => {
      try {
        return await fn(tx);
      } catch (err) {
        // P2002 = unique violation (one PENDING_PAYMENT per showroom).
        if (err?.code === 'P2002') {
          throw Object.assign(new Error('يوجد طلب اشتراك قيد المراجعة.'), { code: 'CONFLICT' });
        }
        throw err;
      }
    })
  );

const requestSubscription = async ({
  showroomId,
  requestedBy,
  planCode,
  billingPeriod = null,
  method    = 'MANUAL',
  reference = null,
  proofMime = null,
  proofData = null,
}) => {
  const { plan, price, proof } = await resolvePlan(planCode, proofData, proofMime, billingPeriod);

  return runClaimCreation(showroomId, async (tx) => {
    const pending = await tx.subscription.findFirst({
      where: { showroom_id: showroomId, status: 'PENDING_PAYMENT' },
    });
    if (pending) {
      throw Object.assign(new Error('يوجد طلب اشتراك قيد المراجعة.'), { code: 'CONFLICT' });
    }

    const active = await tx.subscription.findFirst({
      where: { showroom_id: showroomId, status: 'ACTIVE', expires_at: { gt: new Date() } },
    });
    if (active) {
      throw Object.assign(new Error('يوجد اشتراك فعّال حالياً.'), { code: 'CONFLICT' });
    }

    return createPendingClaim({ tx, showroomId, plan, price, proof, requestedBy, method, reference });
  });
};

// ═══════════════════════════════════════════════════════════
// RENEW / UPGRADE — customer renewal while ACTIVE (F2)
// ═══════════════════════════════════════════════════════════
// Same PENDING_PAYMENT claim shape as a first purchase — the
// canonical activation path treats it identically, with one
// deliberate difference: an ACTIVE subscription does NOT block this
// path (that is the point of a renewal). Approval reuses
// activateSubscription's "extend from latest ACTIVE period" math, so
// a renewal approved mid-cycle extends from the current expiry (no
// lost days), and an upgrade swaps the plan snapshot at activation.
// Still blocked when a request is ALREADY pending — one claim at a
// time, exactly like first purchase.
const requestRenewal = async ({
  showroomId,
  requestedBy,
  planCode,
  billingPeriod = null,
  method    = 'MANUAL',
  reference = null,
  proofMime = null,
  proofData = null,
}) => {
  const { plan, price, proof } = await resolvePlan(planCode, proofData, proofMime, billingPeriod);

  return runClaimCreation(showroomId, async (tx) => {
    const pending = await tx.subscription.findFirst({
      where: { showroom_id: showroomId, status: 'PENDING_PAYMENT' },
    });
    if (pending) {
      throw Object.assign(new Error('يوجد طلب اشتراك قيد المراجعة.'), { code: 'CONFLICT' });
    }

    return createPendingClaim({
      tx, showroomId, plan, price, proof, requestedBy, method, reference,
      notes: 'طلب تجديد / ترقية الاشتراك',
    });
  });
};

// ═══════════════════════════════════════════════════════════
// ATTACH/UPDATE OWN PAYMENT PROOF — owner only, PENDING only
// ═══════════════════════════════════════════════════════════

const attachPaymentProof = async ({
  showroomId,
  paymentId,
  proofMime = null,
  proofData = null,
  reference = null,
  method    = null,
}) => {
  let proof = null;
  if (proofData || proofMime) {
    proof = validatePaymentProof(proofData, proofMime);
    if (!proof.ok) throw Object.assign(new Error(proof.reason), { code: 'VALIDATION_ERROR' });
  }

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, showroom_id: showroomId },
  });
  if (!payment) throw Object.assign(new Error('الدفعة غير موجودة.'), { code: 'NOT_FOUND' });
  if (payment.status !== 'PENDING') {
    throw Object.assign(new Error('لا يمكن تعديل دفعة تمت معالجتها.'), { code: 'CONFLICT' });
  }

  return prisma.payment.update({
    where: { id: paymentId },
    data:  {
      ...(proof ? { proof_mime: proof.mime, proof_data: proof.base64 } : {}),
      ...(reference !== null && reference !== undefined ? { reference } : {}),
      ...(method ? { method } : {}),
    },
  });
};

// ═══════════════════════════════════════════════════════════
// OWN PAYMENT HISTORY (customer view — no proof payloads here)
// ═══════════════════════════════════════════════════════════

// Phase B.1 (F9): the payment-history list applies the SAME viewer
// gating as getAccountStatus — the customer-supplied transfer
// `reference` is evidence and is served only to the account OWNER
// (and platform authorities). STAFF see the row (status/amount/date
// are harmless business facts) but never the reference. rejection_reason
// is customer-facing copy written by the reviewer FOR the customer, so
// it stays visible to the whole showroom team (matches /status).
const listOwnPayments = async ({ showroomId, query, viewerRole = null }) => {
  const includeProof = viewerRole === 'OWNER' || viewerRole === 'SUPER_ADMIN';
  const { page, limit, skip } = getPagination(query);
  const where = { showroom_id: showroomId };
  if (query.status) where.status = query.status;

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { created_at: 'desc' },
      select:  {
        id: true, plan_name: true, plan_code: true, amount: true, currency: true,
        method: true, provider: true, status: true, rejection_reason: true,
        reviewed_at: true, created_at: true,
        ...(includeProof ? { reference: true } : {}),
      },
    }),
    prisma.payment.count({ where }),
  ]);

  return {
    payments:    payments.map((p) => ({ ...p, amount: parseFloat(p.amount) })),
    pagination:  buildPaginationMeta(total, page, limit),
  };
};

// ═══════════════════════════════════════════════════════════
// CANONICAL ACTIVATION (shared by manual approval + future
// gateway-webhook confirmation — NEVER duplicate this logic)
// ═══════════════════════════════════════════════════════════

const activateSubscription = async ({ subscriptionId, paymentId, reviewedBy, notes = null }) => {
  const [subscription, payment] = await Promise.all([
    baseClient.subscription.findUnique({ where: { id: subscriptionId } }),
    baseClient.payment.findUnique({ where: { id: paymentId } }),
  ]);

  if (!subscription || !payment) {
    throw Object.assign(new Error('الطلب أو الدفعة غير موجودة.'), { code: 'NOT_FOUND' });
  }
  if (payment.subscription_id !== subscription.id || payment.showroom_id !== subscription.showroom_id) {
    throw Object.assign(new Error('الدفعة لا تخص هذا الطلب.'), { code: 'VALIDATION_ERROR' });
  }
  if (subscription.status !== 'PENDING_PAYMENT') {
    throw Object.assign(new Error('لا يمكن تفعيل هذا الاشتراك (حالته الحالية لا تسمح).'), { code: 'CONFLICT' });
  }
  if (payment.status !== 'PENDING') {
    throw Object.assign(new Error('هذه الدفعة تمت معالجتها بالفعل.'), { code: 'CONFLICT' });
  }

  const showroomId = subscription.showroom_id;

  return runWithShowroomContext(showroomId, async () => {
    const now = new Date();

    // Renewal-before-expiry: extend from the latest ACTIVE period
    // if it still has time left; otherwise start from today.
    const latestActive = await prisma.subscription.findFirst({
      where:   { showroom_id: showroomId, status: 'ACTIVE' },
      orderBy: { expires_at: 'desc' },
    });
    const hasActiveFuture = latestActive?.expires_at && new Date(latestActive.expires_at) > now;
    const base = hasActiveFuture ? new Date(latestActive.expires_at) : now;

    const duration  = subscription.duration_months || 1;
    const newExpiry = new Date(base);
    newExpiry.setMonth(newExpiry.getMonth() + duration);

    // Phase A (P1-1): the ENTIRE state transition is ONE atomic
    // transaction — payment → PAID, subscription → ACTIVE, and the
    // showroom license sync are all-or-nothing. Previously the
    // showroom.update ran AFTER the transaction committed; a failure
    // in that window left payment PAID + subscription ACTIVE with a
    // stale license_expiry, and re-approval was impossible (both rows
    // had already moved past their PENDING guards). The conditional
    // updateMany guards are checked INSIDE the transaction, so a
    // CONFLICT throws before anything commits and every leg rolls
    // back together. This remains the ONLY activation path — gateway
    // webhook confirmation funnels through this same function.
    const showroom = await prisma.$transaction(async (tx) => {
      const payClaim = await tx.payment.updateMany({
        where:  { id: paymentId, status: 'PENDING' },
        data:   {
          status:      'PAID',
          reviewed_by: reviewedBy || null,
          reviewed_at: now,
          metadata:    {
            ...(payment.metadata && typeof payment.metadata === 'object' ? payment.metadata : {}),
            activation_note: notes || null,
          },
        },
      });

      if (payClaim.count === 0) {
        throw Object.assign(new Error('هذه الدفعة تمت معالجتها بالفعل.'), { code: 'CONFLICT' });
      }

      const subClaim = await tx.subscription.updateMany({
        where:  { id: subscriptionId, status: 'PENDING_PAYMENT' },
        data:   { status: 'ACTIVE', started_at: now, expires_at: newExpiry, approved_at: now },
      });

      if (subClaim.count === 0) {
        throw Object.assign(new Error('هذا الاشتراك تمت معالجته بالفعل.'), { code: 'CONFLICT' });
      }

      // Third leg of the transition, inside the SAME transaction:
      // license_expiry/is_active on the showroom are only ever synced
      // atomically with the payment + subscription state.
      return tx.showroom.update({
        where: { id: showroomId },
        data:  {
          license_expiry:            newExpiry,
          is_active:                 true,
          license_warning_sent_days: null,
        },
      });
    });

    const activated = await prisma.subscription.findUnique({
      where:   { id: subscriptionId },
      include: { plan: { select: { name: true, code: true, users_limit: true } } },
    });

    return {
      subscription:  enrichSubscription(activated),
      payment_id:    paymentId,
      showroom_id:   showroomId,
      new_expiry:    newExpiry,
      users_limit:   activated?.users_limit ?? null,
      showroom_name: showroom.name,
    };
  });
};

// ═══════════════════════════════════════════════════════════
// REJECT PAYMENT (admin) — payment → REJECTED, request → CANCELLED
// ═══════════════════════════════════════════════════════════

// Admin approve entry point — resolves the subscription from the
// payment (payment.subscription_id is the only link the admin UI
// ever sees) then delegates to the canonical activation.
const approvePayment = async ({ paymentId, reviewedBy, notes }) => {
  const payment = await baseClient.payment.findUnique({
    where:  { id: paymentId },
    select: { id: true, subscription_id: true, status: true },
  });
  if (!payment) throw Object.assign(new Error('الدفعة غير موجودة.'), { code: 'NOT_FOUND' });
  if (!payment.subscription_id) {
    throw Object.assign(new Error('الدفعة غير مرتبطة بأي طلب اشتراك.'), { code: 'VALIDATION_ERROR' });
  }
  return activateSubscription({
    subscriptionId: payment.subscription_id,
    paymentId,
    reviewedBy,
    notes,
  });
};

const rejectPayment = async ({ paymentId, reviewedBy, reason }) => {
  const payment = await baseClient.payment.findUnique({
    where:  { id: paymentId },
    select: { id: true, status: true, subscription_id: true, showroom_id: true },
  });
  if (!payment) throw Object.assign(new Error('الدفعة غير موجودة.'), { code: 'NOT_FOUND' });
  if (payment.status !== 'PENDING') {
    throw Object.assign(new Error('هذه الدفعة تمت معالجتها بالفعل.'), { code: 'CONFLICT' });
  }

  const showroomId = payment.showroom_id;
  const planName = payment.subscription_id
    ? (await baseClient.subscription.findUnique({
        where:  { id: payment.subscription_id },
        select: { plan_name: true },
      }))?.plan_name || null
    : null;

  return runWithShowroomContext(showroomId, async () => {
    const now = new Date();
    const [payClaim, subClaim] = await prisma.$transaction([
      prisma.payment.updateMany({
        where:  { id: paymentId, status: 'PENDING' },
        data:   {
          status:          'REJECTED',
          rejection_reason: reason,
          reviewed_by:     reviewedBy || null,
          reviewed_at:     now,
        },
      }),
      payment.subscription_id
        ? prisma.subscription.updateMany({
            where: { id: payment.subscription_id, status: 'PENDING_PAYMENT' },
            data:  { status: 'CANCELLED' },
          })
        : Promise.resolve({ count: 0 }),
    ]);

    if (payClaim.count === 0) {
      throw Object.assign(new Error('هذه الدفعة تمت معالجتها بالفعل.'), { code: 'CONFLICT' });
    }
    return { payment_id: paymentId, showroom_id: showroomId, plan_name: planName, subscription_cancelled: subClaim.count > 0 };
  });
};

// ═══════════════════════════════════════════════════════════
// ADMIN LISTS / SUMMARIES (GLOBAL-scope routes)
// ═══════════════════════════════════════════════════════════

const listAdminSubscriptions = async ({ query }) => {
  const { page, limit, skip } = getPagination(query);
  const { status, showroom_id, search, expiring_in } = query;

  const where = {};
  if (status)      where.status      = status;
  if (showroom_id) where.showroom_id = showroom_id;
  if (expiring_in) {
    const days = parseInt(expiring_in, 10);
    where.expires_at = { lte: new Date(Date.now() + days * 24 * 60 * 60 * 1000), gte: new Date() };
  }
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
        showroom:        { select: { id: true, name: true, slug: true, is_active: true, email: true, phone: true } },
        renewed_by_user: { select: { id: true, name: true } },
        payments:        { select: { id: true, status: true, amount: true, created_at: true }, orderBy: { created_at: 'desc' }, take: 1 },
      },
    }),
    baseClient.subscription.count({ where }),
  ]);

  return {
    subscriptions: subscriptions.map((s) => ({ ...s, ...enrichSubscription(s) })),
    pagination:   buildPaginationMeta(total, page, limit),
  };
};

const getSubscriptionHealthSummary = async () => {
  const now       = new Date();
  const horizon7  = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const [totalShowrooms, activeAccounts, showroomsWithSubscriptions, active, expiringSoon, expired, pendingSubs, pendingPayments, revenueAgg] =
    await Promise.all([
      baseClient.showroom.count(),
      baseClient.showroom.count({ where: { is_active: true } }),
      baseClient.subscription.groupBy({ by: ['showroom_id'] }),
      baseClient.subscription.count({ where: { status: 'ACTIVE', expires_at: { gt: now } } }),
      baseClient.subscription.count({
        where: { status: 'ACTIVE', expires_at: { gt: now, lte: horizon7 } },
      }),
      baseClient.subscription.count({
        where: { status: { in: ['ACTIVE', 'EXPIRED'] }, expires_at: { lt: now } },
      }),
      baseClient.subscription.count({ where: { status: 'PENDING_PAYMENT' } }),
      baseClient.payment.count({ where: { status: 'PENDING' } }),
      baseClient.payment.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }),
    ]);

  return {
    accounts: {
      total:                    totalShowrooms,
      active:                   activeAccounts,
      pending_subscription:     totalShowrooms - showroomsWithSubscriptions.length,
      suspended:                totalShowrooms - activeAccounts,
    },
    subscriptions: {
      active:         active,
      expiring_soon:  expiringSoon,
      expired:        expired,
      pending:        pendingSubs,
      total:          active + expiringSoon + expired + pendingSubs,
    },
    payments: {
      pending:        pendingPayments,
    },
    revenue: {
      total_paid: parseFloat(revenueAgg._sum.amount || 0),
    },
  };
};

const listPaymentsForAdmin = async ({ query }) => {
  const { page, limit, skip } = getPagination(query);
  const { status, showroom_id, search } = query;

  const where = {};
  if (status)      where.status      = status;
  if (showroom_id) where.showroom_id = showroom_id;
  if (search) {
    where.showroom = { name: { contains: search, mode: 'insensitive' } };
  }

  const [payments, total] = await Promise.all([
    baseClient.payment.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { created_at: 'desc' },
      include: {
        showroom:    { select: { id: true, name: true, slug: true, email: true, phone: true, is_active: true } },
        subscription: { select: { id: true, plan_name: true, status: true } },
      },
    }),
    baseClient.payment.count({ where }),
  ]);

  return {
    payments:    payments.map((p) => {
      const row = { ...p, amount: parseFloat(p.amount) };
      delete row.proof_data; // never leak evidence in list payloads
      return row;
    }),
    pagination:  buildPaginationMeta(total, page, limit),
  };
};

// Detail (incl. proof) — access-locked at the route to
// platform_payment:read (GLOBAL) only.
const getPaymentForAdmin = async ({ paymentId }) => {
  const payment = await baseClient.payment.findUnique({
    where:  { id: paymentId },
    include: {
      showroom:    { select: { id: true, name: true, slug: true, email: true, phone: true, is_active: true } },
      subscription: { select: { id: true, plan_name: true, status: true, created_at: true } },
      reviewer:    { select: { id: true, name: true, email: true } },
    },
  });
  if (!payment) throw Object.assign(new Error('الدفعة غير موجودة.'), { code: 'NOT_FOUND' });

  const row = { ...payment, amount: parseFloat(payment.amount) };
  if (!row.proof_data) row.proof_available = false;
  return row;
};

// Customer 360 — platform view of one account
const getShowroomAccountDetail = async ({ showroomId }) => {
  const showroom = await baseClient.showroom.findUnique({
    where:  { id: showroomId },
    include: {
      users: { select: { id: true, name: true, email: true, role: true, is_active: true, last_login: true, created_at: true } },
    },
  });
  if (!showroom) throw Object.assign(new Error('المعرض غير موجود.'), { code: 'NOT_FOUND' });

  const [subscriptions, payments, owner] = await Promise.all([
    baseClient.subscription.findMany({
      where:   { showroom_id: showroomId },
      orderBy: { created_at: 'desc' },
    }),
    baseClient.payment.findMany({
      where:   { showroom_id: showroomId },
      orderBy: { created_at: 'desc' },
      take:    50,
    }),
    baseClient.user.findFirst({
      where: { showroom_id: showroomId, role: 'OWNER' },
      select: { id: true, name: true, email: true, last_login: true, is_active: true },
    }),
  ]);

  const latest = subscriptions.find((s) => s.status !== 'CANCELLED') || null;

  return {
    showroom: {
      id: showroom.id, name: showroom.name, slug: showroom.slug, email: showroom.email,
      phone: showroom.phone, address: showroom.address, is_active: showroom.is_active,
      is_onboarded: showroom.is_onboarded, license_expiry: showroom.license_expiry,
      created_at: showroom.created_at,
    },
    owner,
    // F3: derive from the latest ACTIONABLE row — a cancelled renewal
    // claim must not downgrade an otherwise-active account to EXPIRED.
    account_status: deriveAccountStatus({ showroom, latestSubscription: latest }),
    subscriptions:  subscriptions.map(enrichSubscription),
    payments:       payments.map((p) => ({ ...p, amount: parseFloat(p.amount), proof_data: undefined })),
    users_count:    showroom.users.length,
  };
};

// ═══════════════════════════════════════════════════════════
// PLAN LIMITS — minimal enforcement (users_limit only)
// ═══════════════════════════════════════════════════════════
// Legacy rows (null users_limit / no active plan) are left
// unrestricted — we add an enforced limit, never take one away.
const getUserLimit = async ({ showroomId }) => {
  const sub = await baseClient.subscription.findFirst({
    where:   { showroom_id: showroomId, status: 'ACTIVE', users_limit: { not: null } },
    orderBy: { created_at: 'desc' },
  });
  if (!sub) return null;
  const isExpired = !sub.expires_at || new Date(sub.expires_at) <= new Date();
  if (isExpired) return null;
  return { users_limit: sub.users_limit, plan_name: sub.plan_name, subscription_id: sub.id };
};

const enforceUserLimit = async ({ showroomId }) => {
  const limit = await getUserLimit({ showroomId });
  if (!limit) return;
  const count = await baseClient.user.count({ where: { showroom_id: showroomId, is_active: true } });
  if (count >= limit.users_limit) {
    throw Object.assign(
      new Error(`تم بلوغ الحد الأقصى لعدد المستخدمين (${limit.users_limit}) في باقة ${limit.plan_name}.`),
      { code: 'PLAN_LIMIT_REACHED' }
    );
  }
};

// ═══════════════════════════════════════════════════════════
// CANCEL PENDING REQUEST — customer cancellation (F3)
// ═══════════════════════════════════════════════════════════
// DELETEs the pending purchase/renewal claim atomically:
//   • subscription PENDING_PAYMENT → CANCELLED
//   • its PENDING payment(s) → EXPIRED (PaymentStatus has no
//     CANCELLED — EXPIRED is the honest "no longer collectable"
//     state, reviewed_by records WHO ended it: the owner for the
//     manual path, null for the 72h auto-expiry cron)
// Status-predicated updateMany makes this race-safe: a concurrent
// admin approval flips the rows to ACTIVE/PAID first, this claim
// then matches nothing and reports CONFLICT — the cron path treats
// CONFLICT as "already handled, skip".
const cancelPendingRequest = async ({ showroomId, requestedBy = null, reason = null }) => {
  return runWithShowroomContext(showroomId, async () => {
    const now = new Date();

    const [subClaim, payClaim] = await prisma.$transaction([
      prisma.subscription.updateMany({
        where: { showroom_id: showroomId, status: 'PENDING_PAYMENT' },
        data:  { status: 'CANCELLED', ...(reason ? { notes: reason } : {}) },
      }),
      prisma.payment.updateMany({
        where: { showroom_id: showroomId, status: 'PENDING' },
        data:  { status: 'EXPIRED', reviewed_by: requestedBy || null, reviewed_at: now },
      }),
    ]);

    if (subClaim.count === 0) {
      throw Object.assign(new Error('لا يوجد طلب اشتراك قيد المراجعة.'), { code: 'CONFLICT' });
    }

    return {
      cancelled_subscriptions: subClaim.count,
      expired_payments:        payClaim.count,
      showroom_id:             showroomId,
    };
  });
};

// ═══════════════════════════════════════════════════════════
// STALE REQUEST SCAN — 72h auto-expiry (F3, cron)
// ═══════════════════════════════════════════════════════════
// Runs from the same daily scheduled job. PENDING_PAYMENT claims
// older than the window are cancelled via cancelPendingRequest
// (same canonical path — never duplicated), then a SYSTEM
// notification tells the showroom. Idempotent by construction:
// the status predicate means an already-cancelled/approved claim
// matches nothing; the job-level ScheduledJobRun claim already
// single-flights the daily run.
const runStaleRequestExpiryScan = async ({ olderThanMs = 72 * 60 * 60 * 1000 } = {}) => {
  const cutoff = new Date(Date.now() - olderThanMs);

  const stale = await baseClient.subscription.findMany({
    where: {
      status:     'PENDING_PAYMENT',
      created_at: { lt: cutoff },
    },
    select: { id: true, showroom_id: true, plan_name: true },
  });

  let cancelled = 0;
  let failed    = 0;
  for (const sub of stale) {
    try {
      await cancelPendingRequest({
        showroomId: sub.showroom_id,
        requestedBy: null,
        reason:      'انتهت مهلة مراجعة الطلب (72 ساعة) — أُلغي تلقائياً',
      });
      cancelled++;

      await createNotification({
        showroomId: sub.showroom_id,
        type:   'SYSTEM',
        title:  'انتهت مهلة طلب الاشتراك',
        body:   `انتهت مهلة مراجعة طلب باقة ${sub.plan_name} وأُلغي تلقائياً. يمكنك تقديم طلب جديد من صفحة الاشتراك.`,
        data:   { subscription_id: sub.id, plan_name: sub.plan_name },
        client: baseClient, // cron context — zero ALS, same as the other scanners
      });

      auditLog({
        showroomId: sub.showroom_id,
        userId:     null, // scheduled job — no actor session
        action:     'SUBSCRIPTION_REQUEST_CANCELLED',
        entity:     'subscription',
        entityId:   sub.id,
        newData:    { reason: 'STALE_REQUEST_72H', plan_name: sub.plan_name },
      });
    } catch (err) {
      // CONFLICT = the claim was approved/cancelled meanwhile — skip.
      if (err?.code === 'CONFLICT') continue;
      failed++;
    }
  }

  logger.info(
    `[Lifecycle] Stale request scan — ${cancelled} cancelled / ${failed} failed / ${stale.length} candidates.`
  );
  return { scanned: stale.length, cancelled, failed };
};

module.exports = {
  // pure
  deriveAccountStatus,
  enrichSubscription,
  // customer
  getPlans,
  getAccountStatus,
  requestSubscription,
  requestRenewal,
  attachPaymentProof,
  cancelPendingRequest,
  runStaleRequestExpiryScan,
  listOwnPayments,
  // canonical (shared activation)
  activateSubscription,
  approvePayment,
  rejectPayment,
  // admin
  listAdminSubscriptions,
  getSubscriptionHealthSummary,
  listPaymentsForAdmin,
  getPaymentForAdmin,
  getShowroomAccountDetail,
  // limits
  getUserLimit,
  enforceUserLimit,
};