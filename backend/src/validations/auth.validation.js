// ============================================================
// YS-MATRIX ERP - Auth Validation Schemas
// Author: Yahya Al-Sulami 🦅
// ============================================================

const { z } = require('zod');

// ─────────────────────────────────────────────────────────────
// Reusable primitives
// ─────────────────────────────────────────────────────────────
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
// loginSchema
// POST /api/v1/auth/login
// ─────────────────────────────────────────────────────────────
const loginSchema = z.object({
  email:    emailField,
  password: z.string({ required_error: 'كلمة المرور مطلوبة' }).min(1, 'كلمة المرور مطلوبة'),
});

// ─────────────────────────────────────────────────────────────
// registerSchema
// POST /api/v1/auth/register
// ─────────────────────────────────────────────────────────────
const registerSchema = z.object({
  name: z
    .string({ required_error: 'الاسم مطلوب' })
    .trim()
    .min(2, 'الاسم يجب أن يكون حرفين على الأقل')
    .max(100, 'الاسم طويل جداً'),

  email:    emailField,
  password: passwordField,

  role: z
    .enum(['OWNER', 'STAFF'], {
      errorMap: () => ({ message: 'الصلاحية يجب أن تكون OWNER أو STAFF' }),
    })
    .optional()
    .default('STAFF'),
});

// ─────────────────────────────────────────────────────────────
// refreshTokenSchema
// POST /api/v1/auth/refresh
// ─────────────────────────────────────────────────────────────
const refreshTokenSchema = z.object({
  refreshToken: z
    .string({ required_error: 'Refresh token مطلوب' })
    .min(1, 'Refresh token مطلوب'),
});

// ─────────────────────────────────────────────────────────────
// changePasswordSchema
// PUT /api/v1/auth/change-password
// ─────────────────────────────────────────────────────────────
const changePasswordSchema = z
  .object({
    currentPassword: z
      .string({ required_error: 'كلمة المرور الحالية مطلوبة' })
      .min(1, 'كلمة المرور الحالية مطلوبة'),

    newPassword: passwordField,

    confirmPassword: z
      .string({ required_error: 'تأكيد كلمة المرور مطلوب' })
      .min(1, 'تأكيد كلمة المرور مطلوب'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'كلمة المرور الجديدة وتأكيدها غير متطابقين',
    path: ['confirmPassword'],
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية',
    path: ['newPassword'],
  });

// ─────────────────────────────────────────────────────────────
// resetPasswordSchema (Matrix Audit — Phase 1)
// POST /api/v1/auth/reset-password
// ─────────────────────────────────────────────────────────────
const resetPasswordSchema = z
  .object({
    token: z
      .string({ required_error: 'رمز إعادة التعيين مطلوب' })
      .min(1, 'رمز إعادة التعيين مطلوب'),

    newPassword: passwordField,

    confirmPassword: z
      .string({ required_error: 'تأكيد كلمة المرور مطلوب' })
      .min(1, 'تأكيد كلمة المرور مطلوب'),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'كلمة المرور الجديدة وتأكيدها غير متطابقين',
    path: ['confirmPassword'],
  });

// ─────────────────────────────────────────────────────────────
// updateProfileSchema
// PATCH /api/v1/auth/me
//
// Deliberately narrow: ONLY name + avatar_url. Any other key
// (email, role, showroom_id, is_active, password) is rejected
// outright via .strict() — a 400 with a clear "unrecognized key"
// error, not a silent drop. Changing email/role/tenant requires
// separate, purpose-built flows with their own verification —
// bundling them into a generic "profile update" endpoint is
// exactly how privilege-escalation and tenant-hijack bugs get
// introduced by accident later.
//
// .trim() is chained BEFORE .min()/.max() (unlike registerSchema's
// name field above) — validates the length of the value that will
// actually be stored, not the raw pre-trim input. A whitespace-
// padded 2-char name should not pass a "min 2 real characters" check.
// ─────────────────────────────────────────────────────────────
const updateProfileSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'الاسم يجب أن يكون حرفين على الأقل')
      .max(100, 'الاسم طويل جداً')
      .optional(),

    // Nullable: explicitly sending `avatar_url: null` clears the
    // avatar (matches CLAUDE.md convention — "logo_url expects an
    // external URL, not a file"; same applies here, no upload
    // endpoint, just a URL string pointing at externally-hosted art).
    avatar_url: z
      .string()
      .trim()
      .url('رابط الصورة الشخصية غير صالح')
      .max(2048, 'رابط الصورة الشخصية طويل جداً')
      .nullable()
      .optional(),
  })
  .strict('لا يمكن تعديل هذا الحقل من هذا المسار.')
  .refine(
    (data) => data.name !== undefined || data.avatar_url !== undefined,
    { message: 'يجب إرسال حقل واحد على الأقل للتحديث (name أو avatar_url).' }
  );

// ─────────────────────────────────────────────────────────────
// usersQuerySchema (F4 — tenant staff list)
// GET /api/v1/users
// ─────────────────────────────────────────────────────────────
const usersQuerySchema = z.object({
  page:      z.coerce.number().int().positive().optional().default(1),
  limit:     z.coerce.number().int().min(1).max(100).optional().default(20),
  role:      z.enum(['OWNER', 'STAFF']).optional(),
  is_active: z.enum(['true', 'false']).optional(),
});

// ─────────────────────────────────────────────────────────────
// userToggleSchema (F4 — deactivate/reactivate staff)
// PATCH /api/v1/users/:id
// ─────────────────────────────────────────────────────────────
const userToggleSchema = z.object({
  is_active: z.boolean({ required_error: 'is_active مطلوب' }),
});

module.exports = {
  loginSchema,
  registerSchema,
  refreshTokenSchema,
  changePasswordSchema,
  resetPasswordSchema,
  updateProfileSchema,
  usersQuerySchema,
  userToggleSchema,
};
