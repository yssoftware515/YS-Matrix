// ============================================================
// YS-MATRIX ERP — Notification Controller (Phase 2 Stage 3)
// ============================================================

'use strict';

const notificationService = require('../services/notification.service');
const response            = require('../utils/response');
const logger              = require('../config/logger');

const handleServiceError = (res, err) => {
  if (err.code === 'NOT_FOUND') return response.notFound(res, err.message);
  logger.error('Notification service error:', err);
  return response.serverError(res, 'حدث خطأ في معالجة الإشعارات.');
};

// ─────────────────────────────────────────
// GET ALL — paginated list for current showroom
// ─────────────────────────────────────────
const getNotifications = async (req, res) => {
  try {
    const result = await notificationService.listNotifications({
      showroomId: req.showroomId,
      userId:     req.query.mine === 'true' ? req.user.id : null,
      query:      req.query,
    });
    return response.paginated(res, result.notifications, result.pagination, 'OK');
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
// GET UNREAD COUNT — for navbar badge
// ─────────────────────────────────────────
const getUnreadCount = async (req, res) => {
  try {
    const data = await notificationService.getUnreadCount({ showroomId: req.showroomId });
    return response.success(res, data);
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
// MARK ONE AS READ
// ─────────────────────────────────────────
const markAsRead = async (req, res) => {
  try {
    const notification = await notificationService.markAsRead({
      showroomId: req.showroomId,
      id:         req.params.id,
    });
    return response.success(res, notification, 'تم تحديد الإشعار كمقروء.');
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
// MARK ALL AS READ
// ─────────────────────────────────────────
const markAllAsRead = async (req, res) => {
  try {
    const result = await notificationService.markAllAsRead({
      showroomId: req.showroomId,
      userId:     req.query.mine === 'true' ? req.user.id : null,
    });
    return response.success(res, result, `تم تحديد ${result.updated} إشعار كمقروء.`);
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
// DELETE OLD (cleanup — owner only)
// ─────────────────────────────────────────
const deleteOld = async (req, res) => {
  try {
    const result = await notificationService.deleteOldNotifications({
      showroomId: req.showroomId,
      daysOld:    parseInt(req.query.days || '30', 10),
    });
    return response.success(res, result, `تم حذف ${result.deleted} إشعار قديم.`);
  } catch (err) { return handleServiceError(res, err); }
};

module.exports = {
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  deleteOld,
};
