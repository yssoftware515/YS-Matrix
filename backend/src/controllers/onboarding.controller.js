// ============================================================
// YS-MATRIX ERP - Onboarding Controller
// Author: Yahya Al-Sulami 🦅
// ============================================================

const prisma  = require('../config/database');
const response = require('../utils/response');
const logger   = require('../config/logger');
const { auditLog } = require('../middleware/audit.middleware');

// ─────────────────────────────────────────────────────────────
// PATCH /api/v1/showrooms/onboard
//
// Called by the Owner during the first-run wizard.
// Updates showroom info and flips is_onboarded → true.
// Idempotent: can be called multiple times safely.
// ─────────────────────────────────────────────────────────────
const onboardShowroom = async (req, res) => {
  try {
    const { name, logo_url, address, phone, email } = req.body;
    const showroomId = req.showroomId;

    // Verify showroom exists and belongs to this user
    const existing = await prisma.showroom.findUnique({
      where: { id: showroomId },
    });

    if (!existing) {
      return response.notFound(res, 'Showroom not found');
    }

    // Only OWNER (or SuperAdmin) can onboard
    if (!['OWNER', 'SUPER_ADMIN'].includes(req.user.role)) {
      return response.forbidden(res, 'Only the showroom owner can complete onboarding');
    }

    const updated = await prisma.showroom.update({
      where: { id: showroomId },
      data: {
        name,
        ...(logo_url  !== undefined && { logo_url }),
        ...(address   !== undefined && { address }),
        ...(phone     !== undefined && { phone }),
        ...(email     !== undefined && { email }),
        is_onboarded: true,
      },
      select: {
        id:           true,
        name:         true,
        slug:         true,
        logo_url:     true,
        address:      true,
        phone:        true,
        email:        true,
        is_onboarded: true,
        is_active:    true,
        license_expiry: true,
      },
    });

    await auditLog({
      showroomId,
      userId: req.user.id,
      action:   'ONBOARD_SHOWROOM',
      entity:   'showroom',
      entityId: showroomId,
      oldData:  { is_onboarded: existing.is_onboarded, name: existing.name },
      newData:  { is_onboarded: true, name },
      ipAddress: req.ip,
    });

    return response.success(
      res,
      updated,
      existing.is_onboarded
        ? 'Showroom profile updated successfully'
        : 'Onboarding completed successfully — welcome to YS-MATRIX! 🦅'
    );
  } catch (err) {
    logger.error('Onboarding error:', err);
    return response.error(res, 'Onboarding failed');
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/showrooms/onboarding-status
//
// Quick check for the frontend to know whether to show
// the onboarding wizard or proceed to the dashboard.
// ─────────────────────────────────────────────────────────────
const getOnboardingStatus = async (req, res) => {
  try {
    const showroom = await prisma.showroom.findUnique({
      where: { id: req.showroomId },
      select: {
        id:           true,
        name:         true,
        logo_url:     true,
        address:      true,
        phone:        true,
        email:        true,
        is_onboarded: true,
      },
    });

    if (!showroom) {
      return response.notFound(res, 'Showroom not found');
    }

    // Phase B.3 (F2): address/phone/email surfaced here so the settings
    // page can prefill the business-profile form. Backward-compatible:
    // existing callers ignore the extra fields.
    return response.success(res, {
      is_onboarded:  showroom.is_onboarded,
      showroom_id:   showroom.id,
      showroom_name: showroom.name,
      logo_url:      showroom.logo_url,
      address:       showroom.address,
      phone:         showroom.phone,
      email:         showroom.email,
      // Tells the frontend which step to render
      next_step: showroom.is_onboarded ? 'dashboard' : 'onboarding_wizard',
    });
  } catch (err) {
    logger.error('Onboarding status error:', err);
    return response.error(res, 'Failed to fetch onboarding status');
  }
};

module.exports = { onboardShowroom, getOnboardingStatus };
