// ============================================================
// YS-MATRIX ERP — Auth Controller (Phase 2 Stage 1)
// Changes vs original:
//   • All responses use unified response helpers with error codes
//   • Added ACCOUNT_DISABLED code on deactivated user
//   • changePassword validates newPassword ≠ currentPassword server-side
//   • register uses conflict() for duplicate email
//   • No backdoor, no plaintext — bcrypt only (already fixed in v1.2)
//   • All logic preserved — safe drop-in replacement
// ============================================================

'use strict';

const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { baseClient: db } = require('../config/database');
const prisma             = require('../config/database');
const { generateTokens, verifyRefreshToken, getRefreshTokenExpiry, hashRefreshToken } = require('../config/jwt');
const { validateProfileAssignment, effectiveAuthorization } = require('../services/authorization.service');
const lifecycleService = require('../services/subscription.lifecycle.service');
const response           = require('../utils/response');
const logger             = require('../config/logger');
const SECURITY           = require('../config/security');
const commercial         = require('../config/commercial');
const { auditLog }       = require('../middleware/audit.middleware');

// ─────────────────────────────────────────
// LOGIN
// ─────────────────────────────────────────
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return response.validationError(res, { email: 'مطلوب', password: 'مطلوب' }, 'البريد الإلكتروني وكلمة المرور مطلوبان.');
    }

    const cleanEmail = email.toLowerCase().trim();

    // Cross-tenant lookup — must use baseClient (no showroom_id filter)
    const user = await db.user.findUnique({
      where:   { email: cleanEmail },
      include: {
        showroom: {
          select: {
            id:             true,
            name:           true,
            slug:           true,
            is_active:      true,
            is_onboarded:   true,
            license_expiry: true,
          },
        },
      },
    });

    // Use same error message for "not found" and "wrong password"
    // to prevent user enumeration attacks
    if (!user) {
      // Phase 3 — audit failed logins. No identity exists to attach
      // this to, so it is recorded against the system showroom (the
      // platform-level convention for events without a tenant home).
      auditLog({
        showroomId: SECURITY.tenant.systemShowroomId,
        userId:     null,
        action:     'LOGIN_FAILED',
        entity:     'user',
        newData:    { email: cleanEmail, reason: 'INVALID_CREDENTIALS' },
        ipAddress:  req.ip,
        userAgent:  req.headers?.['user-agent'],
      });
      return response.unauthorized(res, 'البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'INVALID_CREDENTIALS');
    }

    // Phase C.4 (N-1): temporary lockout. While locked_until is in the
    // future, reject the login WITHOUT revealing that the account is
    // locked — the response stays the same generic INVALID_CREDENTIALS
    // an attacker gets for a wrong password or a non-existent email
    // (anti-enumeration). The fact of the lock is visible in the audit
    // trail (reason: ACCOUNT_LOCKED) so the owner can help a staff
    // member who locked themselves out. Rate limiting on the auth
    // endpoints still applies on top of this.
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      auditLog({
        showroomId: user.showroom_id,
        userId:     user.id,
        action:     'LOGIN_FAILED',
        entity:     'user',
        entityId:   user.id,
        newData:    { email: cleanEmail, reason: 'ACCOUNT_LOCKED' },
        ipAddress:  req.ip,
        userAgent:  req.headers?.['user-agent'],
      });
      return response.unauthorized(res, 'البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'INVALID_CREDENTIALS');
    }

    if (!user.is_active) {
      auditLog({
        showroomId: user.showroom_id,
        userId:     user.id,
        action:     'LOGIN_FAILED',
        entity:     'user',
        entityId:   user.id,
        newData:    { email: cleanEmail, reason: 'ACCOUNT_DISABLED' },
        ipAddress:  req.ip,
        userAgent:  req.headers?.['user-agent'],
      });
      return response.unauthorized(res, 'الحساب معطل. تواصل مع المسؤول.', 'ACCOUNT_DISABLED');
    }

    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      // Phase C.4 (N-1): wrong password — count the attempt and lock
      // the account once the threshold is crossed (DB-backed, survives
      // restarts). The counter is reset on the locking write so the
      // window grants a clean slate afterwards. The response and audit
      // shape stay exactly as before (generic message — no hint about
      // remaining attempts, which would help attackers calibrate).
      const nextAttempts = (user.failed_login_attempts || 0) + 1;
      const crossesThreshold = nextAttempts >= SECURITY.login.lockoutThreshold;
      await db.user.update({
        where: { id: user.id },
        data:  {
          failed_login_attempts: crossesThreshold ? 0 : nextAttempts,
          locked_until:          crossesThreshold
            ? new Date(Date.now() + SECURITY.login.lockoutWindowMs)
            : undefined,
        },
      });
      auditLog({
        showroomId: user.showroom_id,
        userId:     user.id,
        action:     'LOGIN_FAILED',
        entity:     'user',
        entityId:   user.id,
        newData:    { email: cleanEmail, reason: crossesThreshold ? 'ACCOUNT_LOCKED' : 'INVALID_CREDENTIALS' },
        ipAddress:  req.ip,
        userAgent:  req.headers?.['user-agent'],
      });
      return response.unauthorized(res, 'البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'INVALID_CREDENTIALS');
    }

    // Phase C.4 (N-1): successful login — clear any residual lockout
    // state (a stale counter from before the window expired).
    if (user.failed_login_attempts || user.locked_until) {
      await db.user.update({
        where: { id: user.id },
        data:  { failed_login_attempts: 0, locked_until: null },
      });
    }

    // License check (skip for SuperAdmin)
    // F1 (Customer Self-Service Completion): an EXPIRED license no
    // longer hard-blocks login. The session is issued EXPIRED-scoped —
    // the ERP business routes keep rejecting it per-request via
    // checkLicense/requireAccountActive (unchanged middleware, so ERP
    // access is NOT weakened), while the self-service surface
    // (/subscriptions/*, /auth/me) stays reachable so the owner can
    // renew. Deactivated showrooms remain hard-blocked below.
    if (user.role !== 'SUPER_ADMIN') {
      if (!user.showroom?.is_active) {
        return response.showroomInactive(res);
      }
    }

    const isLicenseExpired = user.role !== 'SUPER_ADMIN'
      && !!user.showroom
      && new Date() > new Date(user.showroom.license_expiry);

    // Generate tokens
    const tokenPayload = {
      userId:     user.id,
      showroomId: user.showroom_id,
      role:       user.role,
    };
    const { accessToken, refreshToken } = generateTokens(tokenPayload);

    // Store refresh token (Phase A P2-1: only the SHA-256 digest is
    // persisted — the raw token never touches the database).
    await db.refreshToken.create({
      data: {
        user_id:    user.id,
        token:      hashRefreshToken(refreshToken),
        expires_at: getRefreshTokenExpiry(),
      },
    });

    // Update last login (fire-and-forget)
    db.user.update({ where: { id: user.id }, data: { last_login: new Date() } }).catch(() => {});

    auditLog({
      showroomId: user.showroom_id,
      userId:     user.id,
      action:     'LOGIN',
      entity:     'user',
      entityId:   user.id,
      ipAddress:  req.ip,
      userAgent:  req.headers?.['user-agent'],
    });

    // F1: expired sessions are legitimate but scoped — the response
    // signals EXPIRED + SELF_SERVICE_ONLY so the client can route
    // straight to the billing/renewal surface. ERP stays blocked by
    // the license middleware on the business routes themselves.
    const daysExpired = isLicenseExpired
      ? Math.max(0, Math.floor((Date.now() - new Date(user.showroom.license_expiry).getTime()) / (1000 * 60 * 60 * 24)))
      : 0;

    return response.success(res, {
      user: {
        id:      user.id,
        name:    user.name,
        email:   user.email,
        role:    user.role,
        showroom: user.showroom ? {
          id:             user.showroom.id,
          name:           user.showroom.name,
          slug:           user.showroom.slug,
          is_onboarded:   user.showroom.is_onboarded,
          license_expiry: user.showroom.license_expiry,
        } : null,
      },
      account_status: isLicenseExpired ? 'EXPIRED' : undefined,
      access_scope:   isLicenseExpired ? 'SELF_SERVICE_ONLY' : undefined,
      days_expired:   isLicenseExpired ? daysExpired : undefined,
      accessToken,
      refreshToken,
    }, isLicenseExpired
      ? 'تم تسجيل الدخول. اشتراكك منتهٍ — يمكنك تجديده من صفحة الاشتراك.'
      : 'تم تسجيل الدخول بنجاح.');

  } catch (err) {
    logger.error('Login error:', err);
    return response.serverError(res, 'فشل تسجيل الدخول.');
  }
};

