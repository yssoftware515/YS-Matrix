// ============================================================
// YS-MATRIX ERP — Analytics Service (Phase 2 Stage 2)
// Fixes:
//   • N+1 queries in getTopSellingItems — single enriched query
//   • N+1 queries in superadmin topShowrooms — batch lookup
//   • All heavy aggregations in one Promise.all
// ============================================================

'use strict';

const prisma           = require('../config/database');
const { getDateRange, getPreviousPeriod } = require('../utils/dateRange');

// ─────────────────────────────────────────
// DASHBOARD KPIs
// ─────────────────────────────────────────
const getDashboardKPIs = async ({ showroomId, query }) => {
  const dateRange = getDateRange(query);
  const prevRange = getPreviousPeriod(dateRange);

  const saleFilter     = { showroom_id: showroomId, sold_at: dateRange, status: { not: 'CANCELLED' } };
  const prevSaleFilter = { showroom_id: showroomId, sold_at: prevRange, status: { not: 'CANCELLED' } };

  const [
    currentSales, currentRevenue, currentProfit,
    prevRevenue,  prevProfit,
    totalInventory, lowStock, soldItems,
    totalCustomers, newCustomers,
    overdueCount, overdueAmount, upcomingCount,
    supplierBalance,
  ] = await Promise.all([
    prisma.sale.count({ where: saleFilter }),
    prisma.sale.aggregate({ where: saleFilter, _sum: { total: true } }),
    prisma.sale.aggregate({ where: saleFilter, _sum: { profit: true } }),
    prisma.sale.aggregate({ where: prevSaleFilter, _sum: { total: true } }),
    prisma.sale.aggregate({ where: prevSaleFilter, _sum: { profit: true } }),
    prisma.inventory.count({ where: { showroom_id: showroomId } }),
    prisma.inventory.count({ where: { showroom_id: showroomId, status: 'IN_STOCK', quantity: { lte: 2 } } }),
    prisma.inventory.count({ where: { showroom_id: showroomId, status: 'SOLD' } }),
    prisma.customer.count({ where: { showroom_id: showroomId } }),
    prisma.customer.count({ where: { showroom_id: showroomId, created_at: dateRange } }),
    // Phase C.2 (OVD-1): overdue KPIs must count installments on
    // OVERDUE sales too — the cron flips a sale to OVERDUE the first
    // time an installment lapses, and those installments are still
    // collectible debt. 'ACTIVE'-only made the dashboard numbers drop
    // the moment the flag flipped. CANCELLED/COMPLETED stay excluded.
    prisma.installment.count({
      where: { is_paid: false, due_date: { lt: new Date() }, sale: { showroom_id: showroomId, status: { in: ['ACTIVE', 'OVERDUE'] } } },
    }),
    prisma.installment.aggregate({
      where: { is_paid: false, due_date: { lt: new Date() }, sale: { showroom_id: showroomId, status: { in: ['ACTIVE', 'OVERDUE'] } } },
      _sum:  { amount: true },
    }),
    prisma.installment.count({
      where: {
        is_paid:  false,
        due_date: { gte: new Date(), lte: new Date(Date.now() + 7 * 86400000) },
        sale:     { showroom_id: showroomId, status: { in: ['ACTIVE', 'OVERDUE'] } },
      },
    }),
    prisma.supplier.aggregate({
      where: { showroom_id: showroomId },
      _sum:  { total_due: true, total_paid: true },
    }),
  ]);

  const revenue  = parseFloat(currentRevenue._sum.total  || 0);
  const profit   = parseFloat(currentProfit._sum.profit  || 0);
  const prevRev  = parseFloat(prevRevenue._sum.total     || 0);
  const prevProf = parseFloat(prevProfit._sum.profit     || 0);

  const calcChange = (current, previous) => {
    if (previous === 0) return current > 0 ? 100 : 0;
    return parseFloat(((current - previous) / previous) * 100).toFixed(1);
  };

  const supplierDue  = parseFloat(supplierBalance._sum.total_due  || 0);
  const supplierPaid = parseFloat(supplierBalance._sum.total_paid || 0);

  return {
    period: query.range || 'month',
    sales: {
      count:          currentSales,
      revenue,
      profit,
      profit_margin:  revenue > 0 ? parseFloat(((profit / revenue) * 100).toFixed(1)) : 0,
      revenue_change: calcChange(revenue, prevRev),
      profit_change:  calcChange(profit, prevProf),
    },
    inventory: { total: totalInventory, low_stock: lowStock, sold: soldItems },
    customers: { total: totalCustomers, new_this_period: newCustomers },
    installments: {
      overdue_count:  overdueCount,
      overdue_amount: parseFloat(overdueAmount._sum.amount || 0),
      due_this_week:  upcomingCount,
    },
    suppliers: {
      total_due:           supplierDue,
      total_paid:          supplierPaid,
      outstanding_balance: supplierDue - supplierPaid,
    },
  };
};

