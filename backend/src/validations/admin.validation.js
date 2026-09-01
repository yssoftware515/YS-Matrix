// ============================================================
// YS-MATRIX ERP — Platform Administration Validation Schemas
// (Phase 2 — Delegated Platform Administrators)
//
// Validation contract for /api/v1/admin:
//   • Profile names: uppercase [A-Z_]{3,40}, reserved names
//     (OWNER / STAFF / SUPER_ADMIN) rejected — the protected
//     system authority and parity profiles are never assignable.
//   • Grant scopes: SHOWROOM | GLOBAL only (SELF grants exist
//     exclusively inside the seeded parity rows).
//   • Platform permissions (platform_*) are GLOBAL-only grants;
//     all other catalog permissions are SHOWROOM-only — a grant
//     can never combine a platform resource with a showroom
//     scope, or vice versa.
//   • Id params are opaque strings — DB rows may use non-cuid
//     test ids, so `min(1)` is used instead of `z.string().cuid()`.
// ============================================================

'use strict';

const { z } = require('zod');
const {
  SCOPES,
  isCatalogPermission,
  isPlatformPermission,
} = require('../services/permissionCatalog');

const {
  superAdminUsersQuerySchema,
  superAdminShowroomsQuerySchema,
} = require('./showroom.validation');

const GRANT_SCOPES = Object.freeze([SCOPES.SHOWROOM, SCOPES.GLOBAL]);
const RESERVED_PROFILE_NAMES = Object.freeze(['OWNER', 'STAFF', 'SUPER_ADMIN']);

// ── Shared grant-list rules ───────────────────────────────────
// Used by create/update profile schemas on `permissions`,
// `granted`, and `revoked` arrays. Fail closed: unknown key →
// reject; every grant must respect the platform/showroom scope
// boundary described in the header.
function assertGrantRules(entries, ctx, prefix) {
  const seen = new Set();
  (entries || []).forEach((g, idx) => {
    const pathBase = [prefix, idx];

    if (!isCatalogPermission(g.permission)) {
      ctx.addIssue({
        code:    z.ZodIssueCode.custom,
        path:    [...pathBase, 'permission'],
        message: `صلاحية غير معروفة: ${g.permission}`,
      });
    }

    if (isPlatformPermission(g.permission) && g.scope !== SCOPES.GLOBAL) {
      ctx.addIssue({
        code:    z.ZodIssueCode.custom,
        path:    [...pathBase, 'scope'],
        message: 'صلاحيات المنصة تُمنح بنطاق GLOBAL فقط',
      });
    }

    if (!isPlatformPermission(g.permission) && g.scope === SCOPES.GLOBAL) {
      ctx.addIssue({
        code:    z.ZodIssueCode.custom,
        path:    [...pathBase, 'scope'],
        message: 'صلاحيات المعارض تُمنح بنطاق SHOWROOM فقط',
      });
    }

    const sig = `${g.permission}@${g.scope}`;
    if (seen.has(sig)) {
      ctx.addIssue({
        code:    z.ZodIssueCode.custom,
        path:    [...pathBase],
        message: 'لا يمكن تكرار نفس الصلاحية بنفس النطاق',
      });
    }
    seen.add(sig);
  });
}

const profileNameSchema = z
  .string({ required_error: 'اسم الصلاحية مطلوب' })
  .trim()
  .regex(/^[A-Z_]{3,40}$/, 'الاسم يجب أن يكون 3-40 حرفاً إنجليزياً كبيراً أو شرطات سفلية')
  .refine((v) => !RESERVED_PROFILE_NAMES.includes(v), {
    message: 'هذا الاسم محجوز (OWNER / STAFF / SUPER_ADMIN)',
  });

const grantEntrySchema = z.object({
  permission: z.string({ required_error: 'permission مطلوب' }).min(1),
  scope:      z
    .enum(GRANT_SCOPES, {
      errorMap: () => ({ message: 'النطاق يجب أن يكون SHOWROOM أو GLOBAL' }),
    })
    .default(SCOPES.GLOBAL),
});

