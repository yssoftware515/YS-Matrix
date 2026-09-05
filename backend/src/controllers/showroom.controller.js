// ============================================================
// YS-MATRIX ERP - Showroom Controller (SuperAdmin Only)
// Author: Yahya Al-Sulami 🦅
// v1.1 — createShowroom now also creates the OWNER user
//        (Matrix Audit Priority 1 — was producing orphan showrooms)
// ============================================================

// ─────────────────────────────────────────────────────────────
// TENANT CONTEXT FIX (Matrix Audit — Priority 1)
// ─────────────────────────────────────────────────────────────
// This controller is a SuperAdmin-only, cross-tenant surface:
// every function here either lists/creates/updates the
// `showroom` row itself (a GLOBAL_MODEL — unaffected either
// way) OR — in getShowroomStats — deliberately targets ONE
// SPECIFIC showroom passed via :id, never "the caller's own
// tenant". It must NEVER use the tenant-SCOPED `prisma` client.
//
// Root cause this replaces:
//   showroom.routes.js runs tenantGuard for ALL requests
//   (unlike superadmin.routes.js, which skips it for
//   SUPER_ADMIN). tenantGuard resolves req.showroomId from
//   req.query/req.body — NEVER from req.params — so for
//   GET /:id/stats it falls back to the SuperAdmin's own/
//   system showroomId and stores THAT in AsyncLocalStorage.
//   getShowroomStats then manually set `where: { showroom_id: id }`
//   (the TARGET showroom from the URL) on the scoped models
//   user/inventory/sale. The Prisma extension's $allOperations
//   hook runs `args.where = { ...args.where, showroom_id: showroomId }`
//   using the ALS value — silently OVERWRITING the manually-set
//   target id with the SuperAdmin's own/system showroomId
//   (object spread: last key wins). Result: stats for the
//   WRONG showroom, every time, with no error or warning.
//
// Fix: use baseClient — the exact pattern already established
// correctly in superadmin.controller.js. baseClient has no
// auto-filtering and no fail-closed guard, so manual
// `where: { showroom_id: id }` clauses are now respected
// literally, with zero interference.
//
// ⚠️ Contract for future maintainers of this file: because
// baseClient does NOT auto-inject or enforce showroom_id, every
// query against a tenant-scoped model (user, inventory, sale,
// customer, supplier, expense, etc.) added to this file MUST be
// manually filtered by showroom_id where relevant — exactly as
// getShowroomStats already does below. There is no safety net.
const bcrypt = require('bcryptjs');
const { baseClient: db } = require('../config/database');
const response = require('../utils/response');
const logger = require('../config/logger');
const { auditLog } = require('../middleware/audit.middleware');
const { getPagination, buildPaginationMeta } = require('../utils/pagination');
const subscriptionService = require('../services/subscription.service');

// ─────────────────────────────────────────
// GET ALL SHOWROOMS
// ─────────────────────────────────────────
const getAllShowrooms = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const { search, is_active } = req.query;

    const where = {};
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { slug: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (is_active !== undefined) {
      where.is_active = is_active === 'true';
    }

    const [showrooms, total] = await Promise.all([
      db.showroom.findMany({
        where,
        skip,
        take: limit,
        orderBy: { created_at: 'desc' },
        select: {
          id: true, name: true, slug: true, phone: true, email: true,
          is_active: true, created_at: true, license_expiry: true,
          _count: { select: { users: true, inventory: true, sales: true } },
        },
      }),
      db.showroom.count({ where }),
    ]);

    return response.paginated(res, showrooms, buildPaginationMeta(total, page, limit));
  } catch (err) {
    logger.error('Get showrooms error:', err);
    return response.error(res, 'Failed to fetch showrooms');
  }
};

