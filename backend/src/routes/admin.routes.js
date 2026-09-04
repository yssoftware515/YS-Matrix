// ============================================================
// YS-MATRIX ERP — Platform Administration Routes
// (Phase 2 — Delegated Platform Administrators)
//
// Mount: /api/v1/admin
//
// Guards:
//   • adminLimiter        — from SECURITY.rateLimit.superAdmin
//   • authenticate        — DB-resolved identity (never JWT claims)
//   • requireScope(GLOBAL)— server-side effective-authorization
//                           check (SUPER_ADMIN passes; delegated
//                           admins need GLOBAL-scope profile)
//   • requirePermission   — granular per-route key (platform_*)
//
// SECURITY FIX (intentional, documented): NO tenantGuard here.
// Every handler in admin.controller.js and the reused superadmin
// read handlers run on the unscoped baseClient by design — this
// is a platform-level surface, and applying tenantGuard would
// attempt scoped queries with no tenant context and fail closed.
// ============================================================

const express   = require('express');
const rateLimit = require('express-rate-limit');
const router    = express.Router();

const adminController        = require('../controllers/admin.controller');
const superAdminController   = require('../controllers/superadmin.controller');
const auditController        = require('../controllers/audit.controller');
const adminSubscriptionController = require('../controllers/admin.subscription.controller');
const { authenticate }       = require('../middleware/auth.middleware');
const {
  requirePermission,
  requireScope,
  SCOPES,
} = require('../services/authorization.service');
const { validate, validateMulti } = require('../middleware/validate.middleware');
const SECURITY                 = require('../config/security');

const {
  createProfileSchema,
  updateProfileSchema,
  profilesQuerySchema,
  createAdministratorSchema,
  updateAdministratorSchema,
  adminResetPasswordSchema,
  idParamSchema,
  superAdminUsersQuerySchema,
  superAdminShowroomsQuerySchema,
} = require('../validations/admin.validation');

const {
  auditQuerySchema,
  auditIdParamsSchema,
} = require('../validations/audit.validation');

const {
  adminSubscriptionsQuerySchema,
  adminPaymentsQuerySchema,
  adminApprovePaymentSchema,
  adminRejectPaymentSchema,
} = require('../validations/subscription.validation');

