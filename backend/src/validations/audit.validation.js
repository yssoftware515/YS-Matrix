// ============================================================
// YS-MATRIX ERP — Platform Audit Validation Schemas
// (Phase 3 — Platform Audit & Observability)
//
// Validation contract for /api/v1/admin/audit/*:
//   • Tap-proof pagination: page int ≥ 1, limit int 1..100 — mirror
//     of the activity surface so an oversized limit can never be
//     used to dump the whole trail in one request.
//   • Every filter is an opaque string; dates MUST parse (an invalid
//     date would otherwise surface as a 500 from Prisma instead of a
//     clean 400).
//   • Id params are opaque strings (DB rows may use non-cuid test
//     ids) — `min(1)` is used, same as idParamSchema.
// ============================================================

'use strict';

const { z } = require('zod');

const dateLikeSchema = z
  .string({ required_error: 'تاريخ غير صالح' })
  .trim()
  .refine((v) => !Number.isNaN(Date.parse(v)), {
    message: 'التاريخ يجب أن يكون صيغة ISO صالحة (YYYY-MM-DD أو ISO-8601)',
  });

// ── GET /api/v1/admin/audit/events ────────────────────────────
const auditQuerySchema = z.object({
  page:        z.coerce.number().int().positive().optional().default(1),
  limit:       z.coerce.number().int().min(1).max(100).optional().default(20),
  entity:      z.string().trim().min(1).optional(),
  action:      z.string().trim().min(1).optional(),
  user_id:     z.string().trim().min(1).optional(),
  showroom_id: z.string().trim().min(1).optional(),
  entity_id:   z.string().trim().min(1).optional(),
  date_from:   dateLikeSchema.optional(),
  date_to:     dateLikeSchema.optional(),
});

// ── GET /api/v1/admin/audit/:id ───────────────────────────────
const auditIdParamsSchema = z.object({
  id: z.string({ required_error: 'id مطلوب' }).min(1),
});

module.exports = { auditQuerySchema, auditIdParamsSchema };