// ============================================================
// YS-MATRIX ERP - Customer Routes
// Author: Yahya Al-Sulami 🦅
// v1.1 — Soft delete + reactivate endpoints
// ============================================================

const express = require('express');
const router  = express.Router();

const customerController = require('../controllers/customer.controller');
const { authenticate }   = require('../middleware/auth.middleware');
const { checkLicense }   = require('../middleware/license.middleware');
const { tenantGuard }    = require('../middleware/tenant.middleware');
const { requireAccountActive } = require('../middleware/account.middleware');
const { ownerOnly }      = require('../middleware/roles.middleware');
const { ensureOnboarded } = require('../middleware/onboarding.middleware');

router.use(authenticate, checkLicense, tenantGuard, requireAccountActive, ensureOnboarded);

router.get('/',    customerController.getAllCustomers);
router.get('/:id', customerController.getCustomer);
router.post('/',   customerController.createCustomer);
router.put('/:id', customerController.updateCustomer);

// Soft delete — owner only
router.delete('/:id', ownerOnly, customerController.deleteCustomer);

// Reactivate deactivated customer — owner only
router.patch('/:id/reactivate', ownerOnly, customerController.reactivateCustomer);

module.exports = router;
