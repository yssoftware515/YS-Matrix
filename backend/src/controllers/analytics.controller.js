// ============================================================
// YS-MATRIX ERP — Analytics Controller (Phase 2 Stage 2)
// Now THIN — all business logic in analytics.service.js
// ============================================================

'use strict';

const analyticsService = require('../services/analytics.service');
const response         = require('../utils/response');
const logger           = require('../config/logger');

const handleServiceError = (res, err) => {
  logger.error('Analytics service error:', err);
  return response.serverError(res, 'حدث خطأ في جلب البيانات.');
};

// ─────────────────────────────────────────
const getDashboardKPIs = async (req, res) => {
  try {
    const data = await analyticsService.getDashboardKPIs({
      showroomId: req.showroomId,
      query:      req.query,
    });
    return response.success(res, data);
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const getRevenueChart = async (req, res) => {
  try {
    const data = await analyticsService.getRevenueChart({
      showroomId: req.showroomId,
      query:      req.query,
    });
    return response.success(res, data);
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const getTopSellingItems = async (req, res) => {
  try {
    const data = await analyticsService.getTopSellingItems({
      showroomId: req.showroomId,
      query:      req.query,
    });
    return response.success(res, data);
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const getInventoryAnalytics = async (req, res) => {
  try {
    const data = await analyticsService.getInventoryAnalytics({
      showroomId: req.showroomId,
    });
    return response.success(res, data);
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const getProfitBreakdown = async (req, res) => {
  try {
    const data = await analyticsService.getProfitBreakdown({
      showroomId: req.showroomId,
      query:      req.query,
    });
    return response.success(res, data);
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const getMonthlyComparison = async (req, res) => {
  try {
    const data = await analyticsService.getMonthlyComparison({
      showroomId: req.showroomId,
      query:      req.query,
    });
    return response.success(res, data);
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const getNetProfit = async (req, res) => {
  try {
    const data = await analyticsService.getNetProfit({
      showroomId: req.showroomId,
      query:      req.query,
    });
    return response.success(res, data);
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const getExpensesAnalytics = async (req, res) => {
  try {
    const data = await analyticsService.getExpensesAnalytics({
      showroomId: req.showroomId,
      query:      req.query,
    });
    return response.success(res, data);
  } catch (err) { return handleServiceError(res, err); }
};

module.exports = {
  getDashboardKPIs,
  getRevenueChart,
  getTopSellingItems,
  getInventoryAnalytics,
  getProfitBreakdown,
  getMonthlyComparison,
  getNetProfit,
  getExpensesAnalytics,
};
