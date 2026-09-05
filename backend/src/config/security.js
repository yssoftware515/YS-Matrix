// ============================================================
// YS-MATRIX ERP — Security Configuration
// Phase 2 Stage 1 — Centralized Security Constants
// ============================================================

'use strict';

/**
 * Centralized security settings.
 * All security-sensitive values live HERE — never scattered across files.
 * Change from env vars; never hardcode production values.
 */

const SECURITY = {

  // ── JWT ──────────────────────────────────────────────────
  jwt: {
    accessExpiresIn:  process.env.JWT_ACCESS_EXPIRES  || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',
  },

  // ── Password ─────────────────────────────────────────────
  password: {
    bcryptRounds:   parseInt(process.env.BCRYPT_ROUNDS || '12', 10),
    minLength:      8,
    maxLength:      128,
  },

  // ── Login Lockout (Phase C.4 — N-1) ──────────────────────
  // DB-backed (users.failed_login_attempts / users.locked_until), so
  // the lock survives restarts — unlike a process-memory counter.
  // Deliberately NOT env-gated per-deployment: 5 attempts / 15 min is
  // the product default and the integration tests assert it; tune only
  // with full awareness of the trade-off (lower = more lockouts for
  // the showroom's shared-NAT staff, higher = weaker brute-force
  // protection). The user-facing response stays the generic
  // INVALID_CREDENTIALS message even while locked (anti-enumeration);
  // the ACCOUNT_LOCKED reason is visible only in the audit trail.
  login: {
    lockoutThreshold: 5,
    lockoutWindowMs:  15 * 60 * 1000, // 15 minutes
  },

  // ── Rate Limits ──────────────────────────────────────────
  rateLimit: {
    // Global: 300 req / 15 min (Phase C.3 — was 100/15min).
    // Raised so a showroom's staff behind a shared office/NAT IP is not
    // throttled as a single user; the per-endpoint guards below (auth,
    // sensitive ops, superadmin, forgot password) remain untouched and
    // still protect the high-risk flows. Kept env-tunable.
    global: {
      windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10),
      max:      parseInt(process.env.RATE_LIMIT_MAX       || '300',    10),
    },
    // Login: 5 req / 15 min (TASK-003: brute-force protection).
    // Env-tunable via RATE_LIMIT_AUTH_MAX for test ceiling override.
    auth: {
      windowMs: 15 * 60 * 1000,
      max:      parseInt(process.env.RATE_LIMIT_AUTH_MAX || '5', 10),
    },
    // Register: 3 req / 1 hour (TASK-003: account creation abuse prevention).
    // Env-tunable via RATE_LIMIT_REGISTER_MAX for test ceiling override.
    register: {
      windowMs: 60 * 60 * 1000,
      max:      parseInt(process.env.RATE_LIMIT_REGISTER_MAX || '3', 10),
    },
    // Sensitive ops (SuperAdmin: password reset, create user, impersonate): 10 req / 15 min.
    // Authenticated SuperAdmin operations warrant a higher threshold than
    // anonymous flows (see forgotPassword below) — the actor's identity
    // is already verified via JWT before this limiter is hit.
    sensitive: {
      windowMs: 15 * 60 * 1000,
      max:      parseInt(process.env.RATE_LIMIT_SENSITIVE_MAX || '10', 10),
    },
    // SuperAdmin operations: 30 req / 15 min
    superAdmin: {
      windowMs: 15 * 60 * 1000,
      max:      parseInt(process.env.RATE_LIMIT_SUPERADMIN_MAX || '30', 10),
    },
    // Forgot password: 3 req / 1 hour (TASK-003: prevent email enumeration).
    // Env-tunable for the test env (RATE_LIMIT_FORGOT_MAX) exactly like
    // the other limiters — the production default stays 3; the
    // dedicated rateLimit integration suite proves the enforcement
    // mechanics against the raised ceiling.
    forgotPassword: {
      windowMs: 60 * 60 * 1000,
      max:      parseInt(process.env.RATE_LIMIT_FORGOT_MAX || '3', 10),
    },
    // Refresh token: 30 req / 15 min (TASK-003: limit token replay window).
    refresh: {
      windowMs: 15 * 60 * 1000,
      max:      parseInt(process.env.RATE_LIMIT_REFRESH_MAX || '30', 10),
    },
    // MFA TOTP verification: 5 req / 15 min (Batch 5 — P0-A).
    // Tighter than sensitive ops because a 6-digit code is
    // brute-forceable without a rate limit. Applied to both
    // /mfa/verify (login flow) and /mfa/confirm-enrollment.
    mfaVerify: {
      windowMs: 15 * 60 * 1000,
      max:      parseInt(process.env.RATE_LIMIT_MFA_VERIFY_MAX || '5', 10),
    },
  },

  // ── CORS ─────────────────────────────────────────────────
  cors: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(','),
    credentials:    true,
  },

  // ── License & Subscription lifecycle ───────────────────────
  license: {
    // Warn X days before expiry
    warningDaysThreshold: 7,
  },

  // ── Payments (Phase 4 — manual proof uploads) ──────────────
  // Server-side authority: amount is always derived from the plan
  // server-side; the upload is validated by mime allowlist + magic
  // bytes + byte cap. proof_data is base64 in the JSON body (initial
  // no-object-storage deployment — Vercel fs is read-only); never
  // executed, never served as HTML, access-locked to the owning
  // showroom and GLOBAL admins only.
  payment: {
    // Manual-transfer instructions surfaced to the customer in the
    // billing UI (GET /subscriptions/status). Display copy only —
    // amounts/plans are never client-settable. Bank details should be
    // filled in per deployment; leave empty to show generic steps.
    manualInstructions: {
      headline: 'التحويل البنكي اليدوي',
      steps: [
        'اختر الباقة المناسبة واطلب الاشتراك من صفحة الفوترة.',
        'حوّل قيمة الباقة كما تظهر في طلبك عبر أي وسيلة تحويل متاحة.',
        'احتفظ برقم العملية (Reference) واكتبه في حقل رقم العملية.',
        'ارفع صورة إثبات التحويل (PNG / JPG / WebP حتى 2 م.ب).',
        'سيراجع فريق الإدارة الدفع ويُفعّل اشتراكك خلال 24 ساعة.',
        'ستصلك إشعارات داخل النظام بكل تحديث لحالة طلبك.',
      ],
      bankAccount: process.env.PAYMENT_BANK_ACCOUNT || null, // e.g. 'IBAN ...' per deployment
    },
    proof: {
      maxBytes:         2 * 1024 * 1024, // 2 MB raw image
      allowedMimes:     ['image/png', 'image/jpeg', 'image/webp'],
      // Signature sniffing: reject anything whose magic bytes do not
      // match the declared mime (defeats extension/content-type spoofing).
      magicSniff: {
        'image/png':  [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
        'image/jpeg': [0xFF, 0xD8, 0xFF],
        'image/webp': [0x52, 0x49, 0x46, 0x46], // RIFF....WEBP (bytes 8-11 checked separately)
      },
    },
  },

  // ── Tenant ───────────────────────────────────────────────
  tenant: {
    // System showroom used by SUPER_ADMIN — never exposed to regular tenants
    systemShowroomId: process.env.SYSTEM_SHOWROOM_ID || 'system-showroom-001',
  },

  // ── Request Body ─────────────────────────────────────────
  body: {
    limit: '10mb',
  },

};

module.exports = SECURITY;
