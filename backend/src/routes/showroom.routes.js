// ============================================================
// YS-MATRIX ERP - Showroom Routes (SuperAdmin Only)
// Author: Yahya Al-Sulami 🦅
// v1.1 — Added validate(createShowroomSchema) on POST /
// ============================================================

const express = require('express');
const router = express.Router();
const showroomController = require('../controllers/showroom.controller');
const { authenticate } = require('../middleware/auth.middleware');
const { tenantGuard } = require('../middleware/tenant.middleware');
const { superAdminOnly } = require('../middleware/roles.middleware');
const { validate } = require('../middleware/validate.middleware');
const { createShowroomSchema } = require('../validations/showroom.validation');

// All showroom management routes require SuperAdmin
router.use(authenticate, tenantGuard, superAdminOnly);

router.get('/', showroomController.getAllShowrooms);
router.post('/', validate(createShowroomSchema), showroomController.createShowroom);
router.put('/:id', showroomController.updateShowroom);
router.get('/:id/stats', showroomController.getShowroomStats);

module.exports = router;
