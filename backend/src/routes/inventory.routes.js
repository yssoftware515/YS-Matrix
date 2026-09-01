// ============================================================
// YS-MATRIX ERP - Inventory Routes
// Author: Yahya Al-Sulami 🦅
// ============================================================

const express = require('express');
const router = express.Router();
const inventoryController = require('../controllers/inventory.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkLicense } = require('../middleware/license.middleware');
const { tenantGuard } = require('../middleware/tenant.middleware');
const { requireAccountActive } = require('../middleware/account.middleware');
const { ownerOnly } = require('../middleware/roles.middleware');
const { ensureOnboarded } = require('../middleware/onboarding.middleware');

// All inventory routes require auth + license + tenant guard + onboarding
// Matrix Audit (Phase 4): customer.routes.js/supplier.routes.js already
// required this — inventory didn't, meaning a non-onboarded showroom
// could manage inventory/sell vehicles before completing setup while
// being blocked from managing customers. Same business rule, applied
// consistently now.
router.use(authenticate, checkLicense, tenantGuard, requireAccountActive, ensureOnboarded);

// ── READ (all roles) ─────────────────────
router.get('/', inventoryController.getAllInventory);
router.get('/stats', inventoryController.getInventoryStats);
router.get('/low-stock', inventoryController.getLowStockAlerts);
router.get('/:id', inventoryController.getInventoryItem);

// ── WRITE (staff and above) ─────────────
// NOTE: auditMiddleware was previously ALSO applied here, on top of
// the manual auditLog() call already inside each controller function
// — every create/bulk-create/update wrote TWO audit_logs rows for
// one action. Removed here; the manual controller calls are more
// accurate anyway (they capture oldData on update, which
// auditMiddleware has no way to know from the response alone).
router.post(
  '/',
  inventoryController.createInventoryItem
);

router.post(
  '/bulk',
  inventoryController.bulkCreateInventory
);

router.put(
  '/:id',
  inventoryController.updateInventoryItem
);

// ── DELETE / REACTIVATE (owner only) ────
router.delete(
  '/:id',
  ownerOnly,
  inventoryController.deleteInventoryItem
);

router.patch(
  '/:id/reactivate',
  ownerOnly,
  inventoryController.reactivateInventoryItem
);

module.exports = router;