// ─────────────────────────────────────────
// REGISTER (Owner creates Staff)
// ─────────────────────────────────────────
const register = async (req, res) => {
  try {
    const { name, email, password, role = 'STAFF' } = req.body;
    const { showroomId, user: currentUser } = req;

    if (!['SUPER_ADMIN', 'OWNER'].includes(currentUser.role)) {
      return response.forbidden(res, 'فقط المالك يمكنه إنشاء مستخدمين.', 'INSUFFICIENT_ROLE');
    }

    if (role === 'OWNER' && currentUser.role !== 'SUPER_ADMIN') {
      return response.forbidden(res, 'فقط مدير النظام يمكنه إنشاء حساب مالك.', 'INSUFFICIENT_ROLE');
    }

    if (role === 'SUPER_ADMIN') {
      // Phase 1 — audit every attempt to create a protected authority
      auditLog({
        showroomId,
        userId:    currentUser.id,
        action:    'AUTHZ_ESCALATION_ATTEMPT',
        entity:    'user',
        newData:   {
          actor:            currentUser.email,
          requested_profile: role,
          reason:           'SUPER_ADMIN_IS_PROTECTED',
        },
        ipAddress: req.ip,
      });
      return response.forbidden(res, 'لا يمكن إنشاء حساب مدير نظام من هذا المسار.', 'FORBIDDEN_ROLE');
    }

    // Phase 1 — centralized assignment validation (no privilege
    // amplification): granted_permissions ⊆ creator_permissions AND
    // granted_scope ⊆ creator_scope, verified server-side before the
    // mutation. (OWNER → STAFF is the legacy path today; this is the
    // future-proofed gate for any delegated admin.)
    const assignment = await validateProfileAssignment(currentUser, role);
    if (!assignment.allowed) {
      auditLog({
        showroomId,
        userId:    currentUser.id,
        action:    'AUTHZ_ESCALATION_ATTEMPT',
        entity:    'user',
        newData:   {
          actor:             currentUser.email,
          requested_profile: role,
          reason:            assignment.reason,
        },
        ipAddress: req.ip,
      });
      return response.forbidden(res, 'صلاحياتك غير كافية لإنشاء هذا الحساب.', 'INSUFFICIENT_ROLE');
    }

    // Phase 4 — plan user-limit enforcement: applied at user:create.
    // Active subscription's users_limit snapshot is the authority;
    // legacy rows/no-limit plans pass through unrestricted.
    try {
      await lifecycleService.enforceUserLimit({ showroomId });
    } catch (err) {
      if (err.code === 'PLAN_LIMIT_REACHED') return response.forbidden(res, err.message, 'PLAN_LIMIT_REACHED');
      throw err;
    }

    // Email uniqueness — cross-tenant check
    const existing = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      return response.conflict(res, 'البريد الإلكتروني مسجل مسبقاً.', 'EMAIL_EXISTS');
    }

    const password_hash = await bcrypt.hash(password, SECURITY.password.bcryptRounds);

    const newUser = await prisma.user.create({
      data: {
        showroom_id:   showroomId,
        name,
        email:         email.toLowerCase().trim(),
        password_hash,
        role,
      },
      select: {
        id:         true,
        name:       true,
        email:      true,
        role:       true,
        is_active:  true,
        created_at: true,
      },
    });

    auditLog({
      showroomId,
      userId:    currentUser.id,
      action:    'CREATE_USER',
      entity:    'user',
      entityId:  newUser.id,
      newData:   { name, email, role },
      ipAddress: req.ip,
    });

    return response.created(res, newUser, 'تم إنشاء المستخدم بنجاح.');

  } catch (err) {
    logger.error('Register error:', err);
    return response.serverError(res, 'فشل إنشاء المستخدم.');
  }
};

