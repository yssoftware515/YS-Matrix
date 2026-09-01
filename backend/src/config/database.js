// ============================================================
// YS-MATRIX ERP - Prisma Client + Global Tenant Isolation
// Author: Yahya Al-Sulami 🦅
// v2.1 — FIX: removed 'user' from GLOBAL_MODELS (privacy risk)
//         Auth queries that need cross-tenant access now use
//         baseClient directly via prisma.$parent or a bypass flag.
// v2.2 — SECURITY FIX: tenant isolation is now fail-CLOSED.
//         Previously, a scoped model query with no showroomId in
//         AsyncLocalStorage context silently ran UNFILTERED across
//         all tenants (cross-showroom data leak). It now throws
//         instead. If this throws in production, it means some
//         code path is querying a scoped model outside of
//         tenant.middleware's context — that path was ALREADY
//         leaking data; this just makes it visible instead of silent.
// ============================================================

const { PrismaClient } = require('@prisma/client');
const { AsyncLocalStorage } = require('async_hooks');

const tenantStorage = new AsyncLocalStorage();

// ─────────────────────────────────────────────────────────────
// GLOBAL_MODELS — tables that are NOT tenant-scoped.
//
// IMPORTANT: 'user' was removed from this list.
// Previously, any user query bypassed tenant filtering,
// meaning a controller bug could leak users across showrooms.
//
// Auth lookups that legitimately need cross-tenant access
// (login by email, token verification) must use the
// exported `baseClient` directly.
// ─────────────────────────────────────────────────────────────
const GLOBAL_MODELS = new Set([
  'Showroom',        // managed by SuperAdmin across all tenants
  'RefreshToken',    // looked up by token value, no tenant scope
  'AuditLog',        // written globally; filtered in controller
  'Installment',     // no showroom_id — scoped via sale → showroom
  'SaleItem',        // no showroom_id — scoped via sale → showroom
  'SupplierPayment', // no showroom_id — scoped via supplier → showroom
  'ScheduledJobRun', // infra-only cron coordination row, no tenant concept at all
  // ── Phase 1 (Authorization Foundation) ──────────────────────
  // Platform-level authorization data — profile/permission
  // resolution must work OUTSIDE any tenant context (the resolver
  // runs before/without tenantGuard, e.g. for /auth/me and
  // assignment validation). These are never tenant-scoped by design.
  'Permission',      // permission catalog records (resource:action)
  'Profile',         // role compatibility profiles (OWNER / STAFF)
  'ProfilePermission', // profile ↔ permission assignments
]);

const SCOPED_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findUnique',
  'findUniqueOrThrow',
  'findFirstOrThrow',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);

// ─────────────────────────────────────────────────────────────
// F-25 FOLLOW-UP: write operations that CREATE new scoped rows.
// Previously ONLY read/update/delete operations were tenant-scoped
// — `create`/`createMany`/`upsert` passed through completely
// unchecked, regardless of whether an AsyncLocalStorage context
// existed. In practice every service call site already set
// showroom_id manually and correctly, so this was never exploited —
// but it meant the "fail-closed" guarantee documented for this file
// was only PARTIALLY true. Handled separately from
// SCOPED_OPERATIONS above because the injection target is
// `args.data` (and, for upsert, also `args.create` + `args.where`),
// not `args.where` alone like the read/update/delete case.
// ─────────────────────────────────────────────────────────────
const WRITE_SCOPED_OPERATIONS = new Set(['create', 'createMany', 'upsert']);

// ─────────────────────────────────────────────────────────────
// F-13 FIX: Prisma 'query' log level prints every SQL statement
// WITH its actual parameter values to console — including raw
// refresh_token strings (auth.controller.js's
// db.refreshToken.create({ data: { token: refreshToken, ... } })),
// customer national IDs, phone numbers, and financial figures.
// This was previously enabled automatically whenever
// NODE_ENV==='development' — which is NOT a safe proxy for "this is
// a private local machine with synthetic data": a misconfigured
// staging deployment, or a local dev environment seeded with data
// copied from production, would both silently start logging real
// credentials and PII to console (and from there, to whatever
// platform log aggregator is watching stdout).
//
// Query logging is now a SEPARATE, explicit opt-in — a developer who
// genuinely needs to debug SQL sets PRISMA_QUERY_LOGGING=true
// locally. It is never enabled implicitly by NODE_ENV alone.
// ─────────────────────────────────────────────────────────────
const QUERY_LOGGING_ENABLED = process.env.PRISMA_QUERY_LOGGING === 'true';

const PRISMA_LOG_LEVELS = QUERY_LOGGING_ENABLED
  ? ['query', 'error', 'warn']
  : process.env.NODE_ENV === 'development'
    ? ['warn', 'error']
    : ['error'];

// ─────────────────────────────────────────────────────────────
// Base Prisma client (singleton) — used directly for auth
// ─────────────────────────────────────────────────────────────
const globalForPrisma = global;