// ─────────────────────────────────────────
// CREATE SHOWROOM
// ─────────────────────────────────────────
// Matrix Audit (Priority 1): used to create Showroom + Subscription
// only, with NO User row — every new showroom was unreachable by
// anyone (zero users, no login possible). Now creates a login-capable
// OWNER user atomically in the SAME transaction. Body shape and
// validation enforced by validate(createShowroomSchema) at the route
// level (see showroom.routes.js); manual checks below are a
// defensive second layer, not the primary guard.
// ─────────────────────────────────────────
const createShowroom = async (req, res) => {
  try {
    const {
      name, slug, address, phone, email, license_expiry,
      owner_name, owner_email, owner_password,
    } = req.body;

    if (!name || !slug || !license_expiry || !owner_name || !owner_email || !owner_password) {
      return response.validationError(res, null, 'Name, slug, license_expiry, and owner credentials are required');
    }

    const normalizedSlug  = slug.toLowerCase().trim();
    const normalizedEmail = owner_email.toLowerCase().trim();

    // User.email is globally unique (see schema.prisma) — must check
    // across ALL showrooms, not just the one being created.
    const [existingSlug, existingOwnerEmail] = await Promise.all([
      db.showroom.findUnique({ where: { slug: normalizedSlug } }),
      db.user.findUnique({ where: { email: normalizedEmail } }),
    ]);

    if (existingSlug) {
      return response.validationError(res, null, 'Slug already exists');
    }
    if (existingOwnerEmail) {
      return response.validationError(res, null, 'Owner email already registered');
    }

    const password_hash = await bcrypt.hash(
      owner_password,
      parseInt(process.env.BCRYPT_ROUNDS || '12')
    );

    // Matrix Audit (Phase 5 — License/Subscription Unification): a
    // brand-new showroom's initial license_expiry used to be set with
    // no corresponding Subscription row — meaning the very FIRST
    // license period of every showroom was invisible to the SuperAdmin
    // subscription history/dashboard, same class of gap the v2 fix in
    // license.controller.js already closed for renewals. Can't reuse
    // subscriptionService.renewSubscription here (it requires an
    // EXISTING showroom — this one doesn't exist yet), so both rows
    // are created together instead, atomically — same callback-form
    // $transaction pattern already used in sales.service.js's
    // createSale, just on `db` (baseClient) since this whole
    // controller is cross-tenant.
    const { showroom, owner } = await db.$transaction(async (tx) => {
      const newShowroom = await tx.showroom.create({
        data: {
          name,
          slug: normalizedSlug,
          address,
          phone,
          email,
          license_expiry: new Date(license_expiry),
          is_active: true,
          // Matrix Audit (#13 — Onboarding Skip): createShowroom is
          // SuperAdmin-only (no self-signup path exists in this
          // system), and already collects every field the onboarding
          // wizard (onboarding.controller.js) collects — name,
          // address, phone, email. Leaving is_onboarded at its
          // default `false` here forced every SuperAdmin-created
          // showroom's brand-new OWNER to immediately hit
          // ensureOnboarded's block on every operational route,
          // despite having complete data already. logo_url — the one
          // field the wizard adds beyond this form — stays a normal,
          // ungated settings update; it doesn't justify blocking the
          // entire dashboard.
          is_onboarded: true,
        },
      });

      await tx.subscription.create({
        data: {
          showroom_id: newShowroom.id,
          plan_name:   'STANDARD',
          status:      'ACTIVE',
          started_at:  new Date(),
          expires_at:  newShowroom.license_expiry,
          renewed_by:  req.user.id,
          notes:       'منح أولي عند إنشاء المعرض',
        },
      });

      // Matrix Audit (Priority 1): the OWNER user — without this,
      // the showroom is created with zero users and is permanently
      // inaccessible. Created in the SAME transaction so a failure
      // here rolls back the showroom + subscription too (atomicity:
      // a showroom either gets a full, working setup, or nothing
      // at all persists).
      const newOwner = await tx.user.create({
        data: {
          showroom_id: newShowroom.id,
          name:        owner_name,
          email:       normalizedEmail,
          password_hash,
          role:        'OWNER',
          is_active:   true,
        },
        select: {
          id: true, name: true, email: true, role: true, is_active: true, created_at: true,
        },
      });

      return { showroom: newShowroom, owner: newOwner };
    });

    await auditLog({
      showroomId: req.showroomId,
      userId: req.user.id,
      action: 'CREATE_SHOWROOM',
      entity: 'showroom',
      entityId: showroom.id,
      newData: { ...showroom, owner_id: owner.id, owner_email: owner.email },
      ipAddress: req.ip,
    });

    return response.created(res, { ...showroom, owner }, 'Showroom created successfully');
  } catch (err) {
    logger.error('Create showroom error:', err);
    return response.error(res, 'Failed to create showroom');
  }
};

