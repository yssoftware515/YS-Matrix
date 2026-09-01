// ============================================================
// YS-MATRIX ERP - Invoice Routes
// Author: Yahya Al-Sulami 🦅
// ============================================================

const express = require('express');
const router  = express.Router();
const invoiceController = require('../controllers/invoice.controller');
const { authenticate }  = require('../middleware/auth.middleware');
const { checkLicense }  = require('../middleware/license.middleware');
const { tenantGuard }   = require('../middleware/tenant.middleware');
const { requireAccountActive } = require('../middleware/account.middleware');

router.use(authenticate, checkLicense, tenantGuard, requireAccountActive);

// JSON data
router.get('/:id', invoiceController.getInvoice);

// Printable HTML
router.get('/:id/print', invoiceController.getInvoiceHTML);

module.exports = router;
