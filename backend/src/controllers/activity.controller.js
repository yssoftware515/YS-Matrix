// ============================================================
// YS-MATRIX ERP — Activity Controller (Phase 2 Stage 3)
// ============================================================

'use strict';

const activityService = require('../services/activity.service');
const response        = require('../utils/response');
const logger          = require('../config/logger');

const handleErr = (res, err) => {
  logger.error('Activity service error:', err);
  return response.serverError(res, 'فشل جلب سجل الأنشطة.');
};

// ─────────────────────────────────────────
const getActivityLogs = async (req, res) => {
  try {
    const { logs, pagination } = await activityService.listActivityLogs({
      showroomId: req.showroomId,
      query:      req.query,
    });
    return response.paginated(res, logs, pagination);
  } catch (err) { return handleErr(res, err); }
};

// ─────────────────────────────────────────
const getFilters = async (req, res) => {
  try {
    const [actions, entities] = await Promise.all([
      activityService.getDistinctActions({ showroomId: req.showroomId }),
      activityService.getDistinctEntities({ showroomId: req.showroomId }),
    ]);
    return response.success(res, { actions, entities });
  } catch (err) { return handleErr(res, err); }
};

// ─────────────────────────────────────────
const getEntityHistory = async (req, res) => {
  try {
    const { entity, id } = req.params;
    const logs = await activityService.getEntityHistory({
      showroomId: req.showroomId,
      entity,
      entityId:   id,
    });
    return response.success(res, logs);
  } catch (err) { return handleErr(res, err); }
};

// ─────────────────────────────────────────
const getActivitySummary = async (req, res) => {
  try {
    const data = await activityService.getActivitySummary({ showroomId: req.showroomId });
    return response.success(res, data);
  } catch (err) { return handleErr(res, err); }
};

module.exports = { getActivityLogs, getFilters, getEntityHistory, getActivitySummary };