// ── Router-wide limit (SuperAdmin-class surface) ──────────────
const adminLimiter = rateLimit({
  windowMs: SECURITY.rateLimit.superAdmin.windowMs,
  max:      SECURITY.rateLimit.superAdmin.max,
  message:  { success: false, message: 'Too many requests from Admin, slow down.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Sensitive ops (create + password reset) ───────────────────
const sensitiveOpsLimiter = rateLimit({
  windowMs: SECURITY.rateLimit.sensitive.windowMs,
  max:      SECURITY.rateLimit.sensitive.max,
  message:  { success: false, message: 'Too many sensitive operations, please wait.' },
  standardHeaders: true,
  legacyHeaders:   false,
});

// ── Pipeline: limit → authenticate → GLOBAL scope ─────────────
router.use(adminLimiter, authenticate, requireScope(SCOPES.GLOBAL));

// ── Profiles ──────────────────────────────────────────────────
router.get(
  '/profiles',
  validate(profilesQuerySchema, 'query'),
  requirePermission('platform_profile:read', SCOPES.GLOBAL),
  adminController.listProfiles
);

router.post(
  '/profiles',
  sensitiveOpsLimiter,
  validate(createProfileSchema),
  requirePermission('platform_profile:create', SCOPES.GLOBAL),
  adminController.createProfile
);

router.patch(
  '/profiles/:id',
  validateMulti({ params: idParamSchema, body: updateProfileSchema }),
  requirePermission('platform_profile:update', SCOPES.GLOBAL),
  adminController.updateProfile
);

router.delete(
  '/profiles/:id',
  validate(idParamSchema, 'params'),
  requirePermission('platform_profile:delete', SCOPES.GLOBAL),
  adminController.deleteProfile
);

// ── Administrators ────────────────────────────────────────────
router.get(
  '/administrators',
  validate(superAdminUsersQuerySchema, 'query'),
  requirePermission('platform_admin:read', SCOPES.GLOBAL),
  adminController.listAdministrators
);

router.post(
  '/administrators',
  sensitiveOpsLimiter,
  validate(createAdministratorSchema),
  requirePermission('platform_admin:create', SCOPES.GLOBAL),
  adminController.createAdministrator
);

router.patch(
  '/administrators/:id',
  validateMulti({ params: idParamSchema, body: updateAdministratorSchema }),
  requirePermission('platform_admin:update', SCOPES.GLOBAL),
  adminController.updateAdministrator
);

router.post(
  '/administrators/:id/reset-password',
  sensitiveOpsLimiter,
  validateMulti({ params: idParamSchema, body: adminResetPasswordSchema }),
  requirePermission('platform_admin:update', SCOPES.GLOBAL),
  adminController.resetAdministratorPassword
);

// ── Read surfaces (reused superadmin handlers — same contracts,
// now gated by granular platform permissions) ──────────────────
router.get(
  '/users',
  validate(superAdminUsersQuerySchema, 'query'),
  requirePermission('platform_user:read', SCOPES.GLOBAL),
  superAdminController.getAllUsers
);

router.get(
  '/showrooms',
  validate(superAdminShowroomsQuerySchema, 'query'),
  requirePermission('platform_showroom:read', SCOPES.GLOBAL),
  superAdminController.getAllShowroomsGlobal
);

// ── Audit & observability (Phase 3) ──────────────────────────
// Platform-wide read surface: every handler runs on baseClient
// through the network-wide GLOBAL gate above. All three routes are
// read-only; responses are server-side redacted for delegated
// (non-SUPER_ADMIN) viewers. NOTE: /filters MUST be registered
// before /:id or Express would match the literal path as an id.
router.get(
  '/audit/events',
  validate(auditQuerySchema, 'query'),
  requirePermission('platform_audit:read', SCOPES.GLOBAL),
  auditController.listAuditEvents
);

router.get(
  '/audit/filters',
  requirePermission('platform_audit:read', SCOPES.GLOBAL),
  auditController.getAuditFilters
);

router.get(
  '/audit/:id',
  validate(auditIdParamsSchema, 'params'),
  requirePermission('platform_audit:read', SCOPES.GLOBAL),
  auditController.getAuditEventById
);

// ── Subscription & payment review (Phase 4 — account lifecycle) ──
// Platform surfaces for the manual payment approval loop. All reads
// run on baseClient through the GLOBAL gate; approve/reject delegate
// to the canonical activation path in subscription.lifecycle.service
// (never duplicated). Order matters: /subscriptions/summary must be
// registered before any /subscriptions/:id-style pattern (there is
// none today, but keeping the summary first costs nothing).
router.get(
  '/subscriptions',
  validate(adminSubscriptionsQuerySchema, 'query'),
  requirePermission('platform_subscription:read', SCOPES.GLOBAL),
  adminSubscriptionController.listSubscriptions
);

router.get(
  '/subscriptions/summary',
  requirePermission('platform_subscription:read', SCOPES.GLOBAL),
  adminSubscriptionController.getSummary
);

router.get(
  '/showrooms/:id/account',
  validate(idParamSchema, 'params'),
  requirePermission('platform_subscription:read', SCOPES.GLOBAL),
  adminSubscriptionController.getAccountDetail
);

router.get(
  '/payments',
  validate(adminPaymentsQuerySchema, 'query'),
  requirePermission('platform_payment:read', SCOPES.GLOBAL),
  adminSubscriptionController.listPayments
);

router.get(
  '/payments/:id',
  validate(idParamSchema, 'params'),
  requirePermission('platform_payment:read', SCOPES.GLOBAL),
  adminSubscriptionController.getPayment
);

router.post(
  '/payments/:id/approve',
  sensitiveOpsLimiter,
  validateMulti({ params: idParamSchema, body: adminApprovePaymentSchema }),
  requirePermission('platform_payment:update', SCOPES.GLOBAL),
  adminSubscriptionController.approvePayment
);

router.post(
  '/payments/:id/reject',
  sensitiveOpsLimiter,
  validateMulti({ params: idParamSchema, body: adminRejectPaymentSchema }),
  requirePermission('platform_payment:update', SCOPES.GLOBAL),
  adminSubscriptionController.rejectPayment
);

module.exports = router;