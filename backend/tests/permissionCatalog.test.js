'use strict';
// Phase 1 (Authorization Foundation) — permission catalog
// invariants. PURE unit tests: no DB, no network.
// These encode the PARITY CONTRACT: the catalog must reproduce
// exactly the legacy route/guard behavior mapped in the Phase 1
// readiness scan — nothing broader, nothing missing.
const test = require('node:test');
const assert = require('node:assert');

const {
  SCOPES,
  PERMISSIONS,
  PROFILE_DEFINITIONS,
  PROTECTED_SYSTEM_AUTHORITY,
  assertValidPermissionKey,
  isCatalogPermission,
  isPlatformPermission,
  buildEffectiveAuthorization,
  hasPermission,
  containsAll,
} = require('../src/services/permissionCatalog');

const staffRecords = PROFILE_DEFINITIONS.STAFF.permissions;
const ownerRecords = PROFILE_DEFINITIONS.OWNER.permissions;
const staffKeys    = new Set(staffRecords.map((r) => r.permission));
const ownerKeys    = new Set(ownerRecords.map((r) => r.permission));

test('catalog: every permission key is strict resource:action, no wildcards', () => {
  assert.ok(PERMISSIONS.length > 0);
  for (const p of PERMISSIONS) {
    assert.ok(assertValidPermissionKey(p.key), `invalid key format: ${p.key}`);
    assert.ok(!p.key.includes('*'), `wildcard forbidden: ${p.key}`);
    assert.strictEqual(p.key, `${p.resource}:${p.action}`, 'key must equal resource:action');
    assert.ok(isCatalogPermission(p.key), 'key must resolve in catalog');
  }
});

test('catalog: keys are unique and resources/actions are single tokens', () => {
  const keys = PERMISSIONS.map((p) => p.key);
  assert.strictEqual(new Set(keys).size, keys.length, 'duplicate keys');
  for (const k of keys) {
    assert.strictEqual(k.split(':').length, 2, 'exactly one colon per key');
  }
});

test('catalog: SCOPES are exactly the formalized set (SHOWROOM, SELF, reserved GLOBAL)', () => {
  assert.strictEqual(SCOPES.SHOWROOM, 'SHOWROOM');
  assert.strictEqual(SCOPES.SELF, 'SELF');
  assert.strictEqual(SCOPES.GLOBAL, 'GLOBAL');
});

test('catalog: SUPER_ADMIN is NOT a profile — protected system authority', () => {
  assert.deepStrictEqual(Object.keys(PROFILE_DEFINITIONS).sort(), ['OWNER', 'STAFF']);
  assert.strictEqual(PROTECTED_SYSTEM_AUTHORITY.role, 'SUPER_ADMIN');
  assert.strictEqual(PROTECTED_SYSTEM_AUTHORITY.scope, SCOPES.GLOBAL);
  const allKeys = PERMISSIONS.map((p) => p.key);
  assert.ok(!allKeys.some((k) => k.startsWith('super_admin')), 'no SUPER_ADMIN permission records');
});

test('catalog: every granted permission exists in the catalog', () => {
  for (const rec of [...staffRecords, ...ownerRecords]) {
    assert.ok(isCatalogPermission(rec.permission), `unknown grant: ${rec.permission}`);
  }
});

test('catalog: all grant scopes are only SHOWROOM or SELF (no GLOBAL grants in Phase 1)', () => {
  for (const rec of [...staffRecords, ...ownerRecords]) {
    assert.ok(
      rec.scope === SCOPES.SHOWROOM || rec.scope === SCOPES.SELF,
      `unexpected scope ${rec.scope} on ${rec.permission}`
    );
  }
});

test('catalog: SELF-scope grants are limited to own-profile/session resources', () => {
  const SELF_ALLOWED = new Set(['profile:read', 'profile:update', 'auth:password']);
  const selfRecs = [...staffRecords, ...ownerRecords].filter((r) => r.scope === SCOPES.SELF);
  assert.ok(selfRecs.length >= 3, 'self-service permissions must exist');
  for (const rec of selfRecs) {
    assert.ok(SELF_ALLOWED.has(rec.permission), `SELF grant outside allowed set: ${rec.permission}`);
  }
});

test('catalog: STAFF ⊆ OWNER (same permission AND same scope) — no own-only widenings', () => {
  for (const rec of staffRecords) {
    assert.ok(
      ownerRecords.some(
        (o) => o.permission === rec.permission && o.scope === rec.scope
      ),
      `OWNER missing STAFF grant: ${rec.permission}@${rec.scope}`
    );
  }
});

test('catalog: owner-only parity — legacy ownerOnly surfacing, absent from STAFF', () => {
  const ownerOnlyPerms = [
    'inventory:delete', 'inventory:reactivate',
    'customer:delete', 'customer:reactivate',
    'supplier:delete', 'supplier:reactivate',
    'sales:cancel', 'expense:delete', 'notification:delete',
    'activity:read', 'onboarding:update', 'user:create',
  ];
  for (const k of ownerOnlyPerms) {
    assert.ok(ownerKeys.has(k), `OWNER must hold ${k}`);
    assert.ok(!staffKeys.has(k), `STAFF must NOT hold ${k}`);
  }
});

