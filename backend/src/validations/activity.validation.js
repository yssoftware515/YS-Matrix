// ============================================================
// YS-MATRIX ERP — Activity Validation Schemas
// Matrix Audit (Phase 4) — :entity accepted any string with no
// validation; an invalid value silently returned an empty array
// instead of a clear 400.
//
// ENTITY_TYPES below was built from an exhaustive search across the
// ENTIRE backend for every literal `entity:` value passed to
// auditLog() — not assumed. Confirmed sources:
//   user          → auth.controller.js, superadmin.controller.js
//   customer      → customer.controller.js
//   expense       → expense.controller.js
//   inventory     → inventory.controller.js
//   showroom      → showroom.controller.js, license.controller.js,
//                    onboarding.controller.js
//   sale          → sales.controller.js
//   subscription  → subscription.controller.js
//   supplier      → supplier.controller.js
//
// ⚠️ If a NEW entity type is ever audit-logged in the future, it MUST
// be added here too, or GET /api/v1/activity/:entity/:id will start
// rejecting valid requests for it with 400 instead of working.
// ============================================================

const { z } = require('zod');

const ENTITY_TYPES = [
  'user',
  'customer',
  'expense',
  'inventory',
  'showroom',
  'sale',
  'subscription',
  'supplier',
  'profile',   // Phase 3 — platform profiles are audit-logged under
               // entity 'profile' (admin.controller.js); without this,
               // GET /activity/profile/:id would 400 on valid rows.
];

const entityHistoryParamsSchema = z.object({
  entity: z.enum(ENTITY_TYPES, {
    errorMap: () => ({
      message: `entity غير صالح. القيم المسموحة: ${ENTITY_TYPES.join(', ')}`,
    }),
  }),
  id: z.string({ required_error: 'id مطلوب' }).min(1, 'id مطلوب'),
});

module.exports = { entityHistoryParamsSchema, ENTITY_TYPES };
