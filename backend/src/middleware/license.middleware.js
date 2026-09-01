// ============================================================
// YS-MATRIX ERP — License Middleware (Phase 2 Stage 1)
// Changes vs original:
//   • Uses unified response helpers (licenseExpired, showroomInactive)
//   • Uses SECURITY.license.warningDaysThreshold from config
//   • Adds X-License-Days-Left header (in addition to existing warnings)
//   • SuperAdmin bypass preserved
// ============================================================

'use strict';

const response = require('../utils/response');
const SECURITY = require('../config/security');

/**
 * checkLicense
 *
 * Must run AFTER authenticate middleware.
 * Checks if the showroom's license is valid before allowing access.
 */
const checkLicense = (req, res, next) => {
  const { user } = req;

  // SuperAdmin bypasses all license checks
  if (user.role === 'SUPER_ADMIN') return next();

  const showroom = user.showroom;

  // Showroom deactivated by admin
  if (!showroom || !showroom.is_active) {
    return response.showroomInactive(res);
  }

  const now      = new Date();
  const expiry   = new Date(showroom.license_expiry);
  const isExpired = now > expiry;

  if (isExpired) {
    const daysExpired = Math.floor((now - expiry) / (1000 * 60 * 60 * 24));
    return response.licenseExpired(res, expiry, daysExpired);
  }

  // License expiring soon — add warning headers but allow through
  const daysLeft = Math.floor((expiry - now) / (1000 * 60 * 60 * 24));
  const threshold = SECURITY.license.warningDaysThreshold;

  if (daysLeft <= threshold) {
    res.setHeader('X-License-Warning',   `License expires in ${daysLeft} day(s)`);
    res.setHeader('X-License-Expiry',    expiry.toISOString());
    res.setHeader('X-License-Days-Left', String(daysLeft));
  }

  next();
};

module.exports = { checkLicense };
