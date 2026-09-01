// ============================================================
// YS-MATRIX ERP — Tenant Users Service (F4 — Staff Management)
//
// OWNER-managed staff surface for a single showroom:
//   • listUsers    — paginated tenant users (own showroom only)
//   • setUserActive— deactivate/reactivate a STAFF member
//
// Tenant safety: every query runs through the ALS-scoped `prisma`
// client (tenantGuard sets the context in the route chain) — a
// foreign user id resolves to 404, never a cross-tenant write.
// Creation reuses authController.register's canonical path
// (validateProfileAssignment + enforceUserLimit + email
// uniqueness), so there is exactly ONE staff-creation flow.
//
// Deactivation revokes every refresh token of the target — the
// session dies immediately, and (crucially) a deactivated user
// cannot refresh their way back in. Reactivation re-checks the
// plan's users_limit (deactivated users freed their slot).
// ============================================================

'use strict';

const prisma = require('../config/database');
const { getPagination, buildPaginationMeta } = require('../utils/pagination');
const lifecycleService = require('./subscription.lifecycle.service');

const listUsers = async ({ showroomId, query }) => {
  const { page, limit, skip } = getPagination(query);

  const where = { showroom_id: showroomId };
  if (query.role)      where.role      = query.role;
  if (query.is_active) where.is_active = query.is_active === 'true';

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take:    limit,
      orderBy: [{ role: 'asc' }, { created_at: 'asc' }],
      select:  {
        id: true, name: true, email: true, role: true,
        is_active: true, last_login: true, created_at: true, profile_id: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { users, pagination: buildPaginationMeta(total, page, limit) };
};

const setUserActive = async ({ showroomId, userId, isActive, actorId }) => {
  // Tenant-scoped lookup — a foreign user is invisible (404, no leak).
  const target = await prisma.user.findFirst({
    where: { id: userId, showroom_id: showroomId },
    select: { id: true, name: true, email: true, role: true, is_active: true },
  });
  if (!target) {
    throw Object.assign(new Error('المستخدم غير موجود.'), { code: 'NOT_FOUND' });
  }
  if (target.id === actorId) {
    throw Object.assign(new Error('لا يمكنك تغيير حالة حسابك الخاص.'), { code: 'VALIDATION_ERROR' });
  }
  // OWNER (and SUPER_ADMIN) accounts are protected — staff surface only.
  if (target.role !== 'STAFF') {
    throw Object.assign(new Error('لا يمكن تغيير حالة حساب المالك.'), { code: 'VALIDATION_ERROR' });
  }
  if (target.is_active === isActive) {
    return { user: target, unchanged: true };
  }

  // Reactivation re-checks the plan limit — the canonical enforcement
  // from the subscription lifecycle (deactivated users freed a slot).
  if (isActive) {
    await lifecycleService.enforceUserLimit({ showroomId });
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data:  { is_active: isActive },
    select: {
      id: true, name: true, email: true, role: true,
      is_active: true, last_login: true, created_at: true,
    },
  });

  // Immediate session kill on deactivation — every stored refresh
  // token for the target is revoked (active access tokens die on
  // their own short TTL; refresh would otherwise survive 7 days).
  if (!isActive) {
    await prisma.refreshToken.deleteMany({ where: { user_id: userId } });
  }

  return { user: updated, unchanged: false };
};

module.exports = { listUsers, setUserActive };