const baseClient =
  globalForPrisma.__ys_base_prisma ||
  new PrismaClient({
    log: PRISMA_LOG_LEVELS,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__ys_base_prisma = baseClient;
}

// ─────────────────────────────────────────────────────────────
// TenantContextError — thrown when a scoped model is queried
// with no showroomId available in AsyncLocalStorage. This is a
// programmer error (missing tenant.middleware on a route, or a
// background job/script running outside request context) and
// must be fixed at the call site — NOT caught-and-ignored.
// ─────────────────────────────────────────────────────────────
class TenantContextError extends Error {
  constructor(model, operation) {
    super(
      `Tenant isolation violation: attempted "${operation}" on scoped model "${model}" ` +
      `with no showroomId in context. This query was BLOCKED to prevent cross-tenant ` +
      `data exposure. Ensure tenant.middleware runs before this code path, or use ` +
      `baseClient explicitly if cross-tenant access is genuinely intended.`
    );
    this.name = 'TenantContextError';
    this.model = model;
    this.operation = operation;
    this.statusCode = 500;
  }
}

// ─────────────────────────────────────────────────────────────
// Extended Prisma Client — Auto Tenant Filtering
// ─────────────────────────────────────────────────────────────
const prisma = baseClient.$extends({
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (GLOBAL_MODELS.has(model)) return query(args);

        const isRead  = SCOPED_OPERATIONS.has(operation);
        const isWrite = WRITE_SCOPED_OPERATIONS.has(operation);
        if (!isRead && !isWrite) return query(args);

        const store      = tenantStorage.getStore();
        const showroomId = store?.showroomId;

        // SECURITY: fail-closed. A scoped model with no tenant
        // context must NOT silently run unfiltered — that would
        // leak every showroom's data to whoever triggered this path.
        // Applies identically to reads AND writes now.
        if (!showroomId) {
          throw new TenantContextError(model, operation);
        }

        if (isRead) {
          args.where = { ...args.where, showroom_id: showroomId };
          return query(args);
        }

        // isWrite — inject showroom_id into whatever field actually
        // creates the row for this operation shape. ALWAYS
        // overwrites any showroom_id the caller may have set
        // manually with the trusted context value — existing service
        // code that already sets it correctly sees no behavior
        // change (same value twice); a call site with a bug (wrong
        // or attacker-influenced showroom_id) gets silently
        // corrected rather than silently exploited.
        switch (operation) {
          case 'create':
            args.data = { ...args.data, showroom_id: showroomId };
            break;

          case 'createMany':
            // args.data is normally an array for createMany, but
            // handle the (rarer) single-object shape defensively too.
            args.data = Array.isArray(args.data)
              ? args.data.map((row) => ({ ...row, showroom_id: showroomId }))
              : { ...args.data, showroom_id: showroomId };
            break;

          case 'upsert':
            // `where` also gets showroom_id — same "extra filter
            // alongside the unique field" pattern already used above
            // for update/delete — this prevents an upsert-by-id from
            // ever matching (and updating) a row that belongs to a
            // DIFFERENT showroom, since Prisma treats the additional
            // field as an AND condition.
            args.where  = { ...args.where, showroom_id: showroomId };
            args.create = { ...args.create, showroom_id: showroomId };
            break;
        }

        return query(args);
      },
    },
  },
});

// ─────────────────────────────────────────────────────────────
// runWithShowroomContext — the ONLY supported tenant passthrough.
//
// Narrow, explicit mechanism for a legitimate GLOBAL/system
// operation to target ONE specific showroom (e.g. a SUPER_ADMIN
// renewing showroom A's subscription from the platform surface).
//
// Why this exists:
//   • renewSubscription() writes `subscription.create` with its own
//     explicit showroom_id, but the extension above ALWAYS
//     overwrites that value with the ambient ALS context. A
//     SUPER_ADMIN request resolves to the SYSTEM showroom, so the
//     renewal row silently landed on the system showroom while
//     license_expiry was updated on the target — a data-integrity
//     split (Matrix Phase 4 P1). See subscription.service.js.
//   • baseClient would "work" but has NO safety net at all — every
//     query inside the callback would be unscoped. This helper keeps
//     the full fail-closed extension active; only the context VALUE
//     is scoped to the intended target for the duration of `fn`.
//
// Safety contract:
//   • The target comes from SERVER CODE (a validated service
//     argument), never from raw request input — request-level
//     bypass is impossible; tenantGuard still blocks all
//     client-supplied showroom_id mismatches.
//   • Ordinary tenant-scoped writes are untouched (callers keep
//     using `prisma` normally).
//   • Normal tenant enforcement is preserved everywhere else; a
//     caller that forgets the wrapper still hits fail-closed.
//   • Operations must remain audited at their call sites.
// ─────────────────────────────────────────────────────────────
const runWithShowroomContext = async (showroomId, fn) => {
  if (!showroomId) {
    throw new Error('runWithShowroomContext requires a non-empty showroomId.');
  }
  return tenantStorage.run({ showroomId }, fn);
};

// ─────────────────────────────────────────────────────────────
// Exports
//
// prisma      — tenant-scoped client (use everywhere in controllers)
// baseClient  — unscoped client (use ONLY in auth for email lookups
//               and token verification where no showroom context exists)
// tenantStorage — AsyncLocalStorage instance for tenantGuard
// runWithShowroomContext — narrow explicit tenant passthrough for
//               legitimate GLOBAL/showroom-targeted operations
// ─────────────────────────────────────────────────────────────
module.exports = prisma;
module.exports.tenantStorage          = tenantStorage;
module.exports.baseClient             = baseClient;
module.exports.TenantContextError     = TenantContextError;
module.exports.runWithShowroomContext = runWithShowroomContext;
