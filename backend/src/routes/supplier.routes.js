// ============================================================
// YS-MATRIX ERP - Supplier Routes
// Author: Yahya Al-Sulami 🦅
// v1.1 — Soft delete + reactivate endpoints
// ============================================================

const express = require('express');
const router  = express.Router();

const supplierController = require('../controllers/supplier.controller');
const { authenticate }   = require('../middleware/auth.middleware');
const { checkLicense }   = require('../middleware/license.middleware');
const { tenantGuard }    = require('../middleware/tenant.middleware');
const { requireAccountActive } = require('../middleware/account.middleware');
const { ownerOnly }      = require('../middleware/roles.middleware');
const { ensureOnboarded } = require('../middleware/onboarding.middleware');

router.use(authenticate, checkLicense, tenantGuard, requireAccountActive, ensureOnboarded);

router.get('/',           supplierController.getAllSuppliers);
router.get('/stats',      supplierController.getSupplierStats);
router.get('/:id',        supplierController.getSupplier);
router.get('/:id/payments', supplierController.getPaymentHistory);
router.post('/',          supplierController.createSupplier);
router.put('/:id',        supplierController.updateSupplier);

// Phase C.4 (money-out RBAC): recording a payment to a supplier is a
// money-out financial action — owner only, mirroring the delete/
// reactivate gates below. STAFF keeps full READ access (list, detail,
// payment history).
router.post('/:id/payments', ownerOnly, supplierController.addPayment);

// Soft delete — owner only
router.delete('/:id', ownerOnly, supplierController.deleteSupplier);

// Reactivate — owner only
router.patch('/:id/reactivate', ownerOnly, supplierController.reactivateSupplier);

module.exports = router;