test('catalog: staff parity — every current STAFF capability is present', () => {
  const staffMustHave = [
    'dashboard:read',
    'inventory:read', 'inventory:create', 'inventory:update',
    'customer:read', 'customer:create', 'customer:update',
    'supplier:read', 'supplier:create', 'supplier:update',
    'supplier_payment:read', 'supplier_payment:create',
    'sales:read', 'sales:create', 'sales_installment:pay',
    'expense:read', 'expense:create', 'expense:update',
    'notification:read', 'notification:update',
    'search:read', 'invoice:read', 'subscription:read', 'license:read',
    'onboarding:read',
    'profile:read', 'profile:update', 'auth:password',
  ];
  for (const k of staffMustHave) {
    assert.ok(staffKeys.has(k), `STAFF must hold ${k}`);
  }
});

test('catalog: every catalog permission is granted to at least one profile (no unused/secret perms)', () => {
  for (const p of PERMISSIONS) {
    if (isPlatformPermission(p.key)) continue; // runtime-only grants (Phase 2)
    assert.ok(
      staffKeys.has(p.key) || ownerKeys.has(p.key),
      `permission ${p.key} exists but is granted nowhere`
    );
  }
});

test('catalog: platform permissions are runtime-only — never seeded into parity profiles', () => {
  const platformKeys = PERMISSIONS.filter((p) => isPlatformPermission(p.key)).map((p) => p.key);
  assert.ok(platformKeys.length > 0, 'Phase 2 platform permissions must exist');
  for (const rec of [...staffRecords, ...ownerRecords]) {
    assert.ok(!isPlatformPermission(rec.permission), `parity profile holds platform grant: ${rec.permission}`);
  }
  assert.ok(
    platformKeys.every((k) => k.startsWith('platform_') && !staffKeys.has(k) && !ownerKeys.has(k)),
    'platform grants must never appear in STAFF/OWNER definitions'
  );
});

test('catalog: platform permissions cannot be granted at SHOWROOM/SELF scope (GLOBAL-only contract)', () => {
  const platformKeys = PERMISSIONS.filter((p) => isPlatformPermission(p.key)).map((p) => p.key);
  assert.ok(platformKeys.length > 0);
  for (const k of platformKeys) {
    assert.ok(!staffKeys.has(k) && !ownerKeys.has(k), `platform grant must be GLOBAL-only: ${k}`);
  }

  const eff = buildEffectiveAuthorization('OWNER', SCOPES.SHOWROOM, ownerRecords);
  for (const k of platformKeys) {
    assert.ok(!eff.has(k, SCOPES.SHOWROOM) && !eff.has(k, SCOPES.SELF), 'resolver must deny platform keys at non-GLOBAL scopes');
  }
});

test('resolver pure: buildEffectiveAuthorization + hasPermission decide correctly', () => {
  const eff = buildEffectiveAuthorization('STAFF', SCOPES.SHOWROOM, staffRecords);
  assert.strictEqual(eff.profile, 'STAFF');
  assert.strictEqual(eff.scope, SCOPES.SHOWROOM);
  assert.ok(eff.has('customer:create', SCOPES.SHOWROOM));
  assert.ok(eff.has('profile:update', SCOPES.SELF), 'self-scope grant must resolve');
  assert.ok(!eff.has('sales:cancel', SCOPES.SHOWROOM), 'STAFF must not hold sales:cancel');
  assert.ok(!eff.has('customer:create', SCOPES.SELF), 'same permission, wrong scope → deny');
});

test('resolver pure: fail closed on unknown permission / unknown profile / unknown scope', () => {
  const eff = buildEffectiveAuthorization('OWNER', SCOPES.SHOWROOM, ownerRecords);
  assert.ok(!eff.has('doesnotexist:read', SCOPES.SHOWROOM), 'unknown permission → deny');
  assert.ok(!eff.has('customer:read', 'PLANET'), 'unknown scope → deny');

  const empty = buildEffectiveAuthorization('STRANGER_ROLE', SCOPES.SHOWROOM, []);
  assert.strictEqual(empty.permissions.length, 0);
  assert.ok(!empty.has('customer:read', SCOPES.SHOWROOM), 'unknown profile (no grants) → deny');
});

test('resolver pure: containsAll implements granted ⊆ required at the same scope', () => {
  assert.ok(containsAll(ownerRecords, staffRecords), 'OWNER contains all STAFF grants');
  assert.ok(!containsAll(staffRecords, ownerRecords), 'STAFF does not contain OWNER grants');
  assert.ok(!containsAll(ownerRecords, [{ permission: 'customer:read', scope: SCOPES.SELF }]),
    'same key different scope must not be counted as contained');
});