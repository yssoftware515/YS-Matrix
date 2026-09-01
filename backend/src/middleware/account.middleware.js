// ============================================================
// YS-MATRIX ERP — Account Status Middleware (Phase 4 P1)
// ============================================================
//
// requireAccountActive — the ERP business-route gate for the
// account lifecycle. Must run AFTER authenticate + tenantGuard
// (needs req.user and req.showroomId).
//
// Phase 4 semantics (derived — no new tables, no DDL):
//   • Account status is derived on the fly from the latest
//     subscription row (identity/user/role statuses are unchanged).
//   • A TRIAL claim means "registerAccount just created the
//     account — no plan chosen, no payment yet" → account status
//     PENDING. These accounts are blocked from every ERP business
//     route with 403 ACCOUNT_PENDING until they purchase through
//     the store surface (/subscriptions/* stays open).
//   • Accounts with NO subscription row at all are LEGACY —
//     pre-Phase-4 showrooms that predate the claim invariant.
//     They keep working exactly as before (license checks only):
//     "all existing showrooms remain work" is a hard Phase 4 P1
//     requirement, and the platform's admin provisioning path
//     (createShowroom) has created claims for every showroom it
//     created since Stage 3.
//   • ACTIVE / PENDING_PAYMENT accounts pass — access quality is
//     governed by the existing license checks (license_expiry).
//
// The self-service surface (/subscriptions/*, /auth/*) deliberately
// does NOT include this middleware — a PENDING account must be
// able to reach the plan picker to purchase. Enforcement here is
// scoped to the operational routers only (each one opts in
// explicitly).
// ============================================================

'use strict';

const { baseClient } = require('../config/database');
const response       = require('../utils/response');

const requireAccountActive = async (req, res, next) => {
  const { user } = req;

  // SuperAdmin bypasses all account gates (platform authority).
  if (user.role === 'SUPER_ADMIN') return next();

  const latest = await baseClient.subscription.findFirst({
    where:   { showroom_id: req.showroomId },
    orderBy: { created_at: 'desc' },
    select:  { id: true, status: true },
  });

  // LEGACY: no claim row → account predates the claim invariant →
  // pass through untouched (license middleware governs access).
  if (!latest) return next();

  // PENDING — self-registered account on its trial, no plan yet.
  if (latest.status === 'TRIAL') {
    return response.forbidden(
      res,
      'حسابك في فترة التجربة. يرجى اختيار باقة اشتراك من صفحة الاشتراك لتفعيل الوصول الكامل.',
      'ACCOUNT_PENDING'
    );
  }

  next();
};

module.exports = { requireAccountActive };