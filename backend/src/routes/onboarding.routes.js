// ============================================================
// YS-MATRIX ERP - Onboarding Routes
// Author: Yahya Al-Sulami 🦅
// ============================================================

const express = require('express');
const router  = express.Router();

const onboardingController = require('../controllers/onboarding.controller');
const { authenticate }     = require('../middleware/auth.middleware');
const { checkLicense }     = require('../middleware/license.middleware');
const { tenantGuard }      = require('../middleware/tenant.middleware');
const { validate }         = require('../middleware/validate.middleware');
const { onboardShowroomSchema } = require('../validations/showroom.validation');

// All onboarding routes require auth + license + tenant
router.use(authenticate, checkLicense, tenantGuard);

// GET — check current onboarding status (used by frontend on load)
router.get('/status', onboardingController.getOnboardingStatus);

// PATCH — submit onboarding form data
router.patch(
  '/',
  validate(onboardShowroomSchema),
  onboardingController.onboardShowroom
);

module.exports = router;
