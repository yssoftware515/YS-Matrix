// ============================================================
// YS-MATRIX ERP — Notification Service (Phase 2 Stage 3)
// ============================================================

'use strict';

const prisma = require('../config/database');
const logger = require('../config/logger');
const { auditLog } = require('../middleware/audit.middleware');
const { getPagination, buildPaginationMeta } = require('../utils/pagination');

// Mirrors enum NotificationType in prisma/schema.prisma. Used ONLY to
// validate the list filter before it reaches Prisma — an unknown value
// would otherwise surface as a Prisma enum error (500) instead of a
// clean 400 VALIDATION_ERROR. Keep in sync whenever the schema enum
// gains a value.
const VALID_NOTIFICATION_TYPES = new Set([
  'INSTALLMENT_OVERDUE',
  'INSTALLMENT_DUE_SOON',
  'LICENSE_EXPIRING',
  'LOW_STOCK',
  'SALE_CREATED',
  'SALE_CANCELLED',
  'PAYMENT_RECEIVED',
  'SYSTEM',
  'SUBSCRIPTION_EXPIRING',
  'SUBSCRIPTION_EXPIRED',
  'SUBSCRIPTION_ACTIVATED',
  'PAYMENT_SUBMITTED',
  'PAYMENT_APPROVED',
  'PAYMENT_REJECTED',
]);

// ─────────────────────────────────────────
// CREATE — internal helper used by other services
// ─────────────────────────────────────────
const createNotification = async ({
  showroomId,
  userId  = null,
  type,
  title,
  body,
  data    = null,
  // F-25 REGRESSION FIX: defaults to the tenant-scoped `prisma` client
  // (correct and desirable for every request-context caller — extra
  // defense-in-depth now that create/createMany/upsert are also
  // tenant-checked). Cron-only callers (notifyInstallmentOverdue,
  // notifyLicenseExpiring below) explicitly pass `baseClient` instead
  // — they run with ZERO AsyncLocalStorage context (no HTTP request,
  // tenantGuard never ran), so the scoped client would now throw
  // TenantContextError on every single call after the F-25 write-path
  // fix. Same reasoning already applied to the `prisma.baseClient
  // .sale.update()` call inside runOverdueInstallmentScan below —
  // this is the same fix, for the same root cause, applied here too.
  client  = prisma,
} = {}) => {
  try {
    return await client.notification.create({
      data: {
        showroom_id: showroomId,
        user_id:     userId,
        type,
        title,
        body,
        data:        data || undefined,
        is_read:     false,
      },
    });
  } catch (err) {
    // Notification creation must NEVER crash the main operation
    logger.error('[Notification] Failed to create:', { type, showroomId, err: err.message });
    return null;
  }
};

// ─────────────────────────────────────────
// LIST — paginated, filter by is_read
// ─────────────────────────────────────────
const listNotifications = async ({ showroomId, userId, query }) => {
  const { page, limit, skip } = getPagination(query);
  const { is_read, type }     = query;

  const where = { showroom_id: showroomId };

  // Optional: scope to a specific user's notifications
  if (userId) where.user_id = userId;

  // Batch 8 (R): validate the filters BEFORE they reach Prisma. A bad
  // `type` used to surface as a Prisma enum error (500); a non-boolean
  // `is_read` was silently coerced to false. Both now fail cleanly
  // with a 400 VALIDATION_ERROR — a garbage filter belongs to the
  // client, not to a server error bucket. Duplicate query keys
  // (?type=a&type=b → array) are rejected here too, rather than
  // exploding later inside the enum filter.
  if (type !== undefined) {
    if (!VALID_NOTIFICATION_TYPES.has(type)) {
      throw Object.assign(new Error('قيمة نوع الإشعار غير صالحة.'), {
        code:   'VALIDATION_ERROR',
        errors: { type: 'قيمة غير صالحة' },
      });
    }
    where.type = type;
  }
  if (is_read !== undefined) {
    if (is_read !== 'true' && is_read !== 'false') {
      throw Object.assign(new Error('قيمة is_read يجب أن تكون true أو false.'), {
        code:   'VALIDATION_ERROR',
        errors: { is_read: 'يجب أن تكون true أو false' },
      });
    }
    where.is_read = is_read === 'true';
  }

  const [notifications, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { created_at: 'desc' },
    }),
    prisma.notification.count({ where }),
  ]);

  // Unread count — always useful for badge
  const unreadCount = await prisma.notification.count({
    where: { showroom_id: showroomId, is_read: false },
  });

  return {
    notifications,
    pagination: buildPaginationMeta(total, page, limit),
    unread_count: unreadCount,
  };
};

