// ============================================================
// YS-MATRIX ERP - Date Range Helper
// Author: Yahya Al-Sulami 🦅
// ============================================================

const { startOfDay, endOfDay, startOfMonth, endOfMonth,
        startOfYear, endOfYear, subDays, subMonths } = require('date-fns');

/**
 * Build date range from query param: today|week|month|year|custom
 * Custom requires: date_from and date_to query params
 */
const getDateRange = (query) => {
  const { range = 'month', date_from, date_to } = query;
  const now = new Date();

  switch (range) {
    case 'today':
      return { gte: startOfDay(now), lte: endOfDay(now) };
    case 'week':
      return { gte: startOfDay(subDays(now, 7)), lte: endOfDay(now) };
    case 'month':
      return { gte: startOfMonth(now), lte: endOfMonth(now) };
    case 'last_month': {
      const lastMonth = subMonths(now, 1);
      return { gte: startOfMonth(lastMonth), lte: endOfMonth(lastMonth) };
    }
    case 'year':
      return { gte: startOfYear(now), lte: endOfYear(now) };
    case 'custom':
      if (!date_from || !date_to)
        return { gte: startOfMonth(now), lte: endOfMonth(now) };
      return {
        gte: startOfDay(new Date(date_from)),
        lte: endOfDay(new Date(date_to)),
      };
    default:
      return { gte: startOfMonth(now), lte: endOfMonth(now) };
  }
};

/**
 * Get previous period for comparison (same length as current)
 */
const getPreviousPeriod = (dateRange) => {
  const diff = dateRange.lte - dateRange.gte;
  return {
    gte: new Date(dateRange.gte - diff),
    lte: new Date(dateRange.lte - diff),
  };
};

module.exports = { getDateRange, getPreviousPeriod };
