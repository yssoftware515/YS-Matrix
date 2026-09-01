// ============================================================
// YS-MATRIX ERP — Search Validation Schemas
// Matrix Audit (Phase 4) — search route had no Zod validation at all
// ============================================================

const { z } = require('zod');

// ─────────────────────────────────────────────────────────────
// searchQuerySchema
// GET /api/v1/search?q=keyword
// ─────────────────────────────────────────────────────────────
const searchQuerySchema = z.object({
  q: z
    .string({ required_error: 'كلمة البحث مطلوبة' })
    .trim()
    // Matrix Audit: minimum 2 chars, not just "non-empty" — a single
    // character against name/phone/invoice fields with `contains`
    // matching scans a large fraction of the table for almost no
    // useful signal. This directly serves the audit's stated concern
    // ("unnecessary DB load"), not just "missing/empty" rejection.
    .min(2, 'كلمة البحث يجب أن تكون حرفين على الأقل')
    .max(200, 'كلمة البحث طويلة جداً'),
});

module.exports = { searchQuerySchema };