// ─────────────────────────────────────────
// MARK ONE AS READ
// ─────────────────────────────────────────
const markAsRead = async ({ showroomId, id }) => {
  const notification = await prisma.notification.findFirst({
    where: { id, showroom_id: showroomId },
  });

  if (!notification) {
    throw Object.assign(new Error('الإشعار غير موجود.'), { code: 'NOT_FOUND' });
  }

  if (notification.is_read) return notification;

  return prisma.notification.update({
    where: { id },
    data:  { is_read: true, read_at: new Date() },
  });
};

// ─────────────────────────────────────────
// MARK ALL AS READ
// ─────────────────────────────────────────
const markAllAsRead = async ({ showroomId, userId = null }) => {
  const where = { showroom_id: showroomId, is_read: false };
  if (userId) where.user_id = userId;

  const result = await prisma.notification.updateMany({
    where,
    data: { is_read: true, read_at: new Date() },
  });

  return { updated: result.count };
};

// ─────────────────────────────────────────
// DELETE OLD NOTIFICATIONS (cleanup)
// ─────────────────────────────────────────
const deleteOldNotifications = async ({ showroomId, daysOld = 30 }) => {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);

  const result = await prisma.notification.deleteMany({
    where: {
      showroom_id: showroomId,
      is_read:     true,
      created_at:  { lt: cutoff },
    },
  });

  return { deleted: result.count };
};

// ─────────────────────────────────────────
// UNREAD COUNT ONLY (for navbar badge)
// ─────────────────────────────────────────
const getUnreadCount = async ({ showroomId }) => {
  const count = await prisma.notification.count({
    where: { showroom_id: showroomId, is_read: false },
  });
  return { unread_count: count };
};

// ─────────────────────────────────────────
// AUTO-GENERATORS — called by other services
// ─────────────────────────────────────────

/** Called after createSale */
const notifySaleCreated = (showroomId, { invoiceNumber, total, customerName }) =>
  createNotification({
    showroomId,
    type:  'SALE_CREATED',
    title: 'فاتورة جديدة',
    body:  `تم إنشاء الفاتورة ${invoiceNumber} بمبلغ ${total}${customerName ? ` للعميل ${customerName}` : ''}.`,
    data:  { invoice_number: invoiceNumber, total },
  });

/** Called after cancelSale */
const notifySaleCancelled = (showroomId, { invoiceNumber }) =>
  createNotification({
    showroomId,
    type:  'SALE_CANCELLED',
    title: 'فاتورة ملغاة',
    body:  `تم إلغاء الفاتورة ${invoiceNumber}.`,
    data:  { invoice_number: invoiceNumber },
  });

/** Called after addPayment */
const notifyPaymentReceived = (showroomId, { supplierName, amount }) =>
  createNotification({
    showroomId,
    type:  'PAYMENT_RECEIVED',
    title: 'دفعة مُسجَّلة',
    body:  `تم تسجيل دفعة ${amount} للمورد ${supplierName}.`,
    data:  { supplier_name: supplierName, amount },
  });

/**
 * Called after payInstallment (sales.service.js) — Phase C.2 (AUD-1).
 * CUSTOMER-payment flavour: the supplier-flavoured notifyPaymentReceived
 * above is explicitly NOT reused for installments (its wording says
 * "للمورد"). Same PAYMENT_RECEIVED type (existing enum value — no
 * schema change, and the frontend's NOTIFICATION_CONFIG already maps
 * it), but the Arabic copy states the installment + invoice + customer.
 */
const notifyInstallmentPayment = (showroomId, { invoiceNumber, amount, customerName }) =>
  createNotification({
    showroomId,
    type:  'PAYMENT_RECEIVED',
    title: 'دفعة قسط مستلمة',
    body:  `تم تسجيل قسط بمبلغ ${amount} على الفاتورة ${invoiceNumber}${customerName ? ` للعميل ${customerName}` : ''}.`,
    data:  { invoice_number: invoiceNumber, amount, customer_name: customerName || null },
  });

