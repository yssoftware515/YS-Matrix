// ============================================================
// YS-MATRIX ERP — Tenant Users Routes (F4 — Staff Management)
//
// Mount: /api/v1/users
//
// Guards: authenticate → checkLicense → tenantGuard → ownerOnly.
// License-gated like every ERP business surface (an expired account
// cannot manage staff — consistent with the F1 scoped-session
// contract and with /auth/register which this surface shares its
// creation path with). STAFF members read-only access? No — the
// whole surface is OWNER-only by design.
//
// POST /users reuses authController.register verbatim — the single
// canonical staff-creation flow (validateProfileAssignment →
// enforceUserLimit → email uniqueness → audit), never duplicated.
// ============================================================

'use strict';

const express     = require('express');
const router      = express.Router();

const usersController = require('../controllers/users.controller');
const authController  = require('../controllers/auth.controller');
const { authenticate }     = require('../middleware/auth.middleware');
const { checkLicense }     = require('../middleware/license.middleware');
const { tenantGuard }      = require('../middleware/tenant.middleware');
const { ownerOnly }        = require('../middleware/roles.middleware');
const { validate, validateMulti } = require('../middleware/validate.middleware');
const {
  registerSchema,
  usersQuerySchema,
  userToggleSchema,
} = require('../validations/auth.validation');
const { idParamSchema } = require('../validations/admin.validation');

router.use(authenticate, checkLicense, tenantGuard, ownerOnly);

// GET  /api/v1/users      — tenant users list (paginated)
router.get('/', validate(usersQuerySchema, 'query'), usersController.listUsers);

// POST /api/v1/users      — create STAFF (canonical register path)
router.post('/', validate(registerSchema), authController.register);

// PATCH /api/v1/users/:id — deactivate / reactivate STAFF
router.patch(
  '/:id',
  validateMulti({ params: idParamSchema, body: userToggleSchema }),
  usersController.toggleUser
);

module.exports = router;