// ─────────────────────────────────────────
// REGISTER ACCOUNT (Phase 4 — public self-registration)
// POST /api/v1/auth/register-account — NO auth required.
//
// Creates the full tenant bootstrap atomically:
//   • Showroom (is_active=true, is_onboarded=false, license_expiry =
//     trial end) — trial is EXACTLY 5 days (TRIAL_DAYS in
//     config/commercial.js; approved commercial model), expiration is
//     enforced by the EXISTING license middleware (checks
//     showroom.license_expiry), no new enforcement code.
//   • OWNER user (is_active=true) — role is FIXED at OWNER; the body
//     schema is strict() so no other role can be smuggled in.
//   • TRIAL subscription row (status TRIAL, 5 days) — this is the
//     "NewRelation(trial)" claim the SUBSCRIPTION_EXPIRED cron flips,
//     and what makes the account's derived legal status upgrade-time
//     single-fire (mirrors license_warning_sent_days semantics for
//     claims).
//
// Phase 4 account status for this account: derived ACTIVE while the
// trial has time left (trial grants full access — license checks pass
// via license_expiry), EXPIRED after trial end (license middleware
// blocks → purchase surface answers). The account is NEVER
// hard-blocked from the self-service surface: a trial user must be
// able to reach /subscriptions/plans + /subscriptions/request.
//
// This is NOT an OTP-gated endpoint yet — the registration stands as
// the placement point for the future OTP gate (comment marker for
// the Phase 4 P1 write-up).
// ─────────────────────────────────────────
const registerAccount = async (req, res) => {
  try {
    const { name, email, password, showroom_name, phone } = req.body;

    const cleanEmail  = email.toLowerCase().trim();
    const displayName = (showroom_name || name).trim();
    const existing    = await db.user.findUnique({ where: { email: cleanEmail } });
    if (existing) {
      return response.conflict(res, 'البريد الإلكتروني مسجل مسبقاً.', 'EMAIL_EXISTS');
    }

    const password_hash = await bcrypt.hash(password, SECURITY.password.bcryptRounds);

    // Trial period: EXACTLY 5 days from registration (approved
    // commercial model — single authoritative value in
    // config/commercial.js). Access during the trial is governed
    // ENTIRELY by the existing license middleware
    // (showroom.license_expiry) — "trial expiration handled by
    // existing license check". The subscription row below only
    // records the claim for the lifecycle dashboard + expiry cron.
    // Phase C.7: no frontend value, no extension — the public
    // /subscriptions/pricing endpoint only DISPLAYS this count.
    const TRIAL_DAYS = commercial.TRIAL_DAYS;
    const trialEnd   = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);

    // Unique slug: slugify the showroom name + short random suffix
    // (public flow — no collision round-trips).
    const slugBase = (displayName
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'showroom');
    const slug = `${slugBase}-${crypto.randomBytes(3).toString('hex')}`;

    // TENANT NOTE: this runs on baseClient (db) — the fail-closed
    // scoped client would throw TenantContextError here, because a
    // public registration has no showroom context by definition, and
    // the tenant id cannot exist before the showroom row exists.
    // Same documented bootstrap pattern as createShowroom's
    // db.$transaction. Every row carries its showroom_id EXPLICITLY
    // (user + subscription are scoped models; Showroom/AuditLog are
    // global). Atomic: a failure rolls back the whole bootstrap.
    let created;
    try {
      created = await db.$transaction(async (tx) => {
        const showroom = await tx.showroom.create({
          data: {
            name:           displayName,
            slug,
            phone:          phone      || null,
            email:          cleanEmail,
            license_expiry: trialEnd,
            is_active:      true,
            is_onboarded:   false,
          },
        });

        const user = await tx.user.create({
          data: {
            showroom_id:   showroom.id,
            name,
            email:         cleanEmail,
            password_hash,
            role:          'OWNER',
            is_active:     true,
          },
          select: {
            id: true, name: true, email: true, role: true, is_active: true, created_at: true,
          },
        });

        // Trial claim — flipped TRIAL → EXPIRED by the same
        // SUBSCRIPTION_EXPIRED cron that flips ACTIVE claims.
        const subscription = await tx.subscription.create({
          data: {
            showroom_id:      showroom.id,
            plan_name:        'TRIAL',
            status:           'TRIAL',
            started_at:       new Date(),
            expires_at:       trialEnd,
            duration_months:  0,
            renewed_by:       user.id,
            notes:            `تجربة مدتها ${TRIAL_DAYS} أيام من تاريخ إنشاء الحساب`,
          },
        });

        return { showroom, user, subscription };
      });
    } catch (err) {
      // P2002 = unique violation: slug collision (email was
      // pre-checked above). Race on the same email is a genuine
      // duplicate registration — report it honestly rather than
      // retrying with the same conflicting email.
      if (err?.code === 'P2002') {
        return response.conflict(res, 'تعذر إنشاء الحساب (تعارض في المعرفات). حاول مرة أخرى.', 'IDENTITY_CONFLICT');
      }
      throw err;
    }

    auditLog({
      showroomId: created.showroom.id,
      userId:     null, // no session yet — system-attributed like LOGIN_FAILED
      action:     'ACCOUNT_REGISTERED',
      entity:     'showroom',
      entityId:   created.showroom.id,
      newData:    { email: cleanEmail, showroom: displayName, trial_expires: trialEnd.toISOString() },
      ipAddress:  req.ip,
      userAgent:  req.headers?.['user-agent'],
    });

    return response.created(res, {
      showroom:      { id: created.showroom.id, name: created.showroom.name, slug: created.showroom.slug },
      owner:         { id: created.user.id, name: created.user.name, email: created.user.email },
      trial:         { expires_at: trialEnd, days: TRIAL_DAYS },
      account_status: 'PENDING', // trial claim → pick a plan to activate
    }, `تم إنشاء حسابك بنجاح مع فترة تجريبية مدتها ${TRIAL_DAYS} أيام. اختر باقة اشتراك من صفحة الاشتراك لتفعيل الوصول الكامل.`);
  } catch (err) {
    logger.error('registerAccount error:', err);
    return response.serverError(res, 'فشل إنشاء الحساب. حاول مرة أخرى.');
  }
};