/**
 * Called by scheduled job — overdue installments.
 *
 * Explicitly uses baseClient (see createNotification's `client`
 * param docs above): this is invoked ONLY from
 * runOverdueInstallmentScan, which runs with zero AsyncLocalStorage
 * tenant context. Do NOT remove this — the scoped default would
 * throw TenantContextError on every call from that cron path.
 */
const notifyInstallmentOverdue = (showroomId, { invoiceNumber, customerName, amount, dueDate }) =>
  createNotification({
    showroomId,
    type:   'INSTALLMENT_OVERDUE',
    title:  'قسط متأخر',
    body:   `قسط بمبلغ ${amount} للعميل ${customerName} (${invoiceNumber}) متأخر منذ ${dueDate}.`,
    data:   { invoice_number: invoiceNumber, customer_name: customerName, amount, due_date: dueDate },
    client: prisma.baseClient,
  });

/**
 * Called by scheduled job — license expiring.
 * Same cron-context reasoning as notifyInstallmentOverdue above.
 */
const notifyLicenseExpiring = (showroomId, { daysLeft, expiryDate }) =>
  createNotification({
    showroomId,
    type:   'LICENSE_EXPIRING',
    title:  'الاشتراك ينتهي قريباً',
    body:   `اشتراكك ينتهي خلال ${daysLeft} يوم (${expiryDate}). تواصل مع المسؤول للتجديد.`,
    data:   { days_left: daysLeft, expiry_date: expiryDate },
    client: prisma.baseClient,
  });

/** Called when inventory quantity <= threshold */
const notifyLowStock = (showroomId, { brand, model, quantity }) =>
  createNotification({
    showroomId,
    type:  'LOW_STOCK',
    title: 'مخزون منخفض',
    body:  `الكمية المتبقية من ${brand} ${model} هي ${quantity} فقط.`,
    data:  { brand, model, quantity },
  });

// ─────────────────────────────────────────
// PHASE 4 — SUBSCRIPTION LIFECYCLE NOTIFICATIONS
// ─────────────────────────────────────────

/** Subscription purchased/request submitted — customer sees Pending */
// Fires from the tenant self-service surface, but ALSO from platform
// admin flows — both are system-generated writes keyed by an explicit
// showroomId; use baseClient (same precedent as notifyInstallmentOverdue
// /notifyLicenseExpiring) so the scoped-client TenantContextError can
// never surface from file-less admin routes (no tenantGuard runs there).
const notifyPaymentSubmitted = (showroomId, { planName, amount }) =>
  createNotification({
    showroomId,
    type:  'PAYMENT_SUBMITTED',
    title: 'طلب الاشتراك قيد المراجعة',
    body:  `تم استلام طلب اشتراكك في باقة ${planName} بمبلغ ${amount}. سيتم تفعيل حسابك بعد الموافقة.`,
    data:  { plan_name: planName, amount },
    client: prisma.baseClient,
  });

/** Admin approved the manual payment → subscription activated */
const notifySubscriptionActivated = (showroomId, { planName, expiryDate, usersLimit }) =>
  createNotification({
    showroomId,
    type:  'SUBSCRIPTION_ACTIVATED',
    title: 'تم تفعيل اشتراكك',
    body:  `تم تفعيل اشتراك باقة ${planName} حتى ${expiryDate}. عدد المستخدمين المسموح: ${usersLimit || 'غير محدود'}.`,
    data:  { plan_name: planName, expires_at: expiryDate, users_limit: usersLimit },
    client: prisma.baseClient,
  });

/** Admin rejected the payment — reason kept safe & plain text */
const notifyPaymentRejected = (showroomId, { planName, reason }) =>
  createNotification({
    showroomId,
    type:  'PAYMENT_REJECTED',
    title: 'تم رفض طلب الدفع',
    body:  `لم تتم الموافقة على دفعة باقة ${planName}. السبب: ${reason || 'غير محدد'}`,
    data:  { plan_name: planName, reason },
    client: prisma.baseClient,
  });

