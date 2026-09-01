// ============================================================
// YS-MATRIX ERP — Activity Logs Service (Phase 2 Stage 3)
// Builds on existing AuditLog model — no schema change needed
// ============================================================

'use strict';

const prisma = require('../config/database');
const { getPagination, buildPaginationMeta } = require('../utils/pagination');

// ─────────────────────────────────────────
// LIST ACTIVITY LOGS — paginated + filtered
// ─────────────────────────────────────────
const listActivityLogs = async ({ showroomId, query }) => {
  const { page, limit, skip } = getPagination(query);
  const { entity, action, user_id, date_from, date_to } = query;

  const where = { showroom_id: showroomId };

  if (entity)   where.entity  = entity;
  if (action)   where.action  = action;
  if (user_id)  where.user_id = user_id;

  if (date_from || date_to) {
    where.created_at = {};
    if (date_from) where.created_at.gte = new Date(date_from);
    if (date_to)   where.created_at.lte = new Date(date_to);
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { created_at: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true, role: true },
        },
      },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { logs, pagination: buildPaginationMeta(total, page, limit) };
};

// ─────────────────────────────────────────
// GET DISTINCT ACTIONS — for filter dropdown
// ─────────────────────────────────────────
const getDistinctActions = async ({ showroomId }) => {
  const results = await prisma.auditLog.findMany({
    where:   { showroom_id: showroomId },
    select:  { action: true },
    distinct: ['action'],
    orderBy: { action: 'asc' },
  });
  return results.map((r) => r.action);
};

// ─────────────────────────────────────────
// GET DISTINCT ENTITIES — for filter dropdown
// ─────────────────────────────────────────
const getDistinctEntities = async ({ showroomId }) => {
  const results = await prisma.auditLog.findMany({
    where:    { showroom_id: showroomId },
    select:   { entity: true },
    distinct: ['entity'],
    orderBy:  { entity: 'asc' },
  });
  return results.map((r) => r.entity);
};

// ─────────────────────────────────────────
// GET ENTITY HISTORY — full trail for one record
// ─────────────────────────────────────────
const getEntityHistory = async ({ showroomId, entity, entityId }) => {
  return prisma.auditLog.findMany({
    where: {
      showroom_id: showroomId,
      entity,
      entity_id:   entityId,
    },
    orderBy: { created_at: 'desc' },
    include: {
      user: { select: { id: true, name: true, role: true } },
    },
  });
};

// ─────────────────────────────────────────
// SUMMARY — activity stats for dashboard widget
// ─────────────────────────────────────────
const getActivitySummary = async ({ showroomId }) => {
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // last 7 days

  const [total7d, byAction, byUser] = await Promise.all([
    prisma.auditLog.count({
      where: { showroom_id: showroomId, created_at: { gte: since } },
    }),
    prisma.auditLog.groupBy({
      by:    ['action'],
      where: { showroom_id: showroomId, created_at: { gte: since } },
      _count: true,
      orderBy: { _count: { action: 'desc' } },
      take:  10,
    }),
    prisma.auditLog.groupBy({
      by:    ['user_id'],
      where: { showroom_id: showroomId, created_at: { gte: since }, user_id: { not: null } },
      _count: true,
      orderBy: { _count: { user_id: 'desc' } },
      take:  5,
    }),
  ]);

  // Enrich user data — batch fetch
  const userIds = byUser.map((u) => u.user_id).filter(Boolean);
  const users   = await prisma.user.findMany({
    where:  { id: { in: userIds } },
    select: { id: true, name: true, role: true },
  });
  const userMap = Object.fromEntries(users.map((u) => [u.id, u]));

  return {
    period:    '7_days',
    total:     total7d,
    by_action: byAction.map((a) => ({ action: a.action, count: a._count })),
    by_user:   byUser.map((u) => ({
      user:  userMap[u.user_id] || { id: u.user_id },
      count: u._count,
    })),
  };
};

module.exports = {
  listActivityLogs,
  getDistinctActions,
  getDistinctEntities,
  getEntityHistory,
  getActivitySummary,
};
