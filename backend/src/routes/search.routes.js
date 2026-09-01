// ============================================================
// YS-MATRIX ERP — Search Routes (Phase 2 Stage 3)
// ============================================================

'use strict';

const express          = require('express');
const router           = express.Router();
const searchController = require('../controllers/search.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { checkLicense } = require('../middleware/license.middleware');
const { tenantGuard }  = require('../middleware/tenant.middleware');
const { requireAccountActive } = require('../middleware/account.middleware');
const { ensureOnboarded } = require('../middleware/onboarding.middleware');
const { validate }     = require('../middleware/validate.middleware');
const { searchQuerySchema } = require('../validations/search.validation');

router.use(authenticate, checkLicense, tenantGuard, requireAccountActive, ensureOnboarded);

// GET /api/v1/search?q=keyword
router.get('/', validate(searchQuerySchema, 'query'), searchController.search);

module.exports = router;
