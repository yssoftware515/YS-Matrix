// ============================================================
// YS-MATRIX ERP - SuperAdmin System Analytics
// Author: Yahya Al-Sulami 🦅
// يعرض إحصائيات النظام كامل لصاحب المنصة
// ============================================================

const { baseClient: db } = require('../config/database');
const response = require('../utils/response');
const logger   = require('../config/logger');

// ─────────────────────────────────────────────────────────────
// GET /api/v1/superadmin/system-stats
//
// KPIs على مستوى كل المعارض مجتمعة
// ─────────────────────────────────────────────────────────────
const getSystemStats = async (req, res) => {
  try {
    const now      = new Date();
    const month30  = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const month60  = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

    const [
      // Showroom stats
      totalShowrooms,
      activeShowrooms,
      expiringSoon,
      notOnboarded,
      // User stats
      totalUsers,
      activeUsers,
      // Business stats
      totalSales,
      recentSales,
      prevSales,
      totalRevenue,
      recentRevenue,
      // Inventory
      totalInventory,
      inStockCount,
      // Installments
      overdueInstallments,
    ] = await Promise.all([
      db.showroom.count(),
      db.showroom.count({ where: { is_active: true, license_expiry: { gt: now } } }),
      db.showroom.count({
        where: {
          is_active:      true,
          license_expiry: {
            gt: now,
            lt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
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

      db.installment.count({
        where: { is_paid: false, due_date: { lt: now } },
      }),
    ]);

    // حساب نسبة التغيير في المبيعات
    const salesChange = prevSales === 0
      ? 100
      : parseFloat((((recentSales - prevSales) / prevSales) * 100).toFixed(1));

    // توزيع المعارض حسب حالة الترخيص
    const allShowrooms = await db.showroom.findMany({
      select: { is_active: true, license_expiry: true, is_onboarded: true },
    });

    const licenseBreakdown = allShowrooms.reduce((acc, s) => {
      const expiry    = new Date(s.license_expiry);
      const isExpired = now > expiry;
      const daysLeft  = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      if (!s.is_active)        acc.inactive++;
      else if (isExpired)      acc.expired++;
      else if (daysLeft <= 7)  acc.expiring_soon++;
      else                     acc.active++;

      return acc;
    }, { active: 0, expiring_soon: 0, expired: 0, inactive: 0 });

    // أكثر 5 معارض مبيعاً
    const topShowrooms = await db.sale.groupBy({
      by:      ['showroom_id'],
      _count:  true,
      _sum:    { total: true },
      orderBy: { _sum: { total: 'desc' } },
      take:    5,
    });

    const topShowroomsEnriched = await (async () => {
      const ids = topShowrooms.map((s) => s.showroom_id);
      const showroomRows = ids.length > 0
        ? await db.showroom.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        : [];
      const showroomMap = {};
      for (const r of showroomRows) showroomMap[r.id] = r.name;
      return topShowrooms.map((s) => ({
        showroom_id:   s.showroom_id,
        showroom_name: showroomMap[s.showroom_id] || '—',
        sales_count:   s._count,
        total_revenue: parseFloat(s._sum.total?.toString() || '0'),
      }));
    })();

    return response.success(res, {
      showrooms: {
        total:          totalShowrooms,
        active:         activeShowrooms,
        expiring_soon:  expiringSoon,
        not_onboarded:  notOnboarded,
        breakdown:      licenseBreakdown,
      },
      users: {
        total:  totalUsers,
        active: activeUsers,
      },
      sales: {
        total:         totalSales,
        last_30_days:  recentSales,
        change_pct:    salesChange,
        total_revenue: parseFloat(totalRevenue._sum.total?.toString() || '0'),
        revenue_30d:   parseFloat(recentRevenue._sum.total?.toString() || '0'),
      },
      inventory: {
        total:    totalInventory,
        in_stock: inStockCount,
      },
      installments: {
        overdue: overdueInstallments,
      },
      top_showrooms: topShowroomsEnriched,
    });
  } catch (err) {
    logger.error('System stats error:', err);
    return response.error(res, 'Failed to fetch system stats');
  }
};

module.exports = { getSystemStats };
