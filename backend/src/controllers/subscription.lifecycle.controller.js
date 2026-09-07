// ============================================================
// YS-MATRIX ERP — Subscription Lifecycle Controller (Phase 4)
//
// Customer-facing surface for the Phase 4 account lifecycle:
//   • GET  /api/v1/subscriptions/plans      — sellable catalog
//   • GET  /api/v1/subscriptions/status     — derived account status
//   • POST /api/v1/subscriptions/request    — purchase request (OWNER)
//   • GET  /api/v1/subscriptions/payments   — own payment history
//   • PATCH /api/v1/subscriptions/payments/:id — attach proof/reference
//
// All writes funnel through subscription.lifecycle.service.js —
// this controller is a thin HTTP adapter (validate → call → audit →
// respond). Payment amounts are always derived server-side from the
// plan; this layer never trusts client-supplied figures.
// ============================================================

'use strict';

const lifecycleService = require('../services/subscription.lifecycle.service');
const pricingService   = require('../services/pricing.service');
const response         = require('../utils/response');
const logger           = require('../config/logger');
const { auditLog }     = require('../middleware/audit.middleware');
const { notifyPaymentSubmitted } = require('../services/notification.service');
const { handleServiceError } = require('../utils/errorHandler');

// ─────────────────────────────────────────
// GET /plans — public catalog (authenticated)
// ─────────────────────────────────────────
const listPlans = async (req, res) => {
  try {
    const plans = await lifecycleService.getPlans();
    return response.success(res, plans);
  } catch (err) { return handleServiceError(res, err, { conflictCode: 'ACCOUNT_STATE_CONFLICT' }); }
};

// ─────────────────────────────────────────
// GET /pricing — PUBLIC commercial catalog (billing periods,
// derived prices, trial days). Mounted before authenticate — no
// tenant data. The frontend DISPLAYS trial_days from here; the
// backend remains the authority.
// ─────────────────────────────────────────
const listPricing = async (req, res) => {
  try {
    const catalog = await pricingService.getPricingCatalog({
      market:   req.query.market,
      currency: req.query.currency,
    });
    return response.success(res, catalog);
  } catch (err) { return handleServiceError(res, err, { conflictCode: 'ACCOUNT_STATE_CONFLICT' }); }
};

// ─────────────────────────────────────────
// GET /status — derived account status for the current showroom
// ─────────────────────────────────────────
const getStatus = async (req, res) => {
  try {
    // Phase A (P2-2): the service gates proof-sensitive fields on the
    // viewer role — OWNER/platform see the owner's proof, STAFF never.
    const data = await lifecycleService.getAccountStatus({
      showroomId: req.showroomId,
      viewerRole: req.user.role,
    });
    return response.success(res, data);
  } catch (err) { return handleServiceError(res, err, { conflictCode: 'ACCOUNT_STATE_CONFLICT' }); }
};

// ─────────────────────────────────────────
// POST /request — customer purchase request (OWNER only)
// ─────────────────────────────────────────
const requestSubscription = async (req, res) => {
  try {
    const { plan_code, billing_period, method, reference, proof_mime, proof_data } = req.body;

    const result = await lifecycleService.requestSubscription({
      showroomId:    req.showroomId,
      requestedBy:   req.user.id,
      planCode:      plan_code,
      // Phase C.7: billing period → tier price resolution (absent =
      // legacy plan-row pricing).
      billingPeriod: billing_period,
      method:        method || 'MANUAL',
      reference,
      proofMime:     proof_mime,
      proofData:     proof_data,
    });

    // Live in-app notification to the showroom: request submitted,
    // awaiting admin review.
    notifyPaymentSubmitted(req.showroomId, {
      planName: result.subscription.plan_name,
      amount:   `${result.price_amount} ${result.currency}`,
    }).catch((e) => logger.warn('notifyPaymentSubmitted failed:', e.message));

    auditLog({
      showroomId: req.showroomId,
      userId:     req.user.id,
      action:     'SUBSCRIPTION_REQUESTED',
      entity:     'subscription',
      entityId:   result.subscription.id,
      newData:    { plan_id: result.subscription.plan_id, plan_name: result.subscription.plan_name, amount: result.price_amount },
      ipAddress:  req.ip,
    });

    return response.created(res, result, 'تم إرسال طلب الاشتراك بنجاح. قيد مراجعة الإدارة.');
  } catch (err) { return handleServiceError(res, err, { conflictCode: 'ACCOUNT_STATE_CONFLICT' }); }
};

