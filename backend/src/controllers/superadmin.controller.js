// ============================================================
// YS-MATRIX ERP - SuperAdmin Controller (v1.2 — User Management)
// Author: Yahya Al-Sulami 🦅
// Fixes:
//   - Added: getAllUsers, getUserById, updateUser, deactivateUser
//   - Fixed: auditLog showroomId in resetUserPassword now uses
//     targetUser.showroom_id instead of req.showroomId
// ============================================================

const bcrypt   = require('bcryptjs');
const crypto   = require('crypto');
const SECURITY = require('../config/security');
// SECURITY FIX: this controller is exclusively cross-tenant by
// design — every function here operates across ALL showrooms, not
// one tenant's data. superadmin.routes.js deliberately skips
// tenantGuard for SUPER_ADMIN requests (see the routes file), so
// tenantStorage context is NEVER populated when these functions run.
//
// Previously this imported the tenant-SCOPED `prisma` client. That
// worked by accident as long as 'user' was in GLOBAL_MODELS — but
// 'user' was deliberately removed from GLOBAL_MODELS in a separate
// fix (to stop user queries from silently leaking across tenants
// when accidentally run with no context). The side effect: every
// user-model query in this file started throwing TenantContextError,
// because findMany/findUnique/update on a scoped model with no
// showroomId in context is fail-closed by design (see config/database.js).
//
// The correct fix is here, not in database.js: this file should
// never have used the scoped client to begin with. baseClient is
// the same pattern already used correctly in superadmin.analytics.js.
const { baseClient: db } = require('../config/database');
const { generateImpersonationToken } = require('../config/jwt');
const { validateProfileAssignment } = require('../services/authorization.service');
const lifecycleService = require('../services/subscription.lifecycle.service');
const response = require('../utils/response');
const logger   = require('../config/logger');
const { auditLog } = require('../middleware/audit.middleware');
const { getPagination, buildPaginationMeta } = require('../utils/pagination');
const emailService = require('../services/email.service');

