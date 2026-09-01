// ============================================================
// YS-MATRIX ERP - Sales Routes
// Author: Yahya Al-Sulami 🦅
// v2.0 — Zod validation on all endpoints
// ============================================================

const express = require('express');
const router  = express.Router();

const salesController   = require('../controllers/sales.controller');
const receiptController = require('../controllers/receipt.controller');
const { authenticate }  = require('../middleware/auth.middleware');
const { checkLicense }  = require('../middleware/license.middleware');
const { tenantGuard }   = require('../middleware/tenant.middleware');
const { requireAccountActive } = require('../middleware/account.middleware');
const { ownerOnly }     = require('../middleware/roles.middleware');
const { validate }      = require('../middleware/validate.middleware');
const { ensureOnboarded } = require('../middleware/onboarding.middleware');

const {
  createSaleSchema,
  payInstallmentSchema,
  salesQuerySchema,
} = require('../validations/sale.validation');

// All sales routes require auth + license + tenant + onboarding
router.use(authenticate, checkLicense, tenantGuard, requireAccountActive, ensureOnboarded);

// ── Summary & Alerts ─────────────────────────────────────────
router.get('/summary',  salesController.getSalesSummary);
router.get('/overdue',  salesController.getOverdueInstallments);
router.get('/upcoming', salesController.getUpcomingInstallments);

// ── Sales CRUD ────────────────────────────────────────────────
router.get(
  '/',
  validate(salesQuerySchema, 'query'),
  salesController.getAllSales
);

router.get('/:id', salesController.getSale);

router.post(
  '/',
  validate(createSaleSchema),
  salesController.createSale
);

// ── Cancel (owner only) ───────────────────────────────────────
router.patch(
  '/:id/cancel',
  ownerOnly,
  salesController.cancelSale
);

// ── Installment payment ───────────────────────────────────────
router.patch(
  '/installments/:installment_id/pay',
  validate(payInstallmentSchema),
  salesController.payInstallment
);

// ── Installment receipt (Phase C.1) — printable HTML, same guard
//    chain as the rest of the router (auth → license → tenant →
//    account → onboarding). Sits behind /:id (a single segment) so
//    the three-segment path can never collide with it. ───────────
router.get(
  '/installments/:installment_id/receipt',
  receiptController.getInstallmentReceiptHTML
);

module.exports = router;