// ─────────────────────────────────────────
// POST /renew-request — renewal/upgrade request while ACTIVE (F2)
// (OWNER only). Same claim shape as /request — server-side pricing,
// approved through the SAME canonical activation path, extending
// from the current ACTIVE period.
// ─────────────────────────────────────────
const requestRenewal = async (req, res) => {
  try {
    const { plan_code, billing_period, method, reference, proof_mime, proof_data } = req.body;

    const result = await lifecycleService.requestRenewal({
      showroomId:    req.showroomId,
      requestedBy:   req.user.id,
      planCode:      plan_code,
      billingPeriod: billing_period,
      method:        method || 'MANUAL',
      reference,
      proofMime:     proof_mime,
      proofData:     proof_data,
    });

    notifyPaymentSubmitted(req.showroomId, {
      planName: result.subscription.plan_name,
      amount:   `${result.price_amount} ${result.currency}`,
    }).catch((e) => logger.warn('notifyPaymentSubmitted failed:', e.message));

    auditLog({
      showroomId: req.showroomId,
      userId:     req.user.id,
      action:     'SUBSCRIPTION_RENEWAL_REQUESTED',
      entity:     'subscription',
      entityId:   result.subscription.id,
      newData:    { plan_id: result.subscription.plan_id, plan_name: result.subscription.plan_name, amount: result.price_amount },
      ipAddress:  req.ip,
    });

    return response.created(res, result, 'تم إرسال طلب التجديد بنجاح. قيد مراجعة الإدارة.');
  } catch (err) { return handleServiceError(res, err, { conflictCode: 'ACCOUNT_STATE_CONFLICT' }); }
};

// ─────────────────────────────────────────
// DELETE /request — cancel the pending purchase/renewal claim (F3)
// (OWNER only). No body — the claim is scoped to the caller's own
// showroom by tenantGuard. Audited; the 72h auto-expiry cron reuses
// the SAME service function (never duplicated).
// ─────────────────────────────────────────
const cancelPendingRequest = async (req, res) => {
  try {
    const result = await lifecycleService.cancelPendingRequest({
      showroomId:  req.showroomId,
      requestedBy: req.user.id,
      reason:      'أُلغي الطلب بواسطة مالك الحساب',
    });

    auditLog({
      showroomId: req.showroomId,
      userId:     req.user.id,
      action:     'SUBSCRIPTION_REQUEST_CANCELLED',
      entity:     'subscription',
      newData:    { reason: 'OWNER_CANCELLED', cancelled_subscriptions: result.cancelled_subscriptions },
      ipAddress:  req.ip,
    });

    return response.success(res, result, 'تم إلغاء الطلب المعلق.');
  } catch (err) { return handleServiceError(res, err, { conflictCode: 'ACCOUNT_STATE_CONFLICT' }); }
};

// ─────────────────────────────────────────
// GET /payments — own payment history (no proof payloads)
// ─────────────────────────────────────────
const listOwnPayments = async (req, res) => {
  try {
    const { payments, pagination } = await lifecycleService.listOwnPayments({
      showroomId:  req.showroomId,
      query:       req.query,
      // Phase B.1 (F9): role-aware field gating for the history list
      // (reference is evidence — OWNER/platform only, same as /status).
      viewerRole:  req.user.role,
    });
    return response.paginated(res, payments, pagination);
  } catch (err) { return handleServiceError(res, err, { conflictCode: 'ACCOUNT_STATE_CONFLICT' }); }
};

// ─────────────────────────────────────────
// PATCH /payments/:id — attach/replace payment proof + reference
// ─────────────────────────────────────────
const attachPaymentProof = async (req, res) => {
  try {
    const result = await lifecycleService.attachPaymentProof({
      showroomId: req.showroomId,
      paymentId:  req.params.id,
      proofMime:  req.body.proof_mime,
      proofData:  req.body.proof_data,
      reference:  req.body.reference,
      method:     req.body.method,
    });

    auditLog({
      showroomId: req.showroomId,
      userId:     req.user.id,
      action:     'PAYMENT_PROOF_UPDATED',
      entity:     'payment',
      entityId:   result.id,
      newData:    { status: result.status, proof_uploaded: !!(result.proof_mime), reference: result.reference },
      ipAddress:  req.ip,
    });

    return response.success(res, { id: result.id, status: result.status }, 'تم تحديث إثبات الدفع.');
  } catch (err) { return handleServiceError(res, err, { conflictCode: 'ACCOUNT_STATE_CONFLICT' }); }
};

module.exports = {
  listPricing,
  listPlans,
  getStatus,
  requestSubscription,
  requestRenewal,
  cancelPendingRequest,
  listOwnPayments,
  attachPaymentProof,
};