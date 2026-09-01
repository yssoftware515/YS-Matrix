// ============================================================
// YS-MATRIX ERP — Activity Routes (Phase 2 Stage 3)
// ============================================================

'use strict';

const express            = require('express');
const router             = express.Router();
const activityController = require('../controllers/activity.controller');
const { authenticate }   = require('../middleware/auth.middleware');
const { checkLicense }   = require('../middleware/license.middleware');
const { tenantGuard }    = require('../middleware/tenant.middleware');
const { requireAccountActive } = require('../middleware/account.middleware');
const { ownerOnly }      = require('../middleware/roles.middleware');
const { validate }       = require('../middleware/validate.middleware');
const { entityHistoryParamsSchema } = require('../validations/activity.validation');

// All activity routes require auth + license + tenant
router.use(authenticate, checkLicense, tenantGuard, requireAccountActive);

// GET /api/v1/activity                    — paginated logs (owner+)
router.get('/',         ownerOnly, activityController.getActivityLogs);

// GET /api/v1/activity/filters            — distinct actions & entities
router.get('/filters',  ownerOnly, activityController.getFilters);

// GET /api/v1/activity/summary            — last 7 days summary widget
router.get('/summary',  ownerOnly, activityController.getActivitySummary);

// GET /api/v1/activity/:entity/:id        — history of one record
router.get(
  '/:entity/:id',
  ownerOnly,
  validate(entityHistoryParamsSchema, 'params'),
  activityController.getEntityHistory
);

module.exports = router;
