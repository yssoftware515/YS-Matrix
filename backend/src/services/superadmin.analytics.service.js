// ============================================================
// YS-MATRIX ERP — SuperAdmin Analytics Service (Phase 2 Stage 2)
// Fix: N+1 queries in topShowrooms — batch lookup with map
// ============================================================

'use strict';

const { baseClient: db } = require('../config/database');

const getSystemStats = async () => {
  const now     = new Date();
  const month30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const month60 = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

  const [
    totalShowrooms, activeShowrooms, expiringSoon, notOnboarded,
    totalUsers, activeUsers,
    totalSales, recentSales, prevSales,
    totalRevenue, recentRevenue,
    totalInventory, inStockCount,
    overdueInstallments,
    // Batch: top showrooms + all showroom details in one query
    topShowroomsRaw, allShowrooms,
  ] = await Promise.all([
    db.showroom.count(),
    db.showroom.count({ where: { is_active: true, license_expiry: { gt: now } } }),
    db.showroom.count({
      where: {
        is_active:      true,
        license_expiry: { gt: now, lt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      },
    }),
    db.showroom.count({ where: { is_onboarded: false } }),
    db.user.count(),
    db.user.count({ where: { is_active: true } }),
    db.sale.count(),
    db.sale.count({ where: { created_at: { gte: month30 } } }),
    db.sale.count({ where: { created_at: { gte: month60, lt: month30 } } }),
    db.sale.aggregate({ _sum: { total: true } }),
    db.sale.aggregate({ where: { created_at: { gte: month30 } }, _sum: { total: true } }),
    db.inventory.count(),
    db.inventory.count({ where: { status: 'IN_STOCK' } }),
    db.installment.count({ where: { is_paid: false, due_date: { lt: now } } }),

    // Top 5 showrooms by revenue — grouped
    db.sale.groupBy({
      by:      ['showroom_id'],
      _count:  true,
      _sum:    { total: true },
      orderBy: { _sum: { total: 'desc' } },
      take:    5,
    }),

    // ALL showrooms for license breakdown — single query
    db.showroom.findMany({
      select: { id: true, name: true, slug: true, is_active: true, license_expiry: true, is_onboarded: true },
    }),
  ]);

  // ── License breakdown from allShowrooms ──────────────────
  const licenseBreakdown = allShowrooms.reduce((acc, s) => {
    const expiry    = new Date(s.license_expiry);
    const isExpired = now > expiry;
    const daysLeft  = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

    if (!s.is_active)       acc.inactive++;
    else if (isExpired)     acc.expired++;
    else if (daysLeft <= 7) acc.expiring_soon++;
    else                    acc.active++;

    return acc;
  }, { active: 0, expiring_soon: 0, expired: 0, inactive: 0 });

  // ── Top showrooms — batch lookup (N+1 FIX) ────────────────
  // Old: N individual db.showroom.findUnique calls inside Promise.all loop
  // New: one query, build a map, lookup is O(1)
  const topShowroomIds = topShowroomsRaw.map((s) => s.showroom_id);
  const topShowroomDetails = await db.showroom.findMany({
    where:  { id: { in: topShowroomIds } },
    select: { id: true, name: true, slug: true },
  });
  const showroomMap = Object.fromEntries(topShowroomDetails.map((s) => [s.id, s]));

  const topShowroomsEnriched = topShowroomsRaw.map((s) => ({
    showroom_id:   s.showroom_id,
    showroom_name: showroomMap[s.showroom_id]?.name || '—',
    showroom_slug: showroomMap[s.showroom_id]?.slug || '—',
    sales_count:   s._count,
    total_revenue: parseFloat(s._sum.total?.toString() || '0'),
  }));

  // ── Sales change % ────────────────────────────────────────
  const salesChange = prevSales === 0
    ? 100
    : parseFloat((((recentSales - prevSales) / prevSales) * 100).toFixed(1));

  return {
    showrooms: {
      total:         totalShowrooms,
      active:        activeShowrooms,
      expiring_soon: expiringSoon,
      not_onboarded: notOnboarded,
      breakdown:     licenseBreakdown,
    },
    users: { total: totalUsers, active: activeUsers },
    sales: {
      total:         totalSales,
      last_30_days:  recentSales,
      change_pct:    salesChange,
      total_revenue: parseFloat(totalRevenue._sum.total?.toString()  || '0'),
      revenue_30d:   parseFloat(recentRevenue._sum.total?.toString() || '0'),
    },
    inventory: { total: totalInventory, in_stock: inStockCount },
    installments: { overdue: overdueInstallments },
    top_showrooms: topShowroomsEnriched,
  };
};

module.exports = { getSystemStats };