// ── POST /api/v1/admin/profiles ───────────────────────────────
const createProfileSchema = z
  .object({
    name:        profileNameSchema,
    description: z.string().max(250).trim().nullish(),
    scope:       z
      .enum(GRANT_SCOPES, {
        errorMap: () => ({ message: 'النطاق يجب أن يكون SHOWROOM أو GLOBAL' }),
      })
      .default(SCOPES.GLOBAL),
    permissions: z
      .array(grantEntrySchema, { required_error: 'permissions مطلوب' })
      .min(1, 'يجب تحديد صلاحية واحدة على الأقل'),
  })
  .superRefine((data, ctx) => assertGrantRules(data.permissions, ctx, 'permissions'));

// ── PATCH /api/v1/admin/profiles/:id ──────────────────────────
// Deltas only: granted / revoked carry { permission, scope }
// pairs; the scope/description metadata may change in the same
// request. At least one field must be present.
const updateProfileSchema = z
  .object({
    description: z.string().max(250).trim().nullish(),
    scope:       z
      .enum(GRANT_SCOPES, {
        errorMap: () => ({ message: 'النطاق يجب أن يكون SHOWROOM أو GLOBAL' }),
      })
      .optional(),
    granted: z.array(grantEntrySchema).optional(),
    revoked: z.array(grantEntrySchema).optional(),
  })
  .superRefine((data, ctx) => {
    assertGrantRules(data.granted, ctx, 'granted');
    assertGrantRules(data.revoked, ctx, 'revoked');
    if (
      data.description === undefined &&
      data.scope === undefined &&
      (data.granted === undefined || data.granted.length === 0) &&
      (data.revoked === undefined || data.revoked.length === 0)
    ) {
      ctx.addIssue({
        code:    z.ZodIssueCode.custom,
        path:    [],
        message: 'يجب توفير حقل واحد على الأقل للتحديث',
      });
    }
  });

// ── GET /api/v1/admin/profiles ────────────────────────────────
const profilesQuerySchema = z.object({
  page:   z.coerce.number().int().positive().optional().default(1),
  limit:  z.coerce.number().int().min(1).max(100).optional().default(20),
  search: z.string().trim().optional(),
});

// ── POST /api/v1/admin/administrators ─────────────────────────
const createAdministratorSchema = z.object({
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

  profile_id: z
    .string({ required_error: 'profile_id مطلوب' })
    .min(1),
});

// ── PATCH /api/v1/admin/administrators/:id ────────────────────
const updateAdministratorSchema = z
  .object({
    name:       z.string().min(2, 'الاسم يجب أن يكون حرفين على الأقل').max(100).trim().optional(),
    is_active:  z.boolean().optional(),
    profile_id: z.string().min(1).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'يجب توفير حقل واحد على الأقل للتحديث',
  });

// ── POST /api/v1/admin/administrators/:id/reset-password ──────
// new_password optional → server auto-generates one (same
// behavior as /superadmin/reset-user-password).
const adminResetPasswordSchema = z.object({
  new_password: z
    .string()
    .min(8, 'كلمة المرور المؤقتة يجب أن تكون 8 أحرف على الأقل')
    .max(128)
    .optional(),
});

// ── Shared params ─────────────────────────────────────────────
const idParamSchema = z.object({
  id: z.string({ required_error: 'id مطلوب' }).min(1),
});

module.exports = {
  createProfileSchema,
  updateProfileSchema,
  profilesQuerySchema,
  createAdministratorSchema,
  updateAdministratorSchema,
  adminResetPasswordSchema,
  idParamSchema,
  // Reused read-surface query schemas (platform reads)
  superAdminUsersQuerySchema,
  superAdminShowroomsQuerySchema,
};