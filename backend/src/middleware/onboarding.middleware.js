// ============================================================
// YS-MATRIX ERP — Onboarding Guard Middleware (Phase 2 Stage 1)
// Changes vs original:
//   • Uses response.onboardingRequired() unified helper
//   • SuperAdmin bypass preserved
//   • No breaking change
// ============================================================

'use strict';

const response = require('../utils/response');

/**
 * ensureOnboarded
 *
 * Blocks access to operational routes until the showroom owner
 * completes the onboarding wizard.
 *
 * Must run AFTER: authenticate → checkLicense → tenantGuard
 */
const ensureOnboarded = (req, res, next) => {
  const { user } = req;

  // SuperAdmin is always exempt
  if (user.role === 'SUPER_ADMIN') return next();

  const isOnboarded = user.showroom?.is_onboarded;

  if (!isOnboarded) {
    return response.onboardingRequired(res);
  }

  next();
};

module.exports = { ensureOnboarded };
