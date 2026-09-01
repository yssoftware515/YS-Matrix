// ============================================================
// YS-MATRIX ERP — Subscription Controller (Phase 2 Stage 3)
// ============================================================

'use strict';

const subscriptionService = require('../services/subscription.service');
const response            = require('../utils/response');
const logger              = require('../config/logger');
const { auditLog }        = require('../middleware/audit.middleware');

const handleServiceError = (res, err) => {
  if (err.code === 'NOT_FOUND')        return response.notFound(res, err.message);
  if (err.code === 'VALIDATION_ERROR') return response.validationError(res, null, err.message);
  logger.error('Subscription service error:', err);
  return response.serverError(res, 'حدث خطأ في معالجة الاشتراك.');
};

// ─────────────────────────────────────────
// GET CURRENT — for current showroom
// ─────────────────────────────────────────
const getCurrentSubscription = async (req, res) => {
  try {
    const data = await subscriptionService.getCurrentSubscription({
      showroomId: req.showroomId,
    });
    if (!data) return response.notFound(res, 'لا يوجد اشتراك مسجل لهذا المعرض.');
    return response.success(res, data);
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
// LIST — subscription history for current showroom
// ─────────────────────────────────────────
const listSubscriptions = async (req, res) => {
  try {
    const { subscriptions, pagination } = await subscriptionService.listSubscriptions({
      showroomId: req.showroomId,
      query:      req.query,
    });
    return response.paginated(res, subscriptions, pagination);
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
// RENEW — SuperAdmin only
// ─────────────────────────────────────────
const renewSubscription = async (req, res) => {
  try {
    const {
      showroom_id,
      months,
      new_expiry_date,
      plan_name,
      amount_paid,
      payment_method,
      notes,
    } = req.body;

    if (!showroom_id) {
      return response.validationError(res, { showroom_id: 'مطلوب.' });
    }

    const result = await subscriptionService.renewSubscription({
      showroomId:    showroom_id,
      renewedBy:     req.user.id,
      months,
      newExpiryDate: new_expiry_date,
      planName:      plan_name,
      amountPaid:    amount_paid,
      paymentMethod: payment_method,
      notes,
    });

    auditLog({
      // Phase 4 P1: the renew route is a SuperAdmin GLOBAL operation
      // that intentionally runs WITHOUT tenantGuard (so it can target
      // any showroom). The audit row must still be attributed to the
      // TENANT that actually changed (showroom_id from the body, the
      // same target the lifecycle scopes its writes under) — never to
      // the system showroom, so a renewal can never masquerade as a
      // system-showroom event and the customer's activity feed shows
      // their own renewal. The row's showroom_id and newData both
      // reference the target showroom.
      showroomId: showroom_id,
      userId:     req.user.id,
      action:     'RENEW_SUBSCRIPTION',
      entity:     'subscription',
      entityId:   result.subscription.id,
      newData:    { showroom_id, new_expiry: result.new_expiry, plan_name, amount_paid },
      ipAddress:  req.ip,
    });

    return response.created(res, result, 'تم تجديد الاشتراك بنجاح.');
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
// LIST ALL — SuperAdmin: all showrooms
// ─────────────────────────────────────────
const listAllSubscriptions = async (req, res) => {
  try {
    const { subscriptions, pagination } = await subscriptionService.listAllSubscriptions({
      query: req.query,
    });
    return response.paginated(res, subscriptions, pagination);
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
// SUMMARY — SuperAdmin dashboard
// ─────────────────────────────────────────
const getSubscriptionSummary = async (req, res) => {
  try {
    const data = await subscriptionService.getSubscriptionSummary();
    return response.success(res, data);
  } catch (err) { return handleServiceError(res, err); }
};

module.exports = {
  getCurrentSubscription,
  listSubscriptions,
  renewSubscription,
  listAllSubscriptions,
  getSubscriptionSummary,
};