// ─────────────────────────────────────────
// REFRESH TOKEN
// ─────────────────────────────────────────
const refreshToken = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    if (!token) {
      return response.unauthorized(res, 'Refresh token مطلوب.', 'REFRESH_TOKEN_MISSING');
    }

    let decoded;
    try {
      decoded = verifyRefreshToken(token);
    } catch {
      return response.unauthorized(res, 'Refresh token غير صالح أو منتهي الصلاحية.', 'REFRESH_TOKEN_INVALID');
    }

    // Phase A (P2-1): DB lookups are by the hash of the presented
    // token — matching the digest that was stored at issuance.
    const tokenHash = hashRefreshToken(token);
    const storedToken = await db.refreshToken.findUnique({ where: { token: tokenHash } });
    if (!storedToken) {
      return response.unauthorized(res, 'Refresh token غير موجود.', 'REFRESH_TOKEN_NOT_FOUND');
    }

    if (new Date() > storedToken.expires_at) {
      await db.refreshToken.delete({ where: { token: tokenHash } }).catch(() => {});
      return response.unauthorized(res, 'Refresh token منتهي الصلاحية.', 'REFRESH_TOKEN_EXPIRED');
    }

    const user = await db.user.findUnique({
      where:  { id: decoded.userId },
      select: {
        id:          true,
        showroom_id: true,
        role:        true,
        is_active:   true,
        showroom: {
          select: { is_active: true, license_expiry: true },
        },
      },
    });

    if (!user || !user.is_active) {
      return response.unauthorized(res, 'الحساب غير موجود أو معطل.', 'USER_NOT_FOUND');
    }

    // Matrix Audit (P2 — Refresh Token Doesn't Check Showroom Status):
    // login() above already blocks deactivated/expired showrooms, but
    // this endpoint previously skipped that check entirely — a user
    // from a deactivated or license-expired showroom could keep
    // refreshing their session for up to REFRESH_TOKEN_EXPIRY (7 days)
    // after the showroom itself was shut down, bypassing license
    // enforcement on every route that only checks the access token's
    // claims rather than re-querying showroom status. Same check,
    // same SUPER_ADMIN exemption as login() (SuperAdmin's showroom_id
    // points at the system placeholder, not a real tenant).
    //
    // F1 (Customer Self-Service Completion): the license-expired branch
    // is deliberately RELAXED — an expired showroom's session must stay
    // alive for the self-service recovery surface (renewal request,
    // payment proof, status). ERP access remains blocked per-request
    // by checkLicense/requireAccountActive on the business routes, so
    // relaxing refresh here grants no ERP access. Deactivated
    // showrooms are STILL hard-blocked below.
    //
    // The stored refresh token is deleted on rejection (not just left
    // alone) — fully revoking the session, so reactivating the
    // showroom later doesn't silently let a stale token resume working;
    // the user must log in again, which re-runs every check from zero.
    if (user.role !== 'SUPER_ADMIN') {
      if (!user.showroom?.is_active) {
        await db.refreshToken.delete({ where: { token: tokenHash } }).catch(() => {});
        return response.showroomInactive(res);
      }
    }

    const isLicenseExpired = user.role !== 'SUPER_ADMIN'
      && !!user.showroom
      && new Date() > new Date(user.showroom.license_expiry);

    // Rotate refresh token (one-time use).
    //
    // F-15 FIX: previously this was delete-then-create as two
    // SEPARATE, unguarded statements. If the delete succeeded but the
    // create then failed (transient DB hiccup, connection drop), the
    // user was left with ZERO valid refresh tokens — a self-inflicted
    // DoS forcing a full re-login, for a failure that had nothing to
    // do with their credentials. Wrapping both in one $transaction
    // makes it atomic: either the old token is gone AND the new one
    // exists, or NEITHER change applies and the old token remains
    // valid exactly as before this request started.
    //
    // Bonus effect: if the same refresh token is replayed
    // concurrently (two requests racing on one token — either a
    // genuine double-tab edge case or an actual token-theft replay
    // attempt), the SECOND request's delete now fails cleanly inside
    // its own transaction (the row is already gone) and the whole
    // transaction rolls back — that request gets a clean error
    // instead of silently minting a second valid session from a
    // token that should only be usable once.
    const tokenPayload = { userId: user.id, showroomId: user.showroom_id, role: user.role };
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(tokenPayload);

    try {
      await db.$transaction([
        db.refreshToken.delete({ where: { token: tokenHash } }),
        db.refreshToken.create({
          data: {
            user_id:    user.id,
            token:      hashRefreshToken(newRefreshToken),
            expires_at: getRefreshTokenExpiry(),
          },
        }),
      ]);
    } catch (err) {
      // Phase 3 (P3-B): when the SAME token is replayed concurrently,
      // the losing request's delete finds no row (P2025) and the whole
      // transaction rolls back. That must surface as a clean 401 — the
      // token is a consumed single-use credential, not a server fault —
      // instead of the generic 500 the outer catch used to produce
      // (which polluted logs and hid the real story).
      if (err.code === 'P2025') {
        return response.unauthorized(
          res,
          'Refresh token تم استخدامه من قبل. يرجى تسجيل الدخول مرة أخرى.',
          'REFRESH_TOKEN_REUSED'
        );
      }
      throw err;
    }

    return response.success(res, {
      accessToken,
      refreshToken: newRefreshToken,
      account_status: isLicenseExpired ? 'EXPIRED' : undefined,
      access_scope:   isLicenseExpired ? 'SELF_SERVICE_ONLY' : undefined,
    }, 'تم تجديد الجلسة بنجاح.');

  } catch (err) {
    logger.error('Refresh token error:', err);
    return response.serverError(res, 'فشل تجديد الجلسة.');
  }
};

