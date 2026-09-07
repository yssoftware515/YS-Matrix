// ============================================================
// YS-MATRIX ERP — Admin Subscription Controller (Phase 4)
//
// Platform-level (GLOBAL) review surface for the account lifecycle:
//   • GET  /api/v1/admin/subscriptions         — all showrooms' subs
//   • GET  /api/v1/admin/subscriptions/summary — health counters
//   • GET  /api/v1/admin/showrooms/:id/account — customer 360 detail
//   • GET  /api/v1/admin/payments              — all payments (list)
//   • GET  /api/v1/admin/payments/:id          — payment detail + proof
//   • POST /api/v1/admin/payments/:id/approve  — activate subscription
//   • POST /api/v1/admin/payments/:id/reject   — reject + cancel request
//
// Every handler runs on the unscoped baseClient through the
// GLOBAL gate (requireScope) — no tenantGuard here, by design
// (see admin.routes.js header).
// Per-route granular permissions via requirePermission('platform_*').
// ============================================================

'use strict';

const lifecycleService = require('../services/subscription.lifecycle.service');
const response         = require('../utils/response');
const logger           = require('../config/logger');
const { auditLog }     = require('../middleware/audit.middleware');
const {
  notifySubscriptionActivated,
  notifyPaymentRejected,
} = require('../services/notification.service');
const { handleServiceError } = require('../utils/errorHandler');

// ─────────────────────────────────────────
// GET /subscriptions — all subscriptions (filters)
// ─────────────────────────────────────────
const listSubscriptions = async (req, res) => {
  try {
    const { subscriptions, pagination } = await lifecycleService.listAdminSubscriptions({
      query: req.query,
    });
    return response.paginated(res, subscriptions, pagination);
  } catch (err) { return handleServiceError(res, err, { conflictCode: 'ACCOUNT_STATE_CONFLICT' }); }
};

// ─────────────────────────────────────────
// GET /subscriptions/summary — health counters
// ─────────────────────────────────────────
const getSummary = async (req, res) => {
  try {
    const data = await lifecycleService.getSubscriptionHealthSummary();
    return response.success(res, data);
  } catch (err) { return handleServiceError(res, err, { conflictCode: 'ACCOUNT_STATE_CONFLICT' }); }
};

// ─────────────────────────────────────────
// GET /showrooms/:id/account — customer 360
// ─────────────────────────────────────────
const getAccountDetail = async (req, res) => {
  try {
    const data = await lifecycleService.getShowroomAccountDetail({ showroomId: req.params.id });
    return response.success(res, data);
  } catch (err) { return handleServiceError(res, err, { conflictCode: 'ACCOUNT_STATE_CONFLICT' }); }
};

// ─────────────────────────────────────────
// GET /payments — all payments (proof stripped from payload)
// ─────────────────────────────────────────
const listPayments = async (req, res) => {
  try {
    const { payments, pagination } = await lifecycleService.listPaymentsForAdmin({
      query: req.query,
    });
    return response.paginated(res, payments, pagination);
  } catch (err) { return handleServiceError(res, err, { conflictCode: 'ACCOUNT_STATE_CONFLICT' }); }
};

// ─────────────────────────────────────────
// GET /payments/:id — detail incl. stored proof evidence
// ─────────────────────────────────────────
const getPayment = async (req, res) => {
  try {
    const data = await lifecycleService.getPaymentForAdmin({ paymentId: req.params.id });
    return response.success(res, data);
  } catch (err) { return handleServiceError(res, err, { conflictCode: 'ACCOUNT_STATE_CONFLICT' }); }
};

// ─────────────────────────────────────────
// POST /payments/:id/approve — payment PAID + subscription ACTIVE
// ─────────────────────────────────────────
const approvePayment = async (req, res) => {
  try {
    const result = await lifecycleService.approvePayment({
      paymentId:  req.params.id,
      reviewedBy: req.user.id,
      notes:      req.body.reason || null,
    });

    // Live notification to the customer: subscription is live.
    notifySubscriptionActivated(result.showroom_id, {
      planName:   result.subscription.plan_name,
      expiryDate: result.new_expiry.toISOString().slice(0, 10),
      usersLimit: result.users_limit,
    }).catch((e) => logger.warn('notifySubscriptionActivated failed:', e.message));

    auditLog({
      showroomId: result.showroom_id,
      userId:     req.user.id,
      action:     'SUBSCRIPTION_ACTIVATED',
      entity:     'subscription',
      entityId:   result.subscription.id,
      newData:    { plan_name: result.subscription.plan_name, new_expiry: result.new_expiry },
      ipAddress:  req.ip,
    });

    return response.success(res, result, 'تم تفعيل الاشتراك بنجاح.');
  } catch (err) { return handleServiceError(res, err, { conflictCode: 'ACCOUNT_STATE_CONFLICT' }); }
};

// ─────────────────────────────────────────
// POST /payments/:id/reject — payment REJECTED + request CANCELLED
// ─────────────────────────────────────────
const rejectPayment = async (req, res) => {
  try {
    const result = await lifecycleService.rejectPayment({
      paymentId:  req.params.id,
      reviewedBy: req.user.id,
      reason:     req.body.reason,
    });

    // Live notification to the customer with the safe plain-text reason.
    notifyPaymentRejected(result.showroom_id, {
      planName: result.plan_name || 'الاشتراك',
      reason:   req.body.reason,
    }).catch((e) => logger.warn('notifyPaymentRejected failed:', e.message));

    auditLog({
      showroomId: result.showroom_id,
      userId:     req.user.id,
      action:     'PAYMENT_REJECTED',
      entity:     'payment',
      entityId:   result.payment_id,
      newData:    { reason: req.body.reason },
      ipAddress:  req.ip,
    });

    return response.success(res, result, 'تم رفض الدفعة.');
  } catch (err) { return handleServiceError(res, err, { conflictCode: 'ACCOUNT_STATE_CONFLICT' }); }
};

module.exports = {
  listSubscriptions,
  getSummary,
  getAccountDetail,
  listPayments,
  getPayment,
  approvePayment,
  rejectPayment,
};