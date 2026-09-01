// ============================================================
// YS-MATRIX ERP — Subscription / Payment Validation Schemas
// (Phase 4 — Production Hardening: account lifecycle + payments)
// ============================================================

'use strict';

const { z } = require('zod');

const emailField = z
  .string({ required_error: 'البريد الإلكتروني مطلوب' })
  .email('البريد الإلكتروني غير صالح')
  .toLowerCase()
  .trim();

const passwordField = z
  .string({ required_error: 'كلمة المرور مطلوبة' })
  .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
  .max(128, 'كلمة المرور طويلة جداً');

// ─────────────────────────────────────────────────────────────
// registerAccountSchema — PUBLIC self-registration
// POST /api/v1/auth/register-account
// Creates a showroom + its OWNER user. Role is ALWAYS OWNER and is
// NOT client-settable (no privileged role can be requested here).
// ─────────────────────────────────────────────────────────────
const registerAccountSchema = z.object({
  name: z
    .string({ required_error: 'الاسم مطلوب' })
    .trim()
    .min(2, 'الاسم يجب أن يكون حرفين على الأقل')
    .max(100, 'الاسم طويل جداً'),

  email:    emailField,
  password: passwordField,

  // Business/showroom display name — defaults to `name` server-side
  // when omitted (identities are always ID-based; names are display).
  showroom_name: z
    .string()
    .trim()
    .min(2, 'اسم المعرض يجب أن يكون حرفين على الأقل')
    .max(100, 'اسم المعرض طويل جداً')
    .optional(),

  phone: z
    .string()
    .trim()
    .max(20, 'رقم الهاتف طويل جداً')
    .optional(),
}).strict('لا يمكن إرسال حقول إضافية.');

// ─────────────────────────────────────────────────────────────
// subscriptionRequestSchema — customer purchase request
// POST /api/v1/subscriptions/request
// The payment AMOUNT is derived server-side from the selected plan
// — the client can never set the amount. Proof (screenshot) is
// optional at submit time and can be attached later.
// ─────────────────────────────────────────────────────────────
const subscriptionRequestSchema = z.object({
  plan_code: z.string({ required_error: 'رمز الباقة مطلوب' }).trim().min(1, 'رمز الباقة مطلوب').max(50),

  // Phase C.7: explicit billing period (MONTHLY | SIX_MONTHS | YEARLY).
  // Optional for backward compatibility — when present, the amount is
  // resolved from the MarketPricing catalog (approved Egypt model);
  // when absent, the legacy plan-row price path applies. The client
  // NEVER supplies an amount.
  billing_period: z
    .enum(['MONTHLY', 'SIX_MONTHS', 'YEARLY'])
    .optional(),

  method: z
    .string()
    .trim()
    .max(50)
    .default('MANUAL'),

  reference: z
    .string()
    .trim()
    .max(100, 'رقم العملية طويل جداً')
    .optional(),

  // Optional inline proof (base64 data URL or plain base64)
  proof_mime: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
  proof_data: z.string().optional(),
}).strict('لا يمكن إرسال حقول إضافية.');

// ─────────────────────────────────────────────────────────────
// paymentProofSchema — attach/replace proof + reference
// PATCH /api/v1/subscriptions/payments/:id
// ─────────────────────────────────────────────────────────────
const paymentProofSchema = z
  .object({
    proof_mime:   z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
    proof_data:   z.string().min(1, 'إثبات الدفع مطلوب').optional(),
    reference:    z.string().trim().max(100, 'رقم العملية طويل جداً').optional(),
    method:       z.string().trim().max(50).optional(),
  })
  .strict('لا يمكن إرسال حقول إضافية.')
  .refine((d) => d.proof_mime || d.proof_data || d.reference || d.method, {
    message: 'يجب إرسال حقل واحد على الأقل.',
  });

// ─────────────────────────────────────────────────────────────
// Admin review schemas
// POST /api/v1/admin/payments/:id/approve  (reason optional)
// POST /api/v1/admin/payments/:id/reject   (reason required)
// ─────────────────────────────────────────────────────────────
const adminApprovePaymentSchema = z
  .object({
    reason: z.string().trim().max(500, 'السبب طويل جداً').optional(),
  })
  .strict('لا يمكن إرسال حقول إضافية.');

const adminRejectPaymentSchema = z
  .object({
    reason: z
      .string({ required_error: 'سبب الرفض مطلوب' })
      .trim()
      .min(3, 'سبب الرفض يجب أن يكون 3 أحرف على الأقل')
      .max(500, 'سبب الرفض طويل جداً'),
  })
  .strict('لا يمكن إرسال حقول إضافية.');

// ─────────────────────────────────────────────────────────────
// Admin list filters (subscriptions + payments)
// ─────────────────────────────────────────────────────────────
const adminSubscriptionsQuerySchema = z.object({
  page:        z.coerce.number().int().min(1).default(1),
  limit:       z.coerce.number().int().min(1).max(100).default(20),
  status:      z.enum(['ACTIVE', 'PENDING_PAYMENT', 'EXPIRED', 'CANCELLED', 'TRIAL']).optional(),
  showroom_id: z.string().optional(),
  search:      z.string().trim().max(100).optional(),
  expiring_in: z.coerce.number().int().min(0).max(365).optional(),
  account:     z.enum(['PENDING_SUBSCRIPTION', 'PENDING_PAYMENT', 'ACTIVE', 'SUSPENDED', 'EXPIRED']).optional(),
});

const adminPaymentsQuerySchema = z.object({
  page:        z.coerce.number().int().min(1).default(1),
  limit:       z.coerce.number().int().min(1).max(100).default(20),
  status:      z.enum(['PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED', 'REJECTED']).optional(),
  showroom_id: z.string().optional(),
  search:      z.string().trim().max(100).optional(),
});

module.exports = {
  registerAccountSchema,
  subscriptionRequestSchema,
  paymentProofSchema,
  adminApprovePaymentSchema,
  adminRejectPaymentSchema,
  adminSubscriptionsQuerySchema,
  adminPaymentsQuerySchema,
};