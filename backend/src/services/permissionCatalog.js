// ============================================================
// YS-MATRIX ERP — Permission Catalog (Phase 1 — Authorization
// Foundation)
//
// PURE module — no DB access, no side effects. Single source of
// truth for the parity permission catalog. The seeder
// (src/utils/seed.authorization.js) syncs these definitions into
// the permission/profiles tables; the resolver
// (src/services/authorization.service.js) reads the DATABASE rows
// as the runtime source of truth — this file is what keeps them
// reproducible and unit-testable.
//
// PARITY CONTRACT (do not silently broaden):
// Every entry below is DERIVED from the existing route/guard
// behavior mapped in the Phase 1 readiness scan:
//   • STAFF profile = exactly what a STAFF user can do today.
//   • OWNER profile = STAFF + every ownerOnly-guarded action.
//   • SUPER_ADMIN is NOT a profile (see PROTECTED_SYSTEM_AUTHORITY).
// No permission here grants anything the legacy role guards did not.
// ============================================================

'use strict';

// ── Scopes ───────────────────────────────────────────────────
// Phase 1 formalizes only SHOWROOM + SELF. GLOBAL is reserved for
// future platform administration and is never assigned to any
// profile in this phase.
const SCOPES = Object.freeze({
  SHOWROOM: 'SHOWROOM',
  SELF:     'SELF',
  GLOBAL:   'GLOBAL',
});

// ── SUPER_ADMIN ──────────────────────────────────────────────
// SUPER_ADMIN is a protected system authority, NOT an assignable
// profile. The resolver short-circuits on this role exactly like
// every existing legacy guard (license/onboarding/tenant bypass,
// superAdminOnly). It must never appear in PROFILE_DEFINITIONS,
// and every profile-assignment path must reject the string
// 'SUPER_ADMIN' as a target.
const PROTECTED_SYSTEM_AUTHORITY = Object.freeze({
  role:   'SUPER_ADMIN',
  scope:  SCOPES.GLOBAL, // platform-level (future-admin semantics)
});