// ─────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────
const logout = async (req, res) => {
  try {
    const { refreshToken: token } = req.body;

    if (token) {
      await db.refreshToken.deleteMany({ where: { token: hashRefreshToken(token) } }).catch(() => {});
    }

    auditLog({
      showroomId: req.showroomId,
      userId:     req.user?.id,
      action:     'LOGOUT',
      entity:     'user',
      entityId:   req.user?.id,
      ipAddress:  req.ip,
    });

    return response.success(res, null, 'تم تسجيل الخروج بنجاح.');

  } catch (err) {
    logger.error('Logout error:', err);
    return response.serverError(res, 'فشل تسجيل الخروج.');
  }
};

// ─────────────────────────────────────────
// GET CURRENT USER (me)
// ─────────────────────────────────────────
const getMe = async (req, res) => {
  try {
    const user = await db.user.findUnique({
      where:  { id: req.user.id },
      select: {
        id:         true,
        name:       true,
        email:      true,
        role:       true,
        profile_id: true,
        avatar_url: true,
        last_login: true,
        created_at: true,
        showroom: {
          select: {
            id:             true,
            name:           true,
            slug:           true,
            logo_url:       true,
            is_onboarded:   true,
            license_expiry: true,
            is_active:      true,
          },
        },
      },
    });

    if (!user) {
      return response.notFound(res, 'المستخدم غير موجود.');
    }

    // Phase 1 — effective authorization contract for the frontend
    // (UI behavior only — the backend remains authoritative; this
    // list is NEVER used as a security boundary).
    //   authorization = {
    //     profile:     'OWNER' | 'STAFF' | 'SUPER_ADMIN',
    //     scope:       'SHOWROOM' | 'GLOBAL',
    //     permissions: [{ permission: 'resource:action', scope: 'SHOWROOM'|'SELF' }]
    //   }
    // SUPER_ADMIN resolves as the protected system authority:
    // scope GLOBAL, EMPTY permission list — the frontend keys off
    // profile === 'SUPER_ADMIN', matching the legacy UI contract.
    // Resolution failures fail closed (empty list).
    const authorization = await effectiveAuthorization(user);

    return response.success(res, {
      ...user,
      authorization: authorization
        ? {
            profile:     authorization.profile,
            scope:       authorization.scope,
            permissions: authorization.permissions,
          }
        : null,
    });

  } catch (err) {
    logger.error('Get me error:', err);
    return response.serverError(res, 'فشل جلب بيانات المستخدم.');
  }
};

