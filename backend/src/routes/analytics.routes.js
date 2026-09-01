// ============================================================
// YS-MATRIX ERP - Analytics Routes
// Author: Yahya Al-Sulami 🦅
// ============================================================

const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analytics.controller');
const expenseController = require('../controllers/expense.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkLicense } = require('../middleware/license.middleware');
const { tenantGuard } = require('../middleware/tenant.middleware');
const { requireAccountActive } = require('../middleware/account.middleware');
const { ownerOnly } = require('../middleware/roles.middleware');
const { ensureOnboarded } = require('../middleware/onboarding.middleware');
const { cacheResponse } = require('../middleware/cache.middleware');

// Matrix Audit (Phase 4): expense.routes.js doesn't exist as a separate
// file — confirmed directly — expense endpoints are mounted on THIS
// same router below, so adding ensureOnboarded here covers both
// analytics AND expenses in one place, matching the audit's intent for
// both at once.
router.use(authenticate, checkLicense, tenantGuard, requireAccountActive, ensureOnboarded);

// ── Dashboard ────────────────────────────
// Read-only, tenant-scoped, 60s TTL cache — see cache.middleware.js
// decision record. Applied ONLY to these 7 GET endpoints; expenses
// below (POST/PUT/DELETE) are mutations and must never be cached.
router.get('/dashboard',   cacheResponse(), analyticsController.getDashboardKPIs);
router.get('/net-profit',  cacheResponse(), analyticsController.getNetProfit);

// ── Charts ───────────────────────────────
router.get('/revenue-chart',    cacheResponse(), analyticsController.getRevenueChart);
router.get('/monthly',          cacheResponse(), analyticsController.getMonthlyComparison);
router.get('/top-items',        cacheResponse(), analyticsController.getTopSellingItems);
router.get('/profit-breakdown', cacheResponse(), analyticsController.getProfitBreakdown);

// ── Inventory ────────────────────────────
router.get('/inventory', cacheResponse(), analyticsController.getInventoryAnalytics);

// ── Expenses ─────────────────────────────
// Deliberately UNCACHED: POST/PUT/DELETE are mutations, and GET here
// lists raw expense records (not aggregated analytics) that an owner
// expects to see reflected immediately after adding one.
//
// Phase C.4 (money-out RBAC): POST/PUT now require ownerOnly. Money
// LEAVING the showroom (expense recording, supplier payments) is a
// financial action; the STAFF profile's expense:create permission is
// NOT the gate here because requirePermission is only wired on the
// /api/v1/admin surface — ownerOnly is the route-level authority that
// actually exists in this middleware chain (mirrors the delete below).
// STAFF keeps full READ access to expense records.
router.get('/expenses', expenseController.getAllExpenses);
router.post('/expenses', ownerOnly, expenseController.createExpense);
router.put('/expenses/:id', ownerOnly, expenseController.updateExpense);
router.delete('/expenses/:id', ownerOnly, expenseController.deleteExpense);

module.exports = router;