/** Cron — 7/3/1-day expiry warning for an ACTIVE subscription */
const notifySubscriptionExpiring = (showroomId, { planName, daysLeft, expiryDate }) => {
  const text =
    daysLeft <= 0 ? 'ينتهي اشتراكك اليوم'
    : daysLeft === 1 ? 'ينتهي اشتراكك غداً'
    : `ينتهي اشتراكك خلال ${daysLeft} أيام`;
  return createNotification({
    showroomId,
    type:   'SUBSCRIPTION_EXPIRING',
    title:  'اشتراكك يقترب من الانتهاء',
    body:   `باقة ${planName}: ${text} (${expiryDate}). جدد اشتراكك من صفحة الاشتراك.`,
    data:   { plan_name: planName, days_left: daysLeft, expires_at: expiryDate },
    client: prisma.baseClient,
  });
};

/** Cron — subscription expired (status flipped to EXPIRED) */
const notifySubscriptionExpired = (showroomId, { planName, expiryDate }) =>
  createNotification({
    showroomId,
    type:   'SUBSCRIPTION_EXPIRED',
    title:  'انتهى اشتراكك',
    body:   `انتهت صلاحية باقة ${planName} بتاريخ ${expiryDate}. قم بالتجديد لاستعادة الوصول.`,
    data:   { plan_name: planName, expires_at: expiryDate },
    client: prisma.baseClient,
  });

// ─────────────────────────────────────────
// CROSS-TENANT SCANNERS (Matrix Audit #12 follow-up)
// ─────────────────────────────────────────
// notifyInstallmentOverdue / notifyLicenseExpiring above already
// existed but were never called from anywhere — there was no
// scheduled job. These two scan ACROSS ALL showrooms and call them.
// Intended to be invoked ONLY from jobs/scheduledNotifications.job.js
// (the cron orchestrator), never from a per-request controller.
//
// Safe to run with ZERO AsyncLocalStorage tenant context (a cron job
// has no req/res, so tenantGuard never runs): `installment` and
// `showroom` are both GLOBAL_MODELS in database.js — the Prisma
// extension returns `query(args)` immediately for them, before it
// ever checks for a tenant context, so an unscoped findMany() here is
// correctly unfiltered by design, not by accident. Verified directly
// against database.js's $allOperations hook before writing this.

/**
 * Scans every showroom for unpaid installments whose due_date has
 * passed and that haven't been flagged yet (overdue_notified_at is
 * null), fires notifyInstallmentOverdue for each, then marks it
 * notified. Single-fire per installment by design — see the
 * overdue_notified_at field comment in schema.prisma for why.
 */