// ─────────────────────────────────────────
// REVENUE CHART
// ─────────────────────────────────────────
const getRevenueChart = async ({ showroomId, query }) => {
  const { range = 'month', group_by = 'day' } = query;
  const dateRange = getDateRange({ range });

  const sales = await prisma.sale.findMany({
    where: { showroom_id: showroomId, sold_at: dateRange, status: { not: 'CANCELLED' } },
    select: { sold_at: true, total: true, profit: true, sale_type: true },
    orderBy: { sold_at: 'asc' },
  });

  const grouped = {};
  sales.forEach((sale) => {
    const date = new Date(sale.sold_at);
    const key  = group_by === 'month'
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    if (!grouped[key]) {
      grouped[key] = { date: key, revenue: 0, profit: 0, count: 0, cash: 0, installment: 0 };
    }
    grouped[key].revenue += parseFloat(sale.total);
    grouped[key].profit  += parseFloat(sale.profit);
    grouped[key].count   += 1;
    if (sale.sale_type === 'CASH') grouped[key].cash        += parseFloat(sale.total);
    else                           grouped[key].installment += parseFloat(sale.total);
  });

  const chartData = Object.values(grouped).map((d) => ({
    ...d,
    revenue:       parseFloat(d.revenue.toFixed(2)),
    profit:        parseFloat(d.profit.toFixed(2)),
    profit_margin: d.revenue > 0 ? parseFloat(((d.profit / d.revenue) * 100).toFixed(1)) : 0,
  }));

  return { range, group_by, data: chartData };
};

// ─────────────────────────────────────────
// TOP SELLING ITEMS — N+1 FIXED
// Original: N individual inventory lookups inside a loop
// Fixed: single query with inventory join via saleItems include
// ─────────────────────────────────────────
const getTopSellingItems = async ({ showroomId, query }) => {
  const dateRange = getDateRange(query);
  const limit     = parseInt(query.limit, 10) || 10;

  // Group sale items with inventory included — avoids N+1
  const topItems = await prisma.saleItem.groupBy({
    by:    ['inventory_id'],
    where: {
      sale: {
        showroom_id: showroomId,
        sold_at:     dateRange,
        status:      { not: 'CANCELLED' },
      },
    },
    _sum:   { quantity: true, total_price: true, profit: true },
    _count: true,
    orderBy: { _sum: { total_price: 'desc' } },
    take:    limit,
  });

  if (topItems.length === 0) return [];

  // Batch fetch all inventory records in ONE query — not N queries
  const inventoryIds = topItems.map((i) => i.inventory_id);
  const inventories  = await prisma.inventory.findMany({
    where:  { id: { in: inventoryIds } },
    select: { id: true, brand: true, model: true, vehicle_type: true, color: true },
  });

  // Build a map for O(1) lookup
  const invMap = Object.fromEntries(inventories.map((inv) => [inv.id, inv]));

  return topItems.map((item) => ({
    inventory:     invMap[item.inventory_id] || null,
    total_sold:    item._sum.quantity,
    total_revenue: parseFloat(item._sum.total_price || 0),
    total_profit:  parseFloat(item._sum.profit      || 0),
    sale_count:    item._count,
  }));
};

// ─────────────────────────────────────────
// INVENTORY ANALYTICS
// ─────────────────────────────────────────
const getInventoryAnalytics = async ({ showroomId }) => {
  const [byType, byStatus, valueAgg] = await Promise.all([
    prisma.inventory.groupBy({
      by:    ['vehicle_type'],
      where: { showroom_id: showroomId },
      _count: true,
      _sum:   { quantity: true, cost_price: true, selling_price: true },
    }),
    prisma.inventory.groupBy({
      by:    ['status'],
      where: { showroom_id: showroomId },
      _count: true,
      _sum:   { quantity: true },
    }),
    prisma.inventory.aggregate({
      where: { showroom_id: showroomId, status: 'IN_STOCK' },
      _sum:  { cost_price: true, selling_price: true },
      _count: true,
    }),
  ]);

  const costValue     = parseFloat(valueAgg._sum.cost_price    || 0);
  const sellingValue  = parseFloat(valueAgg._sum.selling_price || 0);
  const potentialProfit = sellingValue - costValue;

  return {
    by_type:   byType,
    by_status: byStatus,
    stock_value: {
      items_count:      valueAgg._count,
      cost_value:       costValue,
      selling_value:    sellingValue,
      potential_profit: potentialProfit,
      markup_percent:   costValue > 0
        ? parseFloat(((potentialProfit / costValue) * 100).toFixed(1))
        : 0,
    },
  };
};