// ─────────────────────────────────────────
// UPDATE SHOWROOM (activate, extend license, etc.)
// ─────────────────────────────────────────
const updateShowroom = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, address, phone, email, is_active, license_expiry } = req.body;

    const existing = await db.showroom.findUnique({ where: { id } });
    if (!existing) return response.notFound(res, 'Showroom not found');

    // Matrix Audit (Phase 5 — License/Subscription Unification): this
    // used to update license_expiry as a plain field here, merged
    // with name/address/phone/etc — a THIRD code path writing it
    // directly, alongside subscriptionService.renewSubscription
    // (already used by /subscriptions/renew AND /licenses/renew since
    // the v2 fix above). That meant a renewal done through this
    // generic PUT left no Subscription row — invisible to the
    // SuperAdmin subscription history/dashboard. Delegating here too
    // means there is now exactly ONE place license_expiry is ever
    // written in the whole codebase — not three.
    //
    // Safe to call from this baseClient-only controller: traced
    // through renewSubscription's own Prisma calls — `showroom` is a
    // GLOBAL_MODEL (bypasses tenant filtering regardless of context)
    // and its one `subscription` write uses `create`, which the
    // tenant extension never filters/injects on for ANY model. No
    // AsyncLocalStorage context is required for either, regardless of
    // what showroomId tenantGuard resolved for this request.
    let updated = existing;

    if (license_expiry) {
      const result = await subscriptionService.renewSubscription({
        showroomId:    id,
        renewedBy:     req.user.id,
        newExpiryDate: license_expiry,
        // planName/amountPaid/paymentMethod/notes intentionally
        // omitted — this endpoint's contract never collected them,
        // same reasoning as license.controller.js's renewLicense.
      });

      auditLog({
        showroomId: req.showroomId,
        userId:     req.user.id,
        action:     'RENEW_LICENSE',
        entity:     'showroom',
        entityId:   id,
        oldData:    { license_expiry: existing.license_expiry },
        newData:    { license_expiry: result.new_expiry },
        ipAddress:  req.ip,
      });
    }

    // Remaining plain fields — applied AFTER the license branch above,
    // so an explicit is_active in THIS SAME request (e.g. renewing the
    // license while also deliberately deactivating, an unusual but
    // possible combination) wins over renewSubscription's own
    // "reactivate on renewal" default rather than being silently
    // overridden by it.
    const otherFieldsProvided =
      name !== undefined || address !== undefined ||
      phone !== undefined || email !== undefined || is_active !== undefined;

    if (otherFieldsProvided) {
      updated = await db.showroom.update({
        where: { id },
        data: {
          ...(name !== undefined && { name }),
          ...(address !== undefined && { address }),
          ...(phone !== undefined && { phone }),
          ...(email !== undefined && { email }),
          ...(is_active !== undefined && { is_active }),
        },
      });
    } else if (license_expiry) {
      // Only license_expiry changed — re-fetch so the response
      // reflects the post-renewal state instead of the pre-renewal
      // `existing` snapshot.
      updated = await db.showroom.findUnique({ where: { id } });
    }

    await auditLog({
      showroomId: req.showroomId,
      userId: req.user.id,
      action: 'UPDATE_SHOWROOM',
      entity: 'showroom',
      entityId: id,
      oldData: existing,
      newData: updated,
      ipAddress: req.ip,
    });

    return response.success(res, updated, 'Showroom updated successfully');
  } catch (err) {
    logger.error('Update showroom error:', err);
    return response.error(res, 'Failed to update showroom');
  }
};

// ─────────────────────────────────────────
// GET SHOWROOM STATS (SuperAdmin dashboard)
// ─────────────────────────────────────────
const getShowroomStats = async (req, res) => {
  try {
    const { id } = req.params;

    const [showroom, userCount, inventoryCount, salesData] = await Promise.all([
      db.showroom.findUnique({ where: { id } }),
      db.user.count({ where: { showroom_id: id } }),
      db.inventory.count({ where: { showroom_id: id } }),
      db.sale.aggregate({
        where: { showroom_id: id },
        _sum: { total: true, profit: true },
        _count: true,
      }),
    ]);

    if (!showroom) return response.notFound(res, 'Showroom not found');

    return response.success(res, {
      showroom,
      stats: {
        users: userCount,
        inventory: inventoryCount,
        sales: salesData._count,
        total_revenue: salesData._sum.total || 0,
        total_profit: salesData._sum.profit || 0,
      },
    });
  } catch (err) {
    logger.error('Get showroom stats error:', err);
    return response.error(res, 'Failed to fetch stats');
  }
};

module.exports = {
  getAllShowrooms,
  createShowroom,
  updateShowroom,
  getShowroomStats,
};