// ── Permission catalog (resource:action, NO wildcards) ───────
// key = `${resource}:${action}` — parsed from the two columns.
const PERMISSIONS = [

  // Dashboard / analytics reads
  { key: 'dashboard:read', resource: 'dashboard', action: 'read', description: 'View dashboard KPIs and analytics charts' },

  // Inventory
  { key: 'inventory:read',       resource: 'inventory', action: 'read',       description: 'List and view inventory items, stats, low-stock alerts' },
  { key: 'inventory:create',     resource: 'inventory', action: 'create',     description: 'Create inventory items (including bulk)' },
  { key: 'inventory:update',     resource: 'inventory', action: 'update',     description: 'Update inventory items (including pricing)' },
  { key: 'inventory:delete',     resource: 'inventory', action: 'delete',     description: 'Soft-delete (deactivate) inventory items' },
  { key: 'inventory:reactivate', resource: 'inventory', action: 'reactivate', description: 'Reactivate deactivated inventory items' },

  // Customers
  { key: 'customer:read',       resource: 'customer', action: 'read',       description: 'List and view customers' },
  { key: 'customer:create',     resource: 'customer', action: 'create',     description: 'Create customers' },
  { key: 'customer:update',     resource: 'customer', action: 'update',     description: 'Update customers' },
  { key: 'customer:delete',     resource: 'customer', action: 'delete',     description: 'Soft-delete (deactivate) customers' },
  { key: 'customer:reactivate', resource: 'customer', action: 'reactivate', description: 'Reactivate deactivated customers' },

  // Suppliers
  { key: 'supplier:read',       resource: 'supplier', action: 'read',       description: 'List and view suppliers and stats' },
  { key: 'supplier:create',     resource: 'supplier', action: 'create',     description: 'Create suppliers' },
  { key: 'supplier:update',     resource: 'supplier', action: 'update',     description: 'Update suppliers' },
  { key: 'supplier:delete',     resource: 'supplier', action: 'delete',     description: 'Soft-delete (deactivate) suppliers' },
  { key: 'supplier:reactivate', resource: 'supplier', action: 'reactivate', description: 'Reactivate deactivated suppliers' },

  // Supplier payments
  { key: 'supplier_payment:read',   resource: 'supplier_payment', action: 'read',   description: 'View supplier payment history' },
  { key: 'supplier_payment:create', resource: 'supplier_payment', action: 'create', description: 'Record a supplier payment' },

  // Sales
  { key: 'sales:read',              resource: 'sales',            action: 'read',     description: 'List and view sales, summaries, overdue/upcoming installments' },
  { key: 'sales:create',            resource: 'sales',            action: 'create',   description: 'Create sales' },
  { key: 'sales:cancel',            resource: 'sales',            action: 'cancel',   description: 'Cancel a sale (restores inventory)' },
  { key: 'sales_installment:pay',   resource: 'sales_installment', action: 'pay',     description: 'Record an installment payment' },

  // Expenses
  { key: 'expense:read',   resource: 'expense', action: 'read',   description: 'List expenses' },
  { key: 'expense:create', resource: 'expense', action: 'create', description: 'Create expenses' },
  { key: 'expense:update', resource: 'expense', action: 'update', description: 'Update expenses' },
  { key: 'expense:delete', resource: 'expense', action: 'delete', description: 'Delete expenses' },

  // Notifications
  { key: 'notification:read',   resource: 'notification', action: 'read',   description: 'List notifications and unread count' },
  { key: 'notification:update', resource: 'notification', action: 'update', description: 'Mark notifications as read' },
  { key: 'notification:delete', resource: 'notification', action: 'delete', description: 'Clean up old notifications' },

  // Activity / audit trail (tenant-scoped logs)
  { key: 'activity:read', resource: 'activity', action: 'read', description: 'View showroom activity/audit log' },

  // Search / invoices / subscriptions / licenses
  { key: 'search:read',      resource: 'search',      action: 'read', description: 'Global in-showroom search' },
  { key: 'invoice:read',     resource: 'invoice',     action: 'read', description: 'View invoices (JSON and printable HTML)' },
  { key: 'subscription:read', resource: 'subscription', action: 'read', description: 'View own subscription and history' },
  // Phase 4 — customer-initiated subscription purchase (OWNER only)
  { key: 'subscription:create', resource: 'subscription', action: 'create', description: 'Request a subscription purchase and submit manual payment proof' },
  { key: 'license:read',     resource: 'license',     action: 'read', description: 'View own license status' },

  // Onboarding
  { key: 'onboarding:read',   resource: 'onboarding', action: 'read',   description: 'Check onboarding status' },
  { key: 'onboarding:update', resource: 'onboarding', action: 'update', description: 'Submit onboarding data (wizard completion)' },

  // User management (in-showroom staff creation today)
  { key: 'user:create', resource: 'user', action: 'create', description: 'Create user accounts within the showroom' },

  // Self-service (SELF scope)
  { key: 'profile:read',   resource: 'profile', action: 'read',   description: 'Read own profile (/auth/me)' },
  { key: 'profile:update', resource: 'profile', action: 'update', description: 'Update own profile (name/avatar)' },
  { key: 'auth:password',  resource: 'auth',    action: 'password', description: 'Change own password' },

  // Platform administration (Phase 2 — delegated administrators)
  // RUNTIME-ONLY resources: never seeded into the parity profiles
  // (STAFF/OWNER). Granted exclusively at GLOBAL scope by
  // SUPER_ADMIN via profile_permissions. isPlatformPermission()
  // gates this contract; the /api/v1/admin router asserts GLOBAL
  // scope before any of these can be used.
  { key: 'platform_profile:read',   resource: 'platform_profile',   action: 'read',   description: 'List and view platform profiles (non-system only)' },
  { key: 'platform_profile:create', resource: 'platform_profile',   action: 'create', description: 'Create platform profiles' },
  { key: 'platform_profile:update', resource: 'platform_profile',   action: 'update', description: 'Update platform profiles (permission deltas)' },
  { key: 'platform_profile:delete', resource: 'platform_profile',   action: 'delete', description: 'Delete platform profiles (must have no users)' },
  { key: 'platform_admin:read',     resource: 'platform_admin',     action: 'read',   description: 'List and view platform administrators and their profiles' },
  { key: 'platform_admin:create',   resource: 'platform_admin',     action: 'create', description: 'Create platform administrators (GLOBAL-scope profile required)' },
  { key: 'platform_admin:update',   resource: 'platform_admin',     action: 'update', description: 'Update platform administrators (enable/disable/profile)' },
  { key: 'platform_user:read',      resource: 'platform_user',      action: 'read',   description: 'List platform users across showrooms' },
  { key: 'platform_showroom:read',  resource: 'platform_showroom',  action: 'read',   description: 'List platform showrooms and licensing state' },

  // Platform audit & observability (Phase 3 — read-first governance surface).
  // RUNTIME-ONLY like every platform_* key: GLOBAL scope only, never seeded
  // into the parity profiles. Grants platform-wide visibility of the audit
  // trail (all showrooms); responses are server-side redacted for
  // non-SUPER_ADMIN viewers (see src/utils/auditRedaction.js).
  { key: 'platform_audit:read',     resource: 'platform_audit',     action: 'read',   description: 'View the platform-wide audit log (redacted for delegated admins)' },

  // Platform subscriptions & payments (Phase 4 — account/commercial surface).
  // RUNTIME-ONLY platform keys: GLOBAL scope, never seeded into parity
  // profiles. Subscription health + manual payment review (approve/reject)
  // are platform operations; every state transition is audited.
  { key: 'platform_subscription:read', resource: 'platform_subscription', action: 'read',   description: 'View platform subscription health, all subscriptions and expiring accounts' },
  { key: 'platform_subscription:update', resource: 'platform_subscription', action: 'update', description: 'Cancel/suspend subscription accounts' },
  { key: 'platform_payment:read',   resource: 'platform_payment',   action: 'read',   description: 'View payment requests and payment evidence (proof screenshots)' },
  { key: 'platform_payment:update', resource: 'platform_payment',   action: 'update', description: 'Approve or reject manual payment requests (activates subscriptions via the canonical service)' },
];

