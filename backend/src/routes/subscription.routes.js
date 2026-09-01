// ============================================================
// YS-MATRIX ERP — Subscription Routes (Phase 2 Stage 3 + Phase 4)
//
// Phase 4 additions (account lifecycle — customer surface):
//   GET   /api/v1/subscriptions/plans                      — catalog
//   GET   /api/v1/subscriptions/status                     — derived status
//   POST  /api/v1/subscriptions/request                    — purchase (OWNER)
//   GET   /api/v1/subscriptions/payments                   — own history
//   PATCH /api/v1/subscriptions/payments/:id               — attach proof
// ============================================================

'use strict';

const express                 = require('express');
const router                  = express.Router();
const subscriptionController  = require('../controllers/subscription.controller');
const lifecycleController     = require('../controllers/subscription.lifecycle.controller');
const { authenticate }        = require('../middleware/auth.middleware');
const { checkLicense }        = require('../middleware/license.middleware');
const { tenantGuard }         = require('../middleware/tenant.middleware');
const { superAdminOnly, ownerOnly } = require('../middleware/roles.middleware');
const { validate }            = require('../middleware/validate.middleware');
const {
  subscriptionRequestSchema,
  paymentProofSchema,
} = require('../validations/subscription.validation');

// Phase C.7: the PUBLIC commercial catalog (billing periods, derived
// prices, trial days) — mounted BEFORE authenticate so the public
// register page can render the approved offer. Deliberately contains
// ZERO tenant data: only the operator-created MarketPricing rows,
// canonical periods and trial duration.
router.get('/pricing', lifecycleController.listPricing);

// Phase 4: the lifecycle surface (plans/status/request/payments) is
// the account's SELF-SERVICE onboarding path — once a license/trial
// has lapsed, the account owner MUST still be able to reach it to
// purchase. It therefore deliberately does NOT run checkLicense here
// (license middleware governs the ERP business routes instead).
// PHASE 4 P1 FIX: tenantGuard is applied ONLY to the tenant-scoped
// routes, never to the SuperAdmin global routes. Mirrors the
// superadmin.routes.js conditional pattern: a SUPER_ADMIN request to
// a global operation (renew / all / summary) must be able to target
// ANY showroom — tenantGuard's uniform mismatch check (CROSS_TENANT_
// BLOCKED for any client-supplied showroom_id) would otherwise block
// renewals for other showrooms, and its ALS context (system showroom)
// would mis-scope tenant writes. The SA global handlers therefore run
// WITHOUT tenant context; renewSubscription explicitly scopes its own
// writes via runWithShowroomContext (see subscription.service.js).
// Ordinary tenant routes keep full tenantGuard enforcement.
router.use(authenticate);

// ── Tenant endpoints (any authenticated user) ─────────────────
// GET  /api/v1/subscriptions/current  — current subscription info
router.get('/current',  tenantGuard, checkLicense, subscriptionController.getCurrentSubscription);

// GET  /api/v1/subscriptions/history  — subscription history
router.get('/history',  tenantGuard, checkLicense, subscriptionController.listSubscriptions);

// ── Phase 4: lifecycle self-service surface ───────────────────
// GET  /api/v1/subscriptions/plans    — sellable catalog
router.get('/plans', tenantGuard, lifecycleController.listPlans);

// GET  /api/v1/subscriptions/status   — derived account status
router.get('/status', tenantGuard, lifecycleController.getStatus);

// POST /api/v1/subscriptions/request  — purchase request (OWNER)
router.post('/request', tenantGuard, ownerOnly, validate(subscriptionRequestSchema), lifecycleController.requestSubscription);

// POST /api/v1/subscriptions/renew-request — renewal/upgrade while
// ACTIVE (F2, OWNER). Same schema as /request: plan_code is the only
// required field; amount/currency resolve server-side from the plan.
router.post('/renew-request', tenantGuard, ownerOnly, validate(subscriptionRequestSchema), lifecycleController.requestRenewal);

// DELETE /api/v1/subscriptions/request — cancel the pending claim
// (F3, OWNER). Idempotent contract: 409 when nothing is pending.
router.delete('/request', tenantGuard, ownerOnly, lifecycleController.cancelPendingRequest);

// GET  /api/v1/subscriptions/payments — own payment history
router.get('/payments', tenantGuard, lifecycleController.listOwnPayments);

// PATCH /api/v1/subscriptions/payments/:id — attach proof/reference
router.patch(
  '/payments/:id',
  tenantGuard,
  ownerOnly,
  validate(paymentProofSchema),
  lifecycleController.attachPaymentProof
);

// ── SuperAdmin only — global operations, no tenant context ────
// GET  /api/v1/subscriptions/all      — all showrooms
router.get('/all',      superAdminOnly, subscriptionController.listAllSubscriptions);

// GET  /api/v1/subscriptions/summary  — dashboard summary
router.get('/summary',  superAdminOnly, subscriptionController.getSubscriptionSummary);

// POST /api/v1/subscriptions/renew    — renew a showroom
router.post('/renew',   superAdminOnly, subscriptionController.renewSubscription);

module.exports = router;