const runOverdueInstallmentScan = async () => {
  const overdue = await prisma.installment.findMany({
    where: {
      is_paid:             false,
      due_date:            { lt: new Date() },
      overdue_notified_at: null,
      sale:                { status: 'ACTIVE' },
    },
    include: {
      sale: {
        select: {
          showroom_id:    true,
          invoice_number: true,
          customer:       { select: { name: true } },
        },
      },
    },
  });

  let sent   = 0;
  let failed = 0;
  for (const inst of overdue) {
    const notification = await notifyInstallmentOverdue(inst.sale.showroom_id, {
      invoiceNumber: inst.sale.invoice_number,
      customerName:  inst.sale.customer?.name || 'بدون عميل',
      amount:        inst.amount,
      dueDate:       inst.due_date.toISOString().slice(0, 10),
    });

    // RELIABILITY FIX: only advance the single-fire guard if the
    // notification actually succeeded. createNotification() swallows
    // its own errors and returns null on failure (by design — a
    // notification failure must never crash the cron job), but the
    // guard used to be set UNCONDITIONALLY right after — meaning a
    // transient DB hiccup at send time would permanently suppress
    // this installment's overdue alert forever (the query above only
    // selects rows where overdue_notified_at IS NULL, so a failed
    // attempt that still set it would never be retried by a future
    // run). Now a failed attempt leaves the guard untouched, so the
    // next scheduled run picks it up naturally.
    if (notification) {
      await prisma.installment.update({
        where: { id: inst.id },
        data:  { overdue_notified_at: new Date() },
      });
      sent++;
    } else {
      failed++;
    }

    // Matrix Audit (Phase 2): SaleStatus.OVERDUE existed in
    // schema.prisma and the frontend's SALE_STATUS_CONFIG but was
    // never SET by any backend code — a dead enum value. Set here,
    // the natural point where "this installment just crossed into
    // overdue" is already established. The query above already
    // filters `sale: { status: 'ACTIVE' }`, so every row reaching
    // this point is guaranteed ACTIVE — never overwrites
    // COMPLETED/CANCELLED. Reverted back to ACTIVE/COMPLETED by
    // payInstallment() in sales.service.js once no overdue
    // installments remain for the sale — see there for the matching
    // reversal half of this logic.
    //
    // Deliberately UNCONDITIONAL on the notification outcome above —
    // "this installment is overdue" is a factual business state, not
    // a record of whether we successfully pushed an alert about it.
    // A failed notification must not also leave the sale's status
    // stale/incorrect.
    //
    // Phase C.4 (OVERDUE idempotency): the flip is CONDITIONAL on the
    // sale still being ACTIVE (updateMany where clause) — combined
    // with the outer query's `overdue_notified_at IS NULL` single-fire
    // guard this makes the whole scan idempotent, and the count check
    // below decides whether the audit row for the transition is
    // actually written. Sale rows in a state other than ACTIVE can
    // never be overwritten (defense in depth on top of the query
    // filter above).
    //
    // Uses prisma.baseClient (NOT the tenant-scoped prisma export this
    // file otherwise uses) because `sale` is a SCOPED model and this
    // cron job runs with zero AsyncLocalStorage tenant context — the
    // scoped client would throw TenantContextError immediately. Safe
    // here without any extra showroom_id filter: we're updating ONE
    // specific row already fetched and confirmed to belong to a real
    // showroom via the `sale` include above, by its own primary key.
    const [{ count: flippedToOverdue }] = await prisma.baseClient.$transaction([
      prisma.baseClient.sale.updateMany({
        where: { id: inst.sale_id, status: 'ACTIVE' },
        data:  { status: 'OVERDUE' },
      }),
    ]);

    // Phase C.4 (OVERDUE audit): record the ACTIVE → OVERDUE business
    // transition once per sale. Written via baseClient directly (not
    // the fire-and-forget auditLog helper) because a cron run has no
    // req/res tenant context, and deterministically — the audit row
    // must exist by the time a test checks it. Gated on the same
    // conditional flip that made the status change, so a sale that
    // was already OVERDUE produces no duplicate rows. user_id stays
    // null — this is a system-cron attribution, matching the
    // platform convention for events without a human actor.
    if (flippedToOverdue === 1) {
      await prisma.baseClient.auditLog.create({
        data: {
          showroom_id: inst.sale.showroom_id,
          user_id:     null,
          action:      'SALE_MARKED_OVERDUE',
          entity:      'sale',
          entity_id:   inst.sale_id,
          new_data:    {
            invoice_number: inst.sale.invoice_number,
            installment_id: inst.id,
            reason:         'installment_due_date_passed',
          },
          ip_address: null,
        },
      });
    }
  }

  logger.info(`[Notification] Overdue installment scan — ${sent} sent / ${failed} failed / ${overdue.length} candidates.`);
  return { scanned: overdue.length, sent, failed };
};

/**
 * Scans every active showroom for license_expiry within the configured
 * warning windows (default 30/7/1 days) and fires notifyLicenseExpiring
 * at most once per threshold per showroom. Uses "smallest configured
 * threshold still >= daysLeft" rather than an exact-day match, and
 * compares against the showroom's own license_warning_sent_days, so a
 * missed cron run (server downtime) catches up to the correct level on
 * the next run instead of silently skipping a showroom past a
 * threshold forever. license_warning_sent_days MUST be reset to null
 * whenever license_expiry is renewed — handled in
 * showroom.controller.js's updateShowroom — otherwise a stale value
 * from a PAST expiry cycle would suppress every future warning.
 */
const runLicenseExpiryScan = async ({ warnDaysBefore = [30, 7, 1] } = {}) => {
  const now      = new Date();
  const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const sortedThresholds = [...warnDaysBefore].sort((a, b) => a - b); // ascending: [1,7,30]
  const maxWindow  = sortedThresholds[sortedThresholds.length - 1];
  const horizonUTC = new Date(todayUTC.getTime() + maxWindow * 24 * 60 * 60 * 1000);

  const candidates = await prisma.showroom.findMany({
    where: {
      is_active:      true,
      license_expiry: { gte: todayUTC, lte: horizonUTC },
    },
    select: { id: true, license_expiry: true, license_warning_sent_days: true },
  });

  let sent   = 0;
  let failed = 0;
  for (const showroom of candidates) {
    const expiryUTC = new Date(Date.UTC(
      showroom.license_expiry.getUTCFullYear(),
      showroom.license_expiry.getUTCMonth(),
      showroom.license_expiry.getUTCDate()
    ));
    const daysLeft = Math.round((expiryUTC.getTime() - todayUTC.getTime()) / (24 * 60 * 60 * 1000));

    // Most urgent threshold this showroom currently qualifies for —
    // the SMALLEST configured value that's still >= daysLeft.
    const applicable = sortedThresholds.find((t) => t >= daysLeft);
    if (applicable === undefined) continue; // not within any window yet

    // Already warned at this level or a more urgent one? Skip.
    if (
      showroom.license_warning_sent_days !== null &&
      showroom.license_warning_sent_days <= applicable
    ) {
      continue;
    }

    const notification = await notifyLicenseExpiring(showroom.id, {
      daysLeft,
      expiryDate: expiryUTC.toISOString().slice(0, 10),
    });

    // RELIABILITY FIX — same reasoning as runOverdueInstallmentScan
    // above: only advance license_warning_sent_days if the
    // notification actually succeeded. Previously this was set
    // unconditionally, so a transient failure would permanently
    // suppress the warning at this threshold (the showroom would
    // never be re-evaluated for it — license_warning_sent_days <=
    // applicable would skip it on every future run above). Leaving
    // it untouched on failure lets the next scheduled run retry.
    if (notification) {
      await prisma.showroom.update({
        where: { id: showroom.id },
        data:  { license_warning_sent_days: applicable },
      });
      sent++;
    } else {
      failed++;
    }
  }

  logger.info(`[Notification] License expiry scan — ${sent} sent / ${failed} failed / ${candidates.length} candidates.`);
  return { scanned: candidates.length, sent, failed };
};