// ── Compatibility profiles (parity-derived) ──────────────────
// scope = the profile's OWN scope (the widest scope its grants can
// reach). Permission entries carry the scope at which the grant
// applies: SHOWROOM grants cover showroom resources; SELF grants
// cover the user's own profile/session only.
const PROFILE_DEFINITIONS = {
  STAFF: {
    name:        'STAFF',
    description: 'Showroom employee — read/write on operational records, no destructive or owner-only actions',
    scope:       SCOPES.SHOWROOM,
    permissions: [
      { permission: 'dashboard:read',          scope: SCOPES.SHOWROOM },
      { permission: 'inventory:read',          scope: SCOPES.SHOWROOM },
      { permission: 'inventory:create',        scope: SCOPES.SHOWROOM },
      { permission: 'inventory:update',        scope: SCOPES.SHOWROOM },
      { permission: 'customer:read',           scope: SCOPES.SHOWROOM },
      { permission: 'customer:create',         scope: SCOPES.SHOWROOM },
      { permission: 'customer:update',         scope: SCOPES.SHOWROOM },
      { permission: 'supplier:read',           scope: SCOPES.SHOWROOM },
      { permission: 'supplier:create',         scope: SCOPES.SHOWROOM },
      { permission: 'supplier:update',         scope: SCOPES.SHOWROOM },
      { permission: 'supplier_payment:read',   scope: SCOPES.SHOWROOM },
      { permission: 'supplier_payment:create', scope: SCOPES.SHOWROOM },
      { permission: 'sales:read',              scope: SCOPES.SHOWROOM },
      { permission: 'sales:create',            scope: SCOPES.SHOWROOM },
      { permission: 'sales_installment:pay',   scope: SCOPES.SHOWROOM },
      { permission: 'expense:read',            scope: SCOPES.SHOWROOM },
      { permission: 'expense:create',          scope: SCOPES.SHOWROOM },
      { permission: 'expense:update',          scope: SCOPES.SHOWROOM },
      { permission: 'notification:read',       scope: SCOPES.SHOWROOM },
      { permission: 'notification:update',     scope: SCOPES.SHOWROOM },
      { permission: 'search:read',             scope: SCOPES.SHOWROOM },
      { permission: 'invoice:read',            scope: SCOPES.SHOWROOM },
      { permission: 'subscription:read',       scope: SCOPES.SHOWROOM },
      { permission: 'license:read',            scope: SCOPES.SHOWROOM },
      { permission: 'onboarding:read',         scope: SCOPES.SHOWROOM },
      { permission: 'profile:read',            scope: SCOPES.SELF },
      { permission: 'profile:update',          scope: SCOPES.SELF },
      { permission: 'auth:password',           scope: SCOPES.SELF },
    ],
  },

  OWNER: {
    name:        'OWNER',
    description: 'Showroom owner — everything STAFF can do plus owner-only destructive/administrative actions',
    scope:       SCOPES.SHOWROOM,
    permissions: [
      // Everything STAFF can do (parity superset)
      { permission: 'dashboard:read',          scope: SCOPES.SHOWROOM },
      { permission: 'inventory:read',          scope: SCOPES.SHOWROOM },
      { permission: 'inventory:create',        scope: SCOPES.SHOWROOM },
      { permission: 'inventory:update',        scope: SCOPES.SHOWROOM },
      { permission: 'customer:read',           scope: SCOPES.SHOWROOM },
      { permission: 'customer:create',         scope: SCOPES.SHOWROOM },
      { permission: 'customer:update',         scope: SCOPES.SHOWROOM },
      { permission: 'supplier:read',           scope: SCOPES.SHOWROOM },
      { permission: 'supplier:create',         scope: SCOPES.SHOWROOM },
      { permission: 'supplier:update',         scope: SCOPES.SHOWROOM },
      { permission: 'supplier_payment:read',   scope: SCOPES.SHOWROOM },
      { permission: 'supplier_payment:create', scope: SCOPES.SHOWROOM },
      { permission: 'sales:read',              scope: SCOPES.SHOWROOM },
      { permission: 'sales:create',            scope: SCOPES.SHOWROOM },
      { permission: 'sales_installment:pay',   scope: SCOPES.SHOWROOM },
      { permission: 'expense:read',            scope: SCOPES.SHOWROOM },
      { permission: 'expense:create',          scope: SCOPES.SHOWROOM },
      { permission: 'expense:update',          scope: SCOPES.SHOWROOM },
      { permission: 'notification:read',       scope: SCOPES.SHOWROOM },
      { permission: 'notification:update',     scope: SCOPES.SHOWROOM },
      { permission: 'search:read',             scope: SCOPES.SHOWROOM },
      { permission: 'invoice:read',            scope: SCOPES.SHOWROOM },
      { permission: 'subscription:read',       scope: SCOPES.SHOWROOM },
      { permission: 'license:read',            scope: SCOPES.SHOWROOM },
      { permission: 'onboarding:read',         scope: SCOPES.SHOWROOM },
      { permission: 'profile:read',            scope: SCOPES.SELF },
      { permission: 'profile:update',          scope: SCOPES.SELF },
      { permission: 'auth:password',           scope: SCOPES.SELF },
      // Owner-only (legacy ownerOnly guards)
      { permission: 'inventory:delete',        scope: SCOPES.SHOWROOM },
      { permission: 'inventory:reactivate',    scope: SCOPES.SHOWROOM },
      { permission: 'customer:delete',         scope: SCOPES.SHOWROOM },
      { permission: 'customer:reactivate',     scope: SCOPES.SHOWROOM },
      { permission: 'supplier:delete',         scope: SCOPES.SHOWROOM },
      { permission: 'supplier:reactivate',     scope: SCOPES.SHOWROOM },
      { permission: 'sales:cancel',            scope: SCOPES.SHOWROOM },
      { permission: 'expense:delete',          scope: SCOPES.SHOWROOM },
      { permission: 'notification:delete',     scope: SCOPES.SHOWROOM },
      { permission: 'activity:read',           scope: SCOPES.SHOWROOM },
      { permission: 'onboarding:update',       scope: SCOPES.SHOWROOM },
      { permission: 'user:create',             scope: SCOPES.SHOWROOM },
      // Phase 4 — owner purchases/manages the showroom's subscription
      { permission: 'subscription:create',     scope: SCOPES.SHOWROOM },
    ],
  },
};