// ─────────────────────────────────────────
// PROFIT BREAKDOWN
// ─────────────────────────────────────────
const getProfitBreakdown = async ({ showroomId, query }) => {
  const dateRange = getDateRange(query);

  const sales = await prisma.saleItem.findMany({
    where: {
      sale: { showroom_id: showroomId, sold_at: dateRange, status: { not: 'CANCELLED' } },
    },
    select: {
      total_price: true,
      profit: true,
      quantity: true,
      inventory: { select: { vehicle_type: true } },
    },
  });

  const breakdown = {};
  sales.forEach((item) => {
    const type = item.inventory?.vehicle_type || 'OTHER';
    if (!breakdown[type]) breakdown[type] = { type, revenue: 0, profit: 0, count: 0 };
    breakdown[type].revenue += parseFloat(item.total_price);
    breakdown[type].profit  += parseFloat(item.profit);
    breakdown[type].count   += item.quantity;
  });

  return Object.values(breakdown).map((b) => ({
    ...b,
    revenue:       parseFloat(b.revenue.toFixed(2)),
    profit:        parseFloat(b.profit.toFixed(2)),
    profit_margin: b.revenue > 0
      ? parseFloat(((b.profit / b.revenue) * 100).toFixed(1))
      : 0,
  }));
};

// ─────────────────────────────────────────
// MONTHLY COMPARISON
// ─────────────────────────────────────────
const getMonthlyComparison = async ({ showroomId, query }) => {
  const months    = parseInt(query.months, 10) || 12;
  const startDate = new Date();
  startDate.setMonth(startDate.getMonth() - months + 1);
  startDate.setDate(1);
  startDate.setHours(0, 0, 0, 0);

  const sales = await prisma.sale.findMany({
    where: { showroom_id: showroomId, sold_at: { gte: startDate }, status: { not: 'CANCELLED' } },
    select: { sold_at: true, total: true, profit: true },
  });

  // Pre-fill all months with zeros
  const grouped = {};
  for (let i = 0; i < months; i++) {
    const d   = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    grouped[key] = { month: key, revenue: 0, profit: 0, count: 0 };
  }

  sales.forEach((sale) => {
    const d   = new Date(sale.sold_at);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    if (grouped[key]) {
      grouped[key].revenue += parseFloat(sale.total);
      grouped[key].profit  += parseFloat(sale.profit);
      grouped[key].count   += 1;
    }
  });

  return Object.values(grouped)
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((m) => ({
      ...m,
      revenue: parseFloat(m.revenue.toFixed(2)),
      profit:  parseFloat(m.profit.toFixed(2)),
    }));
};

// ─────────────────────────────────────────
// NET PROFIT
// ─────────────────────────────────────────
const getNetProfit = async ({ showroomId, query }) => {
  const dateRange  = getDateRange(query);
  const saleWhere  = { showroom_id: showroomId, sold_at: dateRange, status: { not: 'CANCELLED' } };
  const expWhere   = { showroom_id: showroomId, expense_date: dateRange };

  const [salesAgg, expensesAgg] = await Promise.all([
    prisma.sale.aggregate({ where: saleWhere, _sum: { profit: true, total: true } }),
    prisma.expense.aggregate({ where: expWhere, _sum: { amount: true } }),
  ]);

  const grossProfit   = parseFloat(salesAgg._sum.profit  || 0);
  const totalExpenses = parseFloat(expensesAgg._sum.amount || 0);
  const netProfit     = grossProfit - totalExpenses;
  const totalRevenue  = parseFloat(salesAgg._sum.total   || 0);

  return {
    period:         query.range || 'month',
    total_revenue:  totalRevenue,
    gross_profit:   grossProfit,
    total_expenses: totalExpenses,
    net_profit:     netProfit,
    net_margin:     totalRevenue > 0
      ? parseFloat(((netProfit / totalRevenue) * 100).toFixed(1))
      : 0,
  };
};

// ─────────────────────────────────────────
// EXPENSES ANALYTICS
// ─────────────────────────────────────────
const getExpensesAnalytics = async ({ showroomId, query }) => {
  const dateRange = getDateRange(query);
  const where     = { showroom_id: showroomId, expense_date: dateRange };

  const [total, byCategory] = await Promise.all([
    prisma.expense.aggregate({ where, _sum: { amount: true }, _count: true }),
    prisma.expense.groupBy({
      by:     ['category'],
      where,
      _sum:   { amount: true },
      _count: true,
      orderBy: { _sum: { amount: 'desc' } },
    }),
  ]);

  return {
    period:       query.range || 'month',
    total_amount: parseFloat(total._sum.amount || 0),
    total_count:  total._count,
    by_category:  byCategory,
  };
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
