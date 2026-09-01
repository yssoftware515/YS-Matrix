// ============================================================
// YS-MATRIX ERP - License Routes
// Author: Yahya Al-Sulami 🦅
// ============================================================

const express = require('express');
const router  = express.Router();
const licenseController = require('../controllers/license.controller');
const { authenticate }  = require('../middleware/auth.middleware');
const { tenantGuard }   = require('../middleware/tenant.middleware');
const { superAdminOnly } = require('../middleware/roles.middleware');

router.use(authenticate);

// Any authenticated user can check their own license
router.get('/status', tenantGuard, licenseController.getLicenseStatus);

// SuperAdmin only — global operations (no tenant context; the
// renewal service scopes its own writes explicitly, see
// subscription.service.js / database.js runWithShowroomContext)
router.get('/all',    superAdminOnly, licenseController.getAllLicenses);
router.post('/renew', superAdminOnly, licenseController.renewLicense);

module.exports = router;