// Matrix Audit — Phase 1 (Password Reset Flow)
const RESET_TOKEN_BYTES  = 32;          // 256 bits — computationally infeasible to guess
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─────────────────────────────────────────────────────────────
// Helper: generate a secure temporary password
// ─────────────────────────────────────────────────────────────
const generateTempPassword = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const rand  = crypto.randomBytes(12);
  let pwd = 'Ys-';
  for (let i = 0; i < 6; i++) pwd += chars[rand[i] % chars.length];
  pwd += '-';
  for (let i = 6; i < 8; i++) pwd += chars[rand[i] % chars.length];
  return pwd;
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/superadmin/users
//
// Returns ALL users across ALL showrooms with pagination,
// search, role filter, and showroom filter.
// SuperAdmin eyes only.
// ─────────────────────────────────────────────────────────────
const getAllUsers = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const { search, role, showroom_id, is_active } = req.query;

    const where = {};

    if (search) {
      where.OR = [
        { name:  { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (role) where.role = role;
    if (showroom_id) where.showroom_id = showroom_id;
    if (is_active !== undefined) where.is_active = is_active === 'true';

    const [users, total] = await Promise.all([
      db.user.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { created_at: 'desc' },
        select: {
          id:          true,
          name:        true,
          email:       true,
          role:        true,
          is_active:   true,
          avatar_url:  true,
          last_login:  true,
          created_at:  true,
          showroom: {
            select: {
              id:           true,
              name:         true,
              slug:         true,
              is_active:    true,
              license_expiry: true,
            },
          },
        },
      }),
      db.user.count({ where }),
    ]);

    return response.paginated(
      res,
      users,
      buildPaginationMeta(total, page, limit)
    );
  } catch (err) {
    logger.error('Get all users error:', err);
    return response.error(res, 'Failed to fetch users');
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/superadmin/users/:id
// ─────────────────────────────────────────────────────────────
const getUserById = async (req, res) => {
  try {
    const user = await db.user.findUnique({
      where: { id: req.params.id },
      select: {
        id:         true,
        name:       true,
        email:      true,
        role:       true,
        is_active:  true,
        avatar_url: true,
        last_login: true,
        created_at: true,
        updated_at: true,
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
        _count: { select: { sales: true } },
      },
    });

    if (!user) return response.notFound(res, 'User not found');
    return response.success(res, user);
  } catch (err) {
    logger.error('Get user error:', err);
    return response.error(res, 'Failed to fetch user');
  }
};

// ─────────────────────────────────────────────────────────────
// PATCH /api/v1/superadmin/users/:id
//
// SuperAdmin can update: name, role, is_active.
// Email changes are not allowed (unique key, breaks auth history).
// ─────────────────────────────────────────────────────────────
const updateUser = async (req, res) => {
  try {
    const { name, role, is_active } = req.body;
    const { id } = req.params;

    const target = await db.user.findUnique({
      where: { id },
      select: { id: true, name: true, role: true, is_active: true, showroom_id: true, email: true },
    });

    if (!target) return response.notFound(res, 'User not found');

    // Cannot demote or edit another SuperAdmin
    if (target.role === 'SUPER_ADMIN' && target.id !== req.user.id) {
      // Phase 1 — audit every attempted modification of a SUPER_ADMIN
      auditLog({
        showroomId: target.showroom_id,
        userId:     req.user.id,
        action:     'AUTHZ_ESCALATION_ATTEMPT',
        entity:     'user',
        entityId:   id,
        newData:    { actor: req.user.email, target: target.email, reason: 'SUPER_ADMIN_MODIFY_ATTEMPT' },
        ipAddress:  req.ip,
      });
      return response.forbidden(res, 'Cannot modify another SuperAdmin account');
    }

    // Cannot assign SuperAdmin role via this endpoint
    if (role === 'SUPER_ADMIN') {
      // Phase 1 — audit the protected-authority assignment attempt
      auditLog({
        showroomId: target.showroom_id,
        userId:     req.user.id,
        action:     'AUTHZ_ESCALATION_ATTEMPT',
        entity:     'user',
        entityId:   id,
        newData:    { actor: req.user.email, target: target.email, requested_profile: role, reason: 'SUPER_ADMIN_IS_PROTECTED' },
        ipAddress:  req.ip,
      });
      return response.forbidden(res, 'Cannot assign SUPER_ADMIN role via this endpoint');
    }

    // Phase 1 — centralized assignment validation (no privilege
    // amplification). Runs BEFORE the mutation, against the actor's
    // own effective authority. For the current superAdminOnly
    // surface the actor is always SUPER_ADMIN (system authority →
    // allowed); this is the enforcement point any future delegated
    // admin must pass through unchanged.
    if (role !== undefined) {
      const assignment = await validateProfileAssignment(req.user, role);
      if (!assignment.allowed) {
        auditLog({
          showroomId: target.showroom_id,
          userId:     req.user.id,
          action:     'AUTHZ_ESCALATION_ATTEMPT',
          entity:     'user',
          entityId:   id,
          newData:    {
            actor:           req.user.email,
            target:          target.email,
            requested_profile: role,
            reason:          assignment.reason,
          },
          ipAddress: req.ip,
        });
        return response.forbidden(res, 'Cannot assign this profile: insufficient authority.', 'INSUFFICIENT_ROLE');
      }
    }

    const updated = await db.user.update({
      where: { id },
      data: {
        ...(name      !== undefined && { name }),
        ...(role      !== undefined && { role }),
        ...(is_active !== undefined && { is_active }),
      },
      select: {
        id:        true,
        name:      true,
        email:     true,
        role:      true,
        is_active: true,
      },
    });

    // Phase 1 — dedicated authorization-trail event for profile changes
    if (role !== undefined) {
      auditLog({
        showroomId: target.showroom_id,
        userId:     req.user.id,
        action:     'AUTHZ_PROFILE_ASSIGNED',
        entity:     'user',
        entityId:   id,
        oldData:    { profile: target.role },
        newData:    { profile: role, assigned_by: req.user.email },
        ipAddress:  req.ip,
      });
    }

    await auditLog({
      showroomId: target.showroom_id,    // ✅ use target's showroom, not SA's
      userId:     req.user.id,
      action:     'SUPERADMIN_UPDATE_USER',
      entity:     'user',
      entityId:   id,
      oldData:    { name: target.name, role: target.role, is_active: target.is_active },
      newData:    { name, role, is_active },
      ipAddress:  req.ip,
    });

    return response.success(res, updated, 'User updated successfully');
  } catch (err) {
    logger.error('Update user error:', err);
    return response.error(res, 'Failed to update user');
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/superadmin/users  (create user for a showroom)
//
// SuperAdmin creates an OWNER or STAFF user for any showroom.
// ─────────────────────────────────────────────────────────────
const createUserForShowroom = async (req, res) => {
  try {
    const { name, email, password, role = 'OWNER', showroom_id } = req.body;

    if (!name || !email || !password || !showroom_id) {
      return response.validationError(
        res, null,
        'name, email, password, and showroom_id are required'
      );
    }

    if (!['OWNER', 'STAFF'].includes(role)) {
      return response.validationError(res, null, 'role must be OWNER or STAFF');
    }

    // Phase 1 — centralized assignment validation (no privilege
    // amplification) before creating the user. SUPER_ADMIN actor
    // passes (system authority); any future delegated admin must
    // satisfy granted ⊆ creator at the permission AND scope level.
    const assignment = await validateProfileAssignment(req.user, role);
    if (!assignment.allowed) {
      auditLog({
        showroomId: showroom_id,
        userId:     req.user.id,
        action:     'AUTHZ_ESCALATION_ATTEMPT',
        entity:     'user',
        newData:    {
          actor:            req.user.email,
          requested_profile: role,
          target_showroom:  showroom_id,
          reason:           assignment.reason,
        },
        ipAddress: req.ip,
      });
      return response.forbidden(res, 'Cannot create this profile: insufficient authority.', 'INSUFFICIENT_ROLE');
    }

    // Verify showroom exists
    const showroom = await db.showroom.findUnique({ where: { id: showroom_id } });
    if (!showroom) return response.notFound(res, 'Showroom not found');

    // Check email uniqueness
    const existing = await db.user.findUnique({ where: { email: email.toLowerCase().trim() } });
    if (existing) {
      return response.validationError(res, null, 'Email already registered');
    }

    // Phase 4 — plan user-limit enforcement: applied at user:create.
    // The target showroom's active-subscription users_limit snapshot
    // is the authority; legacy/no-limit rows pass through unrestricted.
    try {
      await lifecycleService.enforceUserLimit({ showroomId: showroom_id });
    } catch (err) {
      if (err.code === 'PLAN_LIMIT_REACHED') return response.forbidden(res, err.message, 'PLAN_LIMIT_REACHED');
      throw err;
    }

    const password_hash = await bcrypt.hash(password, SECURITY.password.bcryptRounds);

    const user = await db.user.create({
      data: {
        showroom_id,
        name,
        email: email.toLowerCase().trim(),
        password_hash,
        role,
        is_active: true,
      },
      select: {
        id:        true,
        name:      true,
        email:     true,
        role:      true,
        is_active: true,
        created_at: true,
        showroom: { select: { id: true, name: true } },
      },
    });

    await auditLog({
      showroomId: showroom_id,
      userId:     req.user.id,
      action:     'SUPERADMIN_CREATE_USER',
      entity:     'user',
      entityId:   user.id,
      newData:    { name, email, role, showroom_id },
      ipAddress:  req.ip,
    });

    return response.created(res, user, 'User created successfully');
  } catch (err) {
    logger.error('Create user for showroom error:', err);
    return response.error(res, 'Failed to create user');
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/auth/forgot-password-request  (public)
// ─────────────────────────────────────────────────────────────
const forgotPasswordRequest = async (req, res) => {
  try {
    const { email } = req.body;

    // Anti-enumeration: this EXACT response goes back whether the
    // email exists, is inactive, or anything else fails downstream —
    // an attacker probing emails gets no signal either way.
    const genericResponse = () =>
      response.success(
        res,
        null,
        'إذا كان هذا البريد مسجَّلاً لدينا، فستصلك رسالة تحتوي رابط إعادة التعيين خلال لحظات.'
      );

    const user = await db.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { id: true, name: true, email: true, showroom_id: true, is_active: true },
    });

    if (!user || !user.is_active) return genericResponse();

    // Generate a cryptographically random raw token — this is what
    // goes in the emailed link. Only its SHA-256 hash is ever stored
    // (see PasswordResetToken in schema.prisma for why) — the raw
    // value lives nowhere except this one response/email send.
    const rawToken  = crypto.randomBytes(RESET_TOKEN_BYTES).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    // Invalidate any previous still-valid token for this user first —
    // only the MOST RECENT reset link should ever work. Without this,
    // an old, still-unexpired link from an earlier request would
    // remain a second valid way in after a newer one was issued.
    await db.passwordResetToken.updateMany({
      where: { user_id: user.id, used_at: null },
      data:  { used_at: new Date() },
    });

    await db.passwordResetToken.create({
      data: {
        user_id:    user.id,
        token_hash: tokenHash,
        expires_at: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    // Matrix Audit: matches the actual frontend route — confirmed
    // directly against the project's folder structure (src/app/auth/),
    // not assumed. LoginPage lives at /auth/login, so the reset flow's
    // pages live alongside it at /auth/forgot-password and
    // /auth/reset-password, not bare /reset-password.
    const resetUrl = `${process.env.FRONTEND_URL}/auth/reset-password?token=${rawToken}`;

    // Email failure must NEVER leak through to the response (would
    // both break anti-enumeration AND expose internal infra state to
    // the caller) — logged for ops visibility, swallowed for the
    // user-facing response, same as the outer catch block below.
    let emailSent = false;
    try {
      await emailService.sendPasswordResetEmail({
        to:   user.email,
        name: user.name,
        resetUrl,
        expiresInMinutes: RESET_TOKEN_TTL_MS / 60000,
      });
      emailSent = true;
    } catch (emailErr) {
      logger.error('[ForgotPassword] Email send failed:', emailErr);
      // Falls through to genericResponse() below regardless — the
      // token row already exists, so a retried request just issues a
      // fresh one (the updateMany above supersedes this one safely).
    }

    // Kept for backward compatibility with getPendingResetRequests()
    // below (SuperAdmin's manual-fallback panel) — still useful as a
    // visibility/audit trail even now that the flow is self-service,
    // e.g. to spot a user who requested 5 times in an hour because
    // the email never arrived.
    //
    // Phase C.4 (N-4): the audit row now records the TRUTH — the
    // panel used to show EMAIL_SENT even when the send failed, which
    // made a broken mail pipeline indistinguishable from a happy one.
    // EMAIL_SEND_FAILED is the operator-visible signal that the user
    // got a generic "check your inbox" reply but no email is coming
    // (missing RESEND_API_KEY, unverified sender domain, ...).
    await auditLog({
      showroomId: user.showroom_id,
      userId:     user.id,
      action:     'PASSWORD_RESET_REQUESTED',
      entity:     'user',
      entityId:   user.id,
      newData: {
        email:        user.email,
        name:         user.name,
        requested_at: new Date().toISOString(),
        status:       emailSent ? 'EMAIL_SENT' : 'EMAIL_SEND_FAILED',
      },
      ipAddress: req.ip,
    });

    return genericResponse();
  } catch (err) {
    logger.error('Forgot password request error:', err);
    return response.success(res, null, 'إذا كان هذا البريد مسجَّلاً لدينا، فستصلك رسالة تحتوي رابط إعادة التعيين خلال لحظات.');
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/superadmin/password-reset-requests
// ─────────────────────────────────────────────────────────────
const getPendingResetRequests = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);

    const [requests, total] = await Promise.all([
      db.auditLog.findMany({
        where: {
          action: 'PASSWORD_RESET_REQUESTED',
          created_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
        skip,
        take:    limit,
        orderBy: { created_at: 'desc' },
        include: {
          showroom: { select: { id: true, name: true } },
          user: {
            select: {
              id:        true,
              name:      true,
              email:     true,
              role:      true,
              is_active: true,
            },
          },
        },
      }),
      db.auditLog.count({
        where: {
          action:     'PASSWORD_RESET_REQUESTED',
          created_at: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    return response.paginated(res, requests, buildPaginationMeta(total, page, limit));
  } catch (err) {
    logger.error('Get reset requests error:', err);
    return response.error(res, 'Failed to fetch reset requests');
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/superadmin/reset-user-password
//
// FIX: auditLog now uses targetUser.showroom_id (was req.showroomId)
// ─────────────────────────────────────────────────────────────
const resetUserPassword = async (req, res) => {
  try {
    const { user_id, new_password } = req.body;

    const targetUser = await db.user.findUnique({
      where:  { id: user_id },
      select: {
        id:          true,
        name:        true,
        email:       true,
        role:        true,
        is_active:   true,
        showroom_id: true,
        showroom:    { select: { name: true } },
      },
    });

    if (!targetUser) return response.notFound(res, 'User not found');

    if (targetUser.role === 'SUPER_ADMIN' && targetUser.id !== req.user.id) {
      return response.forbidden(res, 'Cannot reset another SuperAdmin password');
    }

    const tempPassword    = new_password || generateTempPassword();
    const newPasswordHash = await bcrypt.hash(tempPassword, SECURITY.password.bcryptRounds);

    await db.$transaction([
      db.user.update({
        where: { id: user_id },
        data:  { password_hash: newPasswordHash },
      }),
      db.refreshToken.deleteMany({ where: { user_id } }),
    ]);

    // ✅ FIX: was req.showroomId (system showroom) — now target's showroom
    await auditLog({
      showroomId: targetUser.showroom_id,
      userId:     req.user.id,
      action:     'SUPERADMIN_PASSWORD_RESET',
      entity:     'user',
      entityId:   user_id,
      newData: {
        reset_by:               req.user.email,
        target_user:            targetUser.email,
        tokens_revoked:         true,
        password_auto_generated: !new_password,
      },
      ipAddress: req.ip,
    });

    return response.success(res, {
      user_id,
      name:          targetUser.name,
      email:         targetUser.email,
      showroom:      targetUser.showroom.name,
      temp_password: !new_password ? tempPassword : '*** provided by admin ***',
      tokens_revoked: true,
      message: 'Password reset successful. All active sessions have been terminated.',
    });
  } catch (err) {
    logger.error('Reset user password error:', err);
    return response.error(res, 'Failed to reset user password');
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/superadmin/showrooms
// ─────────────────────────────────────────────────────────────
const getAllShowroomsGlobal = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const { search, is_active, is_onboarded, expiring_in } = req.query;

    const where = {};
    if (search) {
      where.OR = [
        { name:  { contains: search, mode: 'insensitive' } },
        { slug:  { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }
    if (is_active    !== undefined) where.is_active    = is_active    === 'true';
    if (is_onboarded !== undefined) where.is_onboarded = is_onboarded === 'true';
    if (expiring_in) {
      const days = parseInt(expiring_in);
      where.license_expiry = {
        lte: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        gte: new Date(),
      };
    }

    const [showrooms, total] = await Promise.all([
      db.showroom.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { created_at: 'desc' },
        include: {
          _count: {
            select: { users: true, inventory: true, sales: true, customers: true, suppliers: true },
          },
        },
      }),
      db.showroom.count({ where }),
    ]);

    const now = new Date();
    const enriched = showrooms.map((s) => {
      const expiry    = new Date(s.license_expiry);
      const isExpired = now > expiry;
      const daysLeft  = Math.ceil((expiry - now) / (1000 * 60 * 60 * 24));
      return {
        ...s,
        license_health: {
          is_expired:  isExpired,
          days_left:   isExpired ? 0 : daysLeft,
          status:
            !s.is_active    ? 'INACTIVE'
            : isExpired     ? 'EXPIRED'
            : daysLeft <= 7 ? 'EXPIRING_SOON'
            : 'ACTIVE',
        },
      };
    });

    return response.paginated(
      res,
      enriched,
      buildPaginationMeta(total, page, limit),
      'Global showrooms list'
    );
  } catch (err) {
    logger.error('Global showrooms error:', err);
    return response.error(res, 'Failed to fetch showrooms');
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/v1/superadmin/showrooms/:id/impersonate
//
// Matrix Audit (#9 — Impersonation): issues a short-lived (30 min),
// access-only token that authenticates AS the target showroom's
// OWNER — this is NOT a new "impersonation" branch in tenantGuard
// or roles.middleware. The token passes through every existing
// route's auth/tenant/role checks with ZERO special-casing and
// ZERO regression risk, because the whole system already trusts
// decoded.userId → db.user.findUnique() as the sole source of
// identity (see auth.middleware.js — unchanged in that regard).
// No refresh token is created or stored — the session simply
// expires in 30 minutes by design (see jwt.js).
// ─────────────────────────────────────────────────────────────
const impersonateShowroom = async (req, res) => {
  try {
    const { id } = req.params;

    const showroom = await db.showroom.findUnique({
      where:  { id },
      select: {
        id: true, name: true, slug: true, is_active: true,
        license_expiry: true, is_onboarded: true, logo_url: true,
      },
    });

    if (!showroom) return response.notFound(res, 'Showroom not found');

    if (!showroom.is_active) {
      return response.validationError(res, null, 'Cannot impersonate an inactive showroom');
    }

    // Target the showroom's OWNER. Guaranteed to exist for any
    // showroom created after the Priority-1 fix (createShowroom now
    // always creates one atomically in the same transaction) — but
    // showrooms created BEFORE that fix may still have zero users,
    // so this is checked explicitly rather than assumed.
    const owner = await db.user.findFirst({
      where:  { showroom_id: id, role: 'OWNER', is_active: true },
      select: { id: true, name: true, email: true, role: true, showroom_id: true },
    });

    if (!owner) {
      return response.notFound(
        res,
        'This showroom has no active OWNER account to impersonate. Create one first via User Management.'
      );
    }

    const impersonationToken = generateImpersonationToken({
      userId:         owner.id,
      showroomId:     owner.showroom_id,
      role:           owner.role,
      impersonatedBy: req.user.id,
    });

    await auditLog({
      showroomId: id,
      userId:     req.user.id,
      action:     'IMPERSONATE_SHOWROOM',
      entity:     'showroom',
      entityId:   id,
      newData: {
        impersonated_user_id:    owner.id,
        impersonated_user_email: owner.email,
        session_duration:        '30m',
      },
      ipAddress: req.ip,
    });

    return response.success(res, {
      accessToken: impersonationToken,
      showroom: {
        id:             showroom.id,
        name:           showroom.name,
        slug:           showroom.slug,
        logo_url:       showroom.logo_url,
        license_expiry: showroom.license_expiry,
        is_active:      showroom.is_active,
        is_onboarded:   showroom.is_onboarded,
      },
      user: {
        id:    owner.id,
        name:  owner.name,
        email: owner.email,
        role:  owner.role,
      },
    }, 'Impersonation session created (30 min)');
  } catch (err) {
    logger.error('Impersonate showroom error:', err);
    return response.error(res, 'Failed to create impersonation session');
  }
};

module.exports = {
  forgotPasswordRequest,
  getPendingResetRequests,
  resetUserPassword,
  getAllShowroomsGlobal,
  // ── NEW ──
  getAllUsers,
  getUserById,
  updateUser,
  createUserForShowroom,
  impersonateShowroom,
};