// ═══════════════════════════════════════════════════════════
// PHASE 4 — SUBSCRIPTION EXPIRY SCAN (7 / 3 / 1 / 0 days)
// ═══════════════════════════════════════════════════════════
// Runs from the SAME daily scheduled job (scheduledNotifications.job.js),
// which already single-flights the daily run via the ScheduledJobRun
// unique-constraint claim. Per-subscription idempotency is guaranteed
// by subscriptions.expiry_notified_days (mirrors
// showrooms.license_warning_sent_days):
//   • stores the SMALLEST threshold already notified for the period
//   • a missed cron run catches up on the next run (a sub that jumps
//     from 9 → 2 days gets the 3-day alert, then 1-day, never replays)
//   • only advanced when the notification actually succeeded, so a
//     transient failure retries on the next run
//
// At 0 days the subscription status flips ACTIVE → EXPIRED (audit
// recorded by the caller/job). The ACCOUNT is NOT deactivated — the
// owner can still log in and renew; only business routes are blocked
// (license middleware, by expiry date). user/account statuses are
// never touched here.
// ═══════════════════════════════════════════════════════════
const runSubscriptionExpiryScan = async ({ thresholds = [7, 3, 1, 0] } = {}) => {
  const now          = new Date();
  const todayUTC     = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const sorted       = [...thresholds].sort((a, b) => a - b); // [0,1,3,7]
  const maxWindow    = sorted[sorted.length - 1];
  const horizonUTC   = new Date(todayUTC.getTime() + maxWindow * 24 * 60 * 60 * 1000);

  // `subscription` is a SCOPED model — this cron runs with zero ALS
  // context, so it MUST use baseClient (same pattern as the scanners
  // above; do NOT switch to the scoped prisma export). TRIAL claims
  // (registerAccount's 5-day trial — config/commercial.js TRIAL_DAYS)
  // participate in the SAME flip — their access gate is
  // license_expiry anyway; the row flip keeps the dashboard honest.
  const candidates = await prisma.baseClient.subscription.findMany({
    where: {
      status:     { in: ['ACTIVE', 'TRIAL'] },
      expires_at: { lte: horizonUTC },
    },
    select: {
      id: true, showroom_id: true, plan_name: true, status: true, expires_at: true, expiry_notified_days: true,
    },
    orderBy: { expires_at: 'asc' },
  });

  let sent = 0, failed = 0, expired = 0, skipped = 0;

  for (const sub of candidates) {
    const expiryUTC = new Date(Date.UTC(
      sub.expires_at.getUTCFullYear(),
      sub.expires_at.getUTCMonth(),
      sub.expires_at.getUTCDate()
    ));
    const daysLeft = Math.round((expiryUTC.getTime() - todayUTC.getTime()) / (24 * 60 * 60 * 1000));

    const expiryStr = expiryUTC.toISOString().slice(0, 10);

    // ── 0-day: expire the subscription (single-fire state flip) ──
    if (daysLeft <= 0) {
      if (sub.expiry_notified_days === 0) { skipped++; continue; }
      const notification = await notifySubscriptionExpired(sub.showroom_id, {
        planName: sub.plan_name,
        expiryDate: expiryStr,
      });
      if (!notification) { failed++; continue; }
      // Flip status only after a successful notification write, and
      // only if it's still active (guard against racing activation).
      const flip = await prisma.baseClient.subscription.updateMany({
        where: { id: sub.id, status: { in: ['ACTIVE', 'TRIAL'] } },
        data:  { status: 'EXPIRED', expiry_notified_days: 0 },
      });
      if (flip.count === 0) { failed++; continue; }
      expired++; sent++;

      // Audit the state change (AuditLog is a GLOBAL model — safe from
      // this cron context with zero ALS tenant scope). Fire-and-forget
      // like every auditLog call: the flip never waits on it.
      auditLog({
        showroomId: sub.showroom_id,
        userId:     null, // scheduled job — no actor session
        action:     'SUBSCRIPTION_EXPIRED',
        entity:     'subscription',
        entityId:   sub.id,
        newData:    {
          from_status: sub.status,
          plan_name:   sub.plan_name,
          expired_at:  expiryStr,
        },
      });
      continue;
    }

    // ── 7/3/1: smallest threshold this sub currently qualifies for ──
    const applicable = sorted.find((t) => t >= daysLeft && t > 0);
    if (applicable === undefined) { skipped++; continue; }
    if (sub.expiry_notified_days !== null && sub.expiry_notified_days <= applicable) {
      skipped++; continue; // already warned at this or a more urgent level
    }

    const notification = await notifySubscriptionExpiring(sub.showroom_id, {
      planName:  sub.plan_name,
      daysLeft:  daysLeft,
      expiryDate: expiryStr,
    });
    if (!notification) { failed++; continue; }

    const advance = await prisma.baseClient.subscription.updateMany({
      where:  {
        id: sub.id,
        // NULL means "never warned" — SQL NULL fails `lt` comparisons,
        // so the very first warning must be matched explicitly.
        OR: [
          { expiry_notified_days: null },
          { expiry_notified_days: { lt: applicable } },
        ],
      },
      data:   { expiry_notified_days: applicable },
    });
    if (advance.count === 0) { failed++; continue; }
    sent++;
  }

  logger.info(
    `[Notification] Subscription expiry scan — ${sent} sent / ${expired} expired / ${failed} failed / ${skipped} skipped / ${candidates.length} candidates.`
  );
  return { scanned: candidates.length, sent, expired, failed, skipped };
};

module.exports = {
  createNotification,
  listNotifications,
  markAsRead,
  markAllAsRead,
  deleteOldNotifications,
  getUnreadCount,
  // Auto-generators
  notifySaleCreated,
  notifySaleCancelled,
  notifyPaymentReceived,
  notifyInstallmentPayment,
  notifyInstallmentOverdue,
  notifyLicenseExpiring,
  notifyLowStock,
  // Phase 4 — subscription lifecycle
  notifyPaymentSubmitted,
  notifySubscriptionActivated,
  notifyPaymentRejected,
  notifySubscriptionExpiring,
  notifySubscriptionExpired,
  // Cross-tenant scanners (called by jobs/scheduledNotifications.job.js)
  runOverdueInstallmentScan,
  runLicenseExpiryScan,
  runSubscriptionExpiryScan,
};