// ── Pure helpers (unit-testable, no IO) ──────────────────────

/** Strict key format: single resource:action pair, lowercase [a-z_] tokens. */
function assertValidPermissionKey(key) {
  return typeof key === 'string' && /^[a-z_]+:[a-z_]+$/.test(key) && !key.includes('*');
}

/** Validate key exists in the catalog (fail closed on unknown keys). */
function isCatalogPermission(key) {
  return PERMISSIONS.some((p) => p.key === key);
}

/**
 * Platform-administration keys (resource prefix `platform_`).
 * These are runtime-only grants held by delegated GLOBAL-scope
 * profiles — never by the seeded parity profiles, never at
 * SHOWROOM/SELF scope. see the PERMISSIONS section comment.
 */
function isPlatformPermission(key) {
  return PERMISSIONS.some((p) => p.key === key && p.resource.startsWith('platform_'));
}

/**
 * buildEffectiveAuthorization — pure resolver over a profile's
 * assignment records (as returned by the DB adapter or seeded
 * directly from PROFILE_DEFINITIONS).
 *
 * records: [{ permission: 'x:y', scope: 'SHOWROOM' }]
 * Returns: { profile, scope, permissions: [...records], has(permission, scope) }
 */
function buildEffectiveAuthorization(profileName, scope, records = []) {
  const list = records.map((r) => ({ permission: r.permission, scope: r.scope }));
  return {
    profile: profileName,
    scope,
    permissions: list,
    has(permission, requiredScope = SCOPES.SHOWROOM) {
      return list.some(
        (r) => r.permission === permission && r.scope === requiredScope
      );
    },
  };
}

/** hasPermission — raw check over a records array (no profile object needed). */
function hasPermission(records, permission, requiredScope = SCOPES.SHOWROOM) {
  return records.some(
    (r) => r.permission === permission && r.scope === requiredScope
  );
}

/** Does the granted set fully contain the required set (same permission AND same scope)? */
function containsAll(grantedRecords, requiredRecords) {
  return requiredRecords.every((req) => hasPermission(grantedRecords, req.permission, req.scope));
}

module.exports = {
  SCOPES,
  PROTECTED_SYSTEM_AUTHORITY,
  PERMISSIONS,
  PROFILE_DEFINITIONS,
  assertValidPermissionKey,
  isCatalogPermission,
  isPlatformPermission,
  buildEffectiveAuthorization,
  hasPermission,
  containsAll,
};