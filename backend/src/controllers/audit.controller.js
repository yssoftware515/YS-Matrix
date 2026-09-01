// ============================================================
// YS-MATRIX ERP — Platform Audit Controller (Phase 3)
//
// Platform-wide audit read surface (GLOBAL scope only — the router
// asserts requireScope(GLOBAL) + requirePermission('platform_audit:read')
// before any handler runs).
//
// Security contract (enforced here, server-side, fail closed):
//   • Every query runs on the unscoped baseClient — the /admin
//     router deliberately mounts NO tenantGuard (documented in
//     admin.routes.js), so tenant-scoped clients would fail closed
//     with TenantContextError. The showroom_id filter on this
//     surface is a VIEW filter over the platform trail, legal only
//     at GLOBAL scope.
//   • Redaction: every response is passed through redactAuditRow
//     for NON-SUPER_ADMIN viewers (delegated GLOBAL admins) —
//     national_id / phone / phone_number are replaced with
//     '[REDACTED]' server-side. SUPER_ADMIN keeps raw records.
//   • Read-only: no handler writes or mutates audit rows.
// ============================================================

'use strict';

const { baseClient: db } = require('../config/database');
const { getPagination, buildPaginationMeta } = require('../utils/pagination');
const { redactAuditRow } = require('../utils/auditRedaction');
const response = require('../utils/response');
const logger   = require('../config/logger');

const AUDIT_INCLUDE = {
  user:     { select: { id: true, name: true, email: true, role: true } },
  showroom: { select: { id: true, name: true } },
};

// ── SUPER_ADMIN is the unconditional system authority — it sees
// raw audit payloads; everyone else gets the redacted projection.
function shouldRedact(req) {
  return req.user?.role !== 'SUPER_ADMIN';
}

// ─────────────────────────────────────────────────────────────
// GET /api/v1/admin/audit/events
// Filters: entity, action, user_id, showroom_id, entity_id,
//          date_from, date_to — paginated, newest first.
// ─────────────────────────────────────────────────────────────
const listAuditEvents = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const { entity, action, user_id, showroom_id, entity_id, date_from, date_to } = req.query;

    const where = {};
    if (entity)      where.entity      = entity;
    if (action)      where.action      = action;
    if (user_id)     where.user_id     = user_id;
    if (showroom_id) where.showroom_id = showroom_id;
    if (entity_id)   where.entity_id   = entity_id;

    if (date_from || date_to) {
      where.created_at = {};
      if (date_from) where.created_at.gte = new Date(date_from);
      if (date_to)   where.created_at.lte = new Date(date_to);
    }

    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        skip,
        take:    limit,
        orderBy: { created_at: 'desc' },
        include: AUDIT_INCLUDE,
      }),
      db.auditLog.count({ where }),
    ]);

    const redact = shouldRedact(req);
    const data = logs.map((log) => redactAuditRow(log, redact));

    return response.paginated(res, data, buildPaginationMeta(total, page, limit), 'Audit events list');
  } catch (err) {
    logger.error('List audit events error:', err);
    return response.error(res, 'Failed to fetch audit events');
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/admin/audit/filters
// Distinct actions + entities for the filter dropdowns.
// ─────────────────────────────────────────────────────────────
const getAuditFilters = async (req, res) => {
  try {
    const [actions, entities] = await Promise.all([
      db.auditLog.findMany({
        select:  { action: true },
        distinct: ['action'],
        orderBy: { action: 'asc' },
      }),
      db.auditLog.findMany({
        select:  { entity: true },
        distinct: ['entity'],
        orderBy: { entity: 'asc' },
      }),
    ]);

    return response.success(res, {
      actions:  actions.map((r) => r.action),
      entities: entities.map((r) => r.entity),
    }, 'Audit filters');
  } catch (err) {
    logger.error('Get audit filters error:', err);
    return response.error(res, 'Failed to fetch audit filters');
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/v1/admin/audit/:id
// Single event detail (redacted for non-SUPER_ADMIN viewers).
// ─────────────────────────────────────────────────────────────
const getAuditEventById = async (req, res) => {
  try {
    const { id } = req.params;

    const log = await db.auditLog.findUnique({
      where:  { id },
      include: AUDIT_INCLUDE,
    });

    if (!log) return response.notFound(res, 'Audit event not found');

    return response.success(res, redactAuditRow(log, shouldRedact(req)), 'Audit event');
  } catch (err) {
    logger.error('Get audit event error:', err);
    return response.error(res, 'Failed to fetch audit event');
  }
};

module.exports = {
  listAuditEvents,
  getAuditFilters,
  getAuditEventById,
};