// ============================================================
// YS-MATRIX ERP — Audit Middleware (Phase 2 Stage 1 / Phase 3)
// Changes vs original:
//   • auditLog never throws — always swallows errors silently
//   • Added ip, userAgent, method, path to auto middleware version
//   • Fire-and-forget pattern: does NOT await in route handlers
//   • Phase 3 — impersonation attribution: when the request ran
//     inside tenantGuard under an impersonation session
//     (tenantStorage store carries impersonatedBy), every audit row
//     written during that session is attributed to the real
//     SUPER_ADMIN via new_data.impersonated_by. The store read is
//     defensive (optional chaining) so stubbed-database unit tests
//     can never crash on it.
//   • No breaking change — same function signatures
// ============================================================

'use strict';

const db     = require('../config/database');
const logger = require('../config/logger');

// The AsyncLocalStorage store injected by tenant.middleware. Read
// defensively: unit tests stub config/database with shapes that may
// not carry tenantStorage at all.
function currentTenantStore() {
  try {
    return db.tenantStorage?.getStore?.() || null;
  } catch {
    return null;
  }
}

// Resolve the impersonating SUPER_ADMIN's identity for attribution.
// Fire-and-forget friendly: never throws (failure → minimal fallback).
async function resolveImpersonatedBy(userId) {
  if (!userId) return null;
  try {
    const imp = await db.user.findUnique({
      where:  { id: userId },
      select: { id: true, name: true, email: true, role: true },
    });
    return imp
      ? { user_id: imp.id, name: imp.name, email: imp.email, role: imp.role }
      : { user_id: userId };
  } catch (err) {
    logger.error('[AuditLog] Failed to resolve impersonation attribution:', {
      userId,
      err: err.message,
    });
    return { user_id: userId };
  }
}

/**
 * auditLog({ showroomId, userId, action, entity, entityId?, oldData?, newData?, ipAddress? })
 *
 * Manually log an action to audit_logs table.
 * Call without await in controllers — failure must never break the operation.
 *
 * Example:
 *   auditLog({ showroomId, userId, action: 'CREATE', entity: 'customer', entityId: c.id });
 */
const auditLog = ({
  showroomId,
  userId    = null,
  action,
  entity,
  entityId  = null,
  oldData   = null,
  newData   = null,
  ipAddress = null,
  userAgent = null,
  extra     = null,   // any additional JSON metadata
}) => {
  // Fire-and-forget — never block the main operation
  Promise.resolve().then(async () => {
    try {
      // Phase 3 — impersonation attribution (merged even when the call
      // site passed no newData, so the trail is never left ambiguous).
      let impersonatedBy = null;
      const store = currentTenantStore();
      if (store?.impersonatedBy) {
        impersonatedBy = await resolveImpersonatedBy(store.impersonatedBy);
      }

      const attribution = impersonatedBy ? { impersonated_by: impersonatedBy } : null;

      await db.auditLog.create({
        data: {
          showroom_id: showroomId,
          user_id:     userId,
          action,
          entity,
          entity_id:   entityId  ? String(entityId)  : null,
          old_data:    oldData   ?? undefined,
          new_data:    newData
            ? { ...newData, ...attribution, ...(userAgent ? { _ua: userAgent } : {}), ...(extra || {}) }
            : (attribution || undefined),
          ip_address:  ipAddress,
        },
      });
    } catch (err) {
      // Audit log failure must NEVER crash the main request
      logger.error('[AuditLog] Failed to write audit entry:', {
        action,
        entity,
        entityId,
        showroomId,
        err: err.message,
      });
    }
  });
};

/**
 * auditMiddleware(action, entity)
 *
 * Express middleware factory — auto-logs after a successful response.
 * Attaches to routes where you want automatic logging without controller changes.
 *
 * Usage:
 *   router.post('/items', auditMiddleware('CREATE', 'inventory'), controller)
 */
const auditMiddleware = (action, entity) => (req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    // Only log on success responses
    if (res.statusCode >= 200 && res.statusCode < 300 && req.user) {
      const entityId = body?.data?.id || req.params?.id || null;

      auditLog({
        showroomId: req.showroomId,
        userId:     req.user?.id,
        action,
        entity,
        entityId,
        newData:    body?.data || null,
        ipAddress:  req.ip || req.connection?.remoteAddress,
        userAgent:  req.headers?.['user-agent'],
      });
    }
    return originalJson(body);
  };

  next();
};

module.exports = { auditLog, auditMiddleware };