// ─────────────────────────────────────────
// CHANGE PASSWORD
// ─────────────────────────────────────────
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await db.user.findUnique({ where: { id: req.user.id } });
    if (!user) return response.notFound(res, 'المستخدم غير موجود.');

    const isValid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isValid) {
      return response.unauthorized(res, 'كلمة المرور الحالية غير صحيحة.', 'WRONG_PASSWORD');
    }

    if (newPassword.length < SECURITY.password.minLength) {
      return response.validationError(res, {
        newPassword: `يجب أن تكون كلمة المرور ${SECURITY.password.minLength} أحرف على الأقل.`,
      });
    }

    if (newPassword.length > SECURITY.password.maxLength) {
      return response.validationError(res, {
        newPassword: `كلمة المرور طويلة جداً.`,
      });
    }

    // Prevent reusing the same password
    const isSame = await bcrypt.compare(newPassword, user.password_hash);
    if (isSame) {
      return response.validationError(res, {
        newPassword: 'كلمة المرور الجديدة يجب أن تختلف عن الحالية.',
      });
    }

    const newHash = await bcrypt.hash(newPassword, SECURITY.password.bcryptRounds);

    // Phase C.4 (N-1): changing your own password clears lockout state
    // (the user has proven the current password, so any lock from
    // earlier wrong attempts is moot).
    await db.user.update({
      where: { id: req.user.id },
      data:  { password_hash: newHash, failed_login_attempts: 0, locked_until: null },
    });

    // Revoke all refresh tokens (force re-login on other devices)
    await db.refreshToken.deleteMany({ where: { user_id: req.user.id } });

    auditLog({
      showroomId: req.showroomId,
      userId:     req.user.id,
      action:     'CHANGE_PASSWORD',
      entity:     'user',
      entityId:   req.user.id,
      ipAddress:  req.ip,
    });

    return response.success(res, null, 'تم تغيير كلمة المرور بنجاح. يرجى تسجيل الدخول مجدداً على الأجهزة الأخرى.');

  } catch (err) {
    logger.error('Change password error:', err);
    return response.serverError(res, 'فشل تغيير كلمة المرور.');
  }
};

// ─────────────────────────────────────────
// UPDATE PROFILE (self-service)
//
// PATCH /api/v1/auth/me — any authenticated user (SUPER_ADMIN,
// OWNER, or STAFF) updates their OWN name/avatar_url. Deliberately
// the narrowest possible surface: destructures ONLY these two keys
// from req.body — never spreads req.body into the Prisma update,
// regardless of what updateProfileSchema's .strict() already
// rejected upstream. Two independent layers, not one relied on
// twice.
// ─────────────────────────────────────────
const updateProfile = async (req, res) => {
  try {
    const { name, avatar_url } = req.body;

    const dataToUpdate = {};
    if (name !== undefined)       dataToUpdate.name       = name;
    if (avatar_url !== undefined) dataToUpdate.avatar_url = avatar_url;

    // updateProfileSchema's .refine() already guarantees at least one
    // key was sent, but this defends independently against that
    // guarantee ever being loosened later without this file being
    // touched — fail loud instead of issuing a meaningless UPDATE.
    if (Object.keys(dataToUpdate).length === 0) {
      return response.validationError(res, null, 'لا توجد بيانات لتحديثها.');
    }

    const updated = await db.user.update({
      where:  { id: req.user.id },
      data:   dataToUpdate,
      select: {
        id:         true,
        name:       true,
        email:      true,
        role:       true,
        avatar_url: true,
        last_login: true,
        created_at: true,
      },
    });

    auditLog({
      showroomId: req.showroomId,
      userId:     req.user.id,
      action:     'UPDATE_PROFILE',
      entity:     'user',
      entityId:   req.user.id,
      newData:    dataToUpdate,
      ipAddress:  req.ip,
    });

    return response.success(res, updated, 'تم تحديث الملف الشخصي بنجاح.');

  } catch (err) {
    logger.error('Update profile error:', err);
    return response.serverError(res, 'فشل تحديث الملف الشخصي.');
  }
};

// ─────────────────────────────────────────
// RESET PASSWORD WITH TOKEN (public — from the emailed link)
//
// Matrix Audit — Phase 1. Distinct from superadmin.controller.js's
// resetUserPassword (which is SuperAdmin manually resetting someone
// ELSE's password via the admin panel, no token involved). This is
// the self-service path: the user clicks the link from
// forgotPasswordRequest's email and sets their own new password.
// ─────────────────────────────────────────
const resetPasswordWithToken = async (req, res) => {
  try {
    const { token, newPassword } = req.body;

    // Hash the INCOMING token the same way it was hashed at creation
    // time (superadmin.controller.js's forgotPasswordRequest), then
    // look up by hash — the raw token is never stored, so this is the
    // only way to find the matching row. See PasswordResetToken in
    // schema.prisma for the full reasoning.
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const resetRow = await db.passwordResetToken.findUnique({
      where: { token_hash: tokenHash },
    });

    if (!resetRow || resetRow.used_at || resetRow.expires_at < new Date()) {
      return response.unauthorized(
        res,
        'رابط إعادة التعيين غير صالح أو منتهي الصلاحية. يرجى طلب رابط جديد.',
        'RESET_TOKEN_INVALID'
      );
    }

    const user = await db.user.findUnique({ where: { id: resetRow.user_id } });
    if (!user || !user.is_active) {
      return response.unauthorized(res, 'الحساب غير موجود أو معطل.', 'USER_NOT_FOUND');
    }

    const newHash = await bcrypt.hash(newPassword, SECURITY.password.bcryptRounds);

    // All three together, atomically: update the password, burn the
    // token (one-time use — can't be replayed even within its TTL),
    // and revoke every existing session exactly like changePassword()
    // does above. If any one of these failed silently while the
    // others succeeded, that's the exact kind of half-applied state
    // this system has been built all session to avoid.
    //
    // Phase C.4 (N-1): the reset also clears any login-lockout state —
    // the user has just proven possession of the emailed token, so a
    // lock from forgotten-password attempts must not strand them.
    await db.$transaction([
      db.user.update({
        where: { id: user.id },
        data:  { password_hash: newHash, failed_login_attempts: 0, locked_until: null },
      }),
      db.refreshToken.deleteMany({ where: { user_id: user.id } }),
      db.passwordResetToken.update({ where: { id: resetRow.id }, data: { used_at: new Date() } }),
    ]);

    auditLog({
      showroomId: user.showroom_id,
      userId:     user.id,
      action:     'PASSWORD_RESET_COMPLETED',
      entity:     'user',
      entityId:   user.id,
      ipAddress:  req.ip,
    });

    return response.success(
      res,
      null,
      'تم تغيير كلمة المرور بنجاح. يمكنك تسجيل الدخول الآن بكلمة المرور الجديدة.'
    );
  } catch (err) {
    logger.error('Reset password with token error:', err);
    return response.serverError(res, 'فشل إعادة تعيين كلمة المرور.');
  }
};

module.exports = { login, register, registerAccount, refreshToken, logout, getMe, changePassword, updateProfile, resetPasswordWithToken };
