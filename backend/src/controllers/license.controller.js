// ============================================================
// YS-MATRIX ERP - License Controller
// Author: Yahya Al-Sulami 🦅
// ============================================================

const prisma = require('../config/database');
const response = require('../utils/response');
const logger = require('../config/logger');
const SECURITY = require('../config/security');
const { auditLog } = require('../middleware/audit.middleware');
const subscriptionService = require('../services/subscription.service');

// ─────────────────────────────────────────
// GET LICENSE STATUS (for current showroom)
// ─────────────────────────────────────────
const getLicenseStatus = async (req, res) => {
  try {
    const showroom = await prisma.showroom.findUnique({
      where: { id: req.showroomId },
      select: { id: true, name: true, is_active: true, license_expiry: true },
    });

    if (!showroom) return response.notFound(res, 'Showroom not found');

    const now       = new Date();
    const expiry    = new Date(showroom.license_expiry);
    const isExpired = now > expiry;
    const daysLeft  = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));

    return response.success(res, {
      showroom_id:     showroom.id,
      showroom_name:   showroom.name,
      is_active:       showroom.is_active,
      license_expiry:  showroom.license_expiry,
      is_expired:      isExpired,
      days_left:       isExpired ? 0 : daysLeft,
      status:
        !showroom.is_active ? 'INACTIVE'
        : isExpired          ? 'EXPIRED'
        : daysLeft <= 7      ? 'EXPIRING_SOON'
        : 'ACTIVE',
    });
  } catch (err) {
    logger.error('License status error:', err);
    return response.error(res, 'Failed to fetch license status');
  }
};

// ─────────────────────────────────────────
// RENEW LICENSE (SuperAdmin only)
//
// v2 — delegates to subscriptionService.renewSubscription instead
// of updating showroom.license_expiry directly. This was changed
// because two separate code paths (this endpoint, and
// /subscriptions/renew) were both writing to showroom.license_expiry
// independently — this one with NO corresponding `subscription`
// row created, the other one with a row created inside the same
// transaction. That meant a renewal done through /licenses/renew
// was invisible to the SuperAdmin subscription history/dashboard
// (listAllSubscriptions, getSubscriptionSummary) even though the
// license itself was correctly extended.
//
// showroom.license_expiry REMAINS the single source of truth for
// access control (license.middleware reads only from it, unchanged).
// subscription rows are the audit/history trail. This endpoint now
// guarantees both are written together, atomically, via the same
// service used by /subscriptions/renew — so there is exactly ONE
// renewal code path, not two.
//
// Request/response shape for callers of /licenses/renew is UNCHANGED.
// ─────────────────────────────────────────
const renewLicense = async (req, res) => {
  try {
    const { showroom_id, months, new_expiry_date } = req.body;

    if (!showroom_id) {
      return response.validationError(res, null, 'showroom_id is required');
    }
    if (!months && !new_expiry_date) {
      return response.validationError(res, null, 'months or new_expiry_date is required');
    }

    // Fetch old expiry first purely for the response/audit "old_expiry" field —
    // subscriptionService.renewSubscription does its own existence check
    // and will throw NOT_FOUND if the showroom doesn't exist.
    const showroomBefore = await prisma.showroom.findUnique({ where: { id: showroom_id } });
    if (!showroomBefore) return response.notFound(res, 'Showroom not found');

    const result = await subscriptionService.renewSubscription({
      showroomId:    showroom_id,
      renewedBy:     req.user.id,
      months,
      newExpiryDate: new_expiry_date,
      // planName/amountPaid/paymentMethod/notes intentionally omitted —
      // this endpoint's contract never collected them. They'll be null
      // on the created subscription row, which is correct: we don't
      // want to fabricate billing details that weren't actually provided.
    });

    await auditLog({
      // Phase 4 P1: renew is a SuperAdmin GLOBAL route without
      // tenantGuard → req.showroomId unset → system-showroom fallback
      // (target showroom preserved in entityId/newData).
      showroomId: req.showroomId || SECURITY.tenant.systemShowroomId,
      userId: req.user.id,
      action: 'RENEW_LICENSE',
      entity: 'showroom',
      entityId: showroom_id,
      oldData: { license_expiry: showroomBefore.license_expiry },
      newData: { license_expiry: result.new_expiry },
      ipAddress: req.ip,
    });

    return response.success(res, {
      showroom_id: result.showroom_id,
      old_expiry:  showroomBefore.license_expiry,
      new_expiry:  result.new_expiry,
      is_active:   true,
    }, 'License renewed successfully');
  } catch (err) {
    if (err.code === 'NOT_FOUND')        return response.notFound(res, err.message);
    if (err.code === 'VALIDATION_ERROR') return response.validationError(res, null, err.message);
    logger.error('Renew license error:', err);
    return response.error(res, 'Failed to renew license');
  }
};

// ─────────────────────────────────────────
// GET ALL LICENSES (SuperAdmin dashboard)
// ─────────────────────────────────────────
const getAllLicenses = async (req, res) => {
  try {
    const showrooms = await prisma.showroom.findMany({
      select: {
        id: true, name: true, slug: true,
        is_active: true, license_expiry: true,
        _count: { select: { users: true } },
      },
      orderBy: { license_expiry: 'asc' },
    });

    const now = new Date();
    const enriched = showrooms.map((s) => {
      const expiry  = new Date(s.license_expiry);
      const expired = now > expiry;
      const daysLeft = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
      return {
        ...s,
        is_expired:   expired,
        days_left:    expired ? 0 : daysLeft,
        status:
          !s.is_active  ? 'INACTIVE'
          : expired      ? 'EXPIRED'
          : daysLeft <=7 ? 'EXPIRING_SOON'
          : 'ACTIVE',
      };
    });

    const summary = {
      total:          enriched.length,
      active:         enriched.filter((s) => s.status === 'ACTIVE').length,
      expiring_soon:  enriched.filter((s) => s.status === 'EXPIRING_SOON').length,
      expired:        enriched.filter((s) => s.status === 'EXPIRED').length,
      inactive:       enriched.filter((s) => s.status === 'INACTIVE').length,
    };

    return response.success(res, { summary, showrooms: enriched });
  } catch (err) {
    logger.error('Get all licenses error:', err);
    return response.error(res, 'Failed to fetch licenses');
  }
};

module.exports = { getLicenseStatus, renewLicense, getAllLicenses };
