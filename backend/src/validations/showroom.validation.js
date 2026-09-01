// ============================================================
// YS-MATRIX ERP - Showroom + SuperAdmin Validation Schemas
// Author: Yahya Al-Sulami 🦅
// v1.3 — Added createShowroomSchema (owner account required)
// ============================================================

const { z } = require('zod');

// ─────────────────────────────────────────────────────────────
// createShowroomSchema
// POST /api/v1/showrooms
// Matrix Audit (Priority 1): now requires owner credentials so
// every new showroom is created WITH a login-capable OWNER user
// in the same transaction — no more orphaned showrooms.
// ─────────────────────────────────────────────────────────────
const createShowroomSchema = z.object({
  name: z
    .string({ required_error: 'اسم المعرض مطلوب' })
    .min(2, 'اسم المعرض يجب أن يكون حرفين على الأقل')
    .max(100)
    .trim(),

  slug: z
    .string({ required_error: 'الـ slug مطلوب' })
    .min(2)
    .max(50)
    .regex(/^[a-z0-9-]+$/, 'الـ slug يجب أن يحتوي أحرف إنجليزية صغيرة وأرقام وشرطات فقط')
    .trim(),

  address: z.string().max(250).trim().optional().nullable(),
  phone:   z.string().max(20).trim().optional().nullable(),
  email:   z.string().email().toLowerCase().trim().optional().nullable(),

  license_expiry: z.coerce.date({ required_error: 'تاريخ انتهاء الترخيص مطلوب' }),

  // ── Owner account (Matrix Audit Priority 1) ────────────────
  owner_name: z
    .string({ required_error: 'اسم مدير المعرض مطلوب' })
    .min(2, 'اسم المدير يجب أن يكون حرفين على الأقل')
    .max(100)
    .trim(),

  owner_email: z
    .string({ required_error: 'بريد مدير المعرض مطلوب' })
    .email('بريد المدير غير صالح')
    .toLowerCase()
    .trim(),

  owner_password: z
    .string({ required_error: 'كلمة مرور مدير المعرض مطلوبة' })
    .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
    .max(128),
});

// ─────────────────────────────────────────────────────────────
// onboardShowroomSchema
// ─────────────────────────────────────────────────────────────
const onboardShowroomSchema = z.object({
  name: z
    .string({ required_error: 'اسم المعرض مطلوب' })
    .min(2, 'اسم المعرض يجب أن يكون حرفين على الأقل')
    .max(100, 'اسم المعرض طويل جداً')
    .trim(),

  logo_url: z.string().url('رابط الشعار غير صالح').max(500).optional().nullable(),
  address:  z.string().max(250).trim().optional().nullable(),
  phone:    z.string().max(20).trim().optional().nullable(),
  email:    z.string().email().toLowerCase().trim().optional().nullable(),
});

// ─────────────────────────────────────────────────────────────
// superAdminResetPasswordSchema
// ─────────────────────────────────────────────────────────────
const superAdminResetPasswordSchema = z.object({
  user_id: z
    .string({ required_error: 'user_id مطلوب' })
    .cuid('user_id غير صالح'),

  new_password: z
    .string()
    .min(8, 'كلمة المرور المؤقتة يجب أن تكون 8 أحرف على الأقل')
    .max(128)
    .optional(),
});

// ─────────────────────────────────────────────────────────────
// forgotPasswordRequestSchema
// ─────────────────────────────────────────────────────────────
const forgotPasswordRequestSchema = z.object({
  email: z
    .string({ required_error: 'البريد الإلكتروني مطلوب' })
    .email('البريد الإلكتروني غير صالح')
    .toLowerCase()
    .trim(),
});

// ─────────────────────────────────────────────────────────────
// superAdminShowroomsQuerySchema
// ─────────────────────────────────────────────────────────────
const superAdminShowroomsQuerySchema = z.object({
  page:         z.coerce.number().int().positive().optional().default(1),
  limit:        z.coerce.number().int().min(1).max(100).optional().default(20),
  search:       z.string().trim().optional(),
  is_active:    z.enum(['true', 'false']).optional(),
  is_onboarded: z.enum(['true', 'false']).optional(),
  expiring_in:  z.coerce.number().int().positive().optional(),
});

// ─────────────────────────────────────────────────────────────
// superAdminUsersQuerySchema
// GET /api/v1/superadmin/users
// ─────────────────────────────────────────────────────────────
const superAdminUsersQuerySchema = z.object({
  page:        z.coerce.number().int().positive().optional().default(1),
  limit:       z.coerce.number().int().min(1).max(100).optional().default(20),
  search:      z.string().trim().optional(),
  role:        z.enum(['SUPER_ADMIN', 'OWNER', 'STAFF']).optional(),
  showroom_id: z.string().cuid('showroom_id غير صالح').optional(),
  is_active:   z.enum(['true', 'false']).optional(),
});

// ─────────────────────────────────────────────────────────────
// superAdminCreateUserSchema
// POST /api/v1/superadmin/users
// ─────────────────────────────────────────────────────────────
const superAdminCreateUserSchema = z.object({
  name: z
    .string({ required_error: 'الاسم مطلوب' })
    .min(2, 'الاسم يجب أن يكون حرفين على الأقل')
    .max(100)
    .trim(),

  email: z
    .string({ required_error: 'البريد الإلكتروني مطلوب' })
    .email('البريد الإلكتروني غير صالح')
    .toLowerCase()
    .trim(),

  password: z
    .string({ required_error: 'كلمة المرور مطلوبة' })
    .min(8, 'كلمة المرور يجب أن تكون 8 أحرف على الأقل')
    .max(128),

  role: z
    .enum(['OWNER', 'STAFF'], {
      errorMap: () => ({ message: 'الصلاحية يجب أن تكون OWNER أو STAFF' }),
    })
    .optional()
    .default('OWNER'),

  showroom_id: z
    .string({ required_error: 'showroom_id مطلوب' })
    .cuid('showroom_id غير صالح'),
});

// ─────────────────────────────────────────────────────────────
// superAdminUpdateUserSchema
// PATCH /api/v1/superadmin/users/:id
// ─────────────────────────────────────────────────────────────
const superAdminUpdateUserSchema = z
  .object({
    name: z.string().min(2).max(100).trim().optional(),
    role: z
      .enum(['OWNER', 'STAFF'], {
        errorMap: () => ({ message: 'الصلاحية يجب أن تكون OWNER أو STAFF' }),
      })
      .optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    { message: 'يجب توفير حقل واحد على الأقل للتحديث' }
  );

module.exports = {
  createShowroomSchema,
  onboardShowroomSchema,
  superAdminResetPasswordSchema,
  forgotPasswordRequestSchema,
  superAdminShowroomsQuerySchema,
  superAdminUsersQuerySchema,
  superAdminCreateUserSchema,
  superAdminUpdateUserSchema,
};
