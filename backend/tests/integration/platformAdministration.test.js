'use strict';
// Phase 2 (Slice 1 — Delegated Platform Administrators) — end-to-end
// tests for the /api/v1/admin surface: real Express app, real test
// DB, real middleware. Negative-first matrix:
//   • surface guards (scope + permission) lock out non-GLOBAL actors
//   • schema rejects reserved/impossible profile+grant shapes
//   • system profiles immutable, in-use profiles undeletable
//   • delegated admins can never amplify (created ⊆ held, scope
//     containment) — validated server-side on every mutation
//   • disable is immediate; password reset revokes refresh tokens
// =============================================================

const test = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, api, db } = require('../helpers/harness');
const { seedAll, tokenFor, IDS, PASSWORD , unlockAll} = require('../helpers/fixtures');

let base;
let sa, ownerA, staffA;

const admin = (method, p, opts = {}) => api(base, method, `/admin${p}`, opts);
const login = async (email, password = PASSWORD) => {
  const r = await api(base, 'POST', '/auth/login', {
    body: { email, password },
  });
  if (r.status !== 200) throw new Error(`login(${email}) failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.data.accessToken;
};

const auditVisible = async (action, user_id, timeoutMs = 1500, match = null) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const hits = await db.baseClient.auditLog.findMany({
      where: { action, user_id },
      orderBy: { created_at: 'desc' },
      take: 10,
    });
    const hit = hits.find((h) => !match || match(h));
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 50));
  }
  return null;
};

// ── Test fixtures (created through the API itself) ────────────
let bossProfileId, viewerProfileId, managerProfileId;
let regionalProfileId, regionalProfileRowId;
let bossId, bossToken, viewerId, viewerToken, managerId, managerToken;

// The full delegated-authority bundle this slice formalizes.
const FULL_PLATFORM_PERMS = [
  { permission: 'platform_profile:read',   scope: 'GLOBAL' },
  { permission: 'platform_profile:create', scope: 'GLOBAL' },
  { permission: 'platform_profile:update', scope: 'GLOBAL' },
  { permission: 'platform_profile:delete', scope: 'GLOBAL' },
  { permission: 'platform_admin:read',     scope: 'GLOBAL' },
  { permission: 'platform_admin:create',   scope: 'GLOBAL' },
  { permission: 'platform_admin:update',   scope: 'GLOBAL' },
  { permission: 'platform_user:read',      scope: 'GLOBAL' },
  { permission: 'platform_showroom:read',  scope: 'GLOBAL' },
];

const PERSONNEL_PERMS = [
  { permission: 'platform_profile:read',   scope: 'GLOBAL' },
  { permission: 'platform_profile:create', scope: 'GLOBAL' },
  { permission: 'platform_admin:read',     scope: 'GLOBAL' },
  { permission: 'platform_user:read',      scope: 'GLOBAL' },
  { permission: 'platform_showroom:read',  scope: 'GLOBAL' },
];

const VIEWER_PERMS = [
  { permission: 'platform_profile:read',  scope: 'GLOBAL' },
  { permission: 'platform_showroom:read', scope: 'GLOBAL' },
  { permission: 'platform_user:read',     scope: 'GLOBAL' },
];

test.before(async () => {
  base = await startServer();
  await seedAll();
  sa     = await tokenFor(base, 'sa@test.local');
  ownerA = await tokenFor(base, 'owner-a@test.local');
  staffA = await tokenFor(base, 'staff-a@test.local');
});

test.after(async () => {
  await unlockAll();
  await stopServer();
});

// ── 1. Surface guards ─────────────────────────────────────────
test('platform admin: unauthenticated and non-GLOBAL actors are locked out', async () => {
  const anon  = await admin('GET', '/profiles');
  assert.strictEqual(anon.status, 401);
  assert.strictEqual(anon.body.code, 'TOKEN_MISSING', 'authenticate rejects before any scope logic');

  const staffProfiles = await admin('GET', '/profiles', { token: staffA });
  assert.strictEqual(staffProfiles.status, 403, 'STAFF has no GLOBAL scope');
  assert.strictEqual(staffProfiles.body.code, 'INSUFFICIENT_SCOPE');

  const ownerAdmins = await admin('GET', '/administrators', { token: ownerA });
  assert.strictEqual(ownerAdmins.status, 403, 'OWNER has no GLOBAL scope');
  assert.strictEqual(ownerAdmins.body.code, 'INSUFFICIENT_SCOPE');

  const staffUsers = await admin('GET', '/users', { token: staffA });
  assert.strictEqual(staffUsers.status, 403);

  const ownerCreate = await admin('POST', '/profiles', {
    token: ownerA,
    body:  { name: 'HACKER', scope: 'GLOBAL', permissions: [{ permission: 'platform_profile:read', scope: 'GLOBAL' }] },
  });
  assert.strictEqual(ownerCreate.status, 403, 'POST is scope-gated before anything else');
});

// ── 2. Profile schema negatives ───────────────────────────────
test('platform admin: impossible profile shapes are rejected by validation', async () => {
  const baseBody = (over = {}) => ({
    name:        'VALID_PROFILE',
    scope:       'GLOBAL',
    permissions: [{ permission: 'platform_profile:read', scope: 'GLOBAL' }],
    ...over,
  });

  const cases = [
    ['lowercase name',        baseBody({ name: 'dept_admin' })],
    ['reserved OWNER',        baseBody({ name: 'OWNER' })],
    ['reserved SUPER_ADMIN',  baseBody({ name: 'SUPER_ADMIN' })],
    ['too short name',        baseBody({ name: 'AB' })],
    ['empty permissions',     baseBody({ permissions: [] })],
    ['missing permissions',   baseBody({ permissions: undefined })],
    ['platform grant @SHOWROOM', baseBody({ permissions: [{ permission: 'platform_profile:read', scope: 'SHOWROOM' }] })],
    ['showroom grant @GLOBAL',  baseBody({ permissions: [{ permission: 'customer:read', scope: 'GLOBAL' }] })],
    ['missing scope on showroom grant', baseBody({ permissions: [{ permission: 'customer:read' }] })],
    ['wildcard import',       baseBody({ permissions: [{ permission: 'platform_profile:*', scope: 'GLOBAL' }] })],
    ['unknown key',           baseBody({ permissions: [{ permission: 'ghost:read', scope: 'GLOBAL' }] })],
    ['duplicate grant',       baseBody({ permissions: [
      { permission: 'platform_profile:read', scope: 'GLOBAL' },
      { permission: 'platform_profile:read', scope: 'GLOBAL' },
    ] })],
  ];

  for (const [label, body] of cases) {
    const r = await admin('POST', '/profiles', { token: sa, body });
    assert.strictEqual(r.status, 400, `${label}: expected 400, got ${r.status} ${JSON.stringify(r.body)}`);
  }

  const untouched = await admin('GET', '/profiles', { token: sa });
  assert.strictEqual(untouched.body.data.length, 2, 'only the two seeded parity profiles exist');
});

// ── 3. SA creates platform profiles ───────────────────────────
test('platform admin: SUPER_ADMIN creates GLOBAL + SHOWROOM profiles (audited)', async () => {
  const supervisor = await admin('POST', '/profiles', {
    token: sa,
    body:  { name: 'PLATFORM_SUPERVISOR', description: 'Full delegated authority', scope: 'GLOBAL', permissions: FULL_PLATFORM_PERMS },
  });
  assert.strictEqual(supervisor.status, 201, JSON.stringify(supervisor.body));
  bossProfileId = supervisor.body.data.id;
  assert.strictEqual(supervisor.body.data.is_system, false);
  assert.strictEqual(supervisor.body.data.scope, 'GLOBAL');

  const regional = await admin('POST', '/profiles', {
    token: sa,
    body:  { name: 'REGIONAL_VIEWER', scope: 'SHOWROOM', permissions: [{ permission: 'customer:read', scope: 'SHOWROOM' }] },
  });
  assert.strictEqual(regional.status, 201, JSON.stringify(regional.body));
  regionalProfileId = regional.body.data.id;

  const dup = await admin('POST', '/profiles', {
    token: sa,
    body:  { name: 'PLATFORM_SUPERVISOR', scope: 'GLOBAL', permissions: FULL_PLATFORM_PERMS },
  });
  assert.strictEqual(dup.status, 409, 'duplicate profile name conflicts');
  assert.strictEqual(dup.body.code, 'PROFILE_NAME_TAKEN');

  const list = await admin('GET', '/profiles', { token: sa });
  assert.strictEqual(list.status, 200);
  const names = list.body.data.map((p) => p.name);
  assert.ok(names.includes('PLATFORM_SUPERVISOR') && names.includes('REGIONAL_VIEWER'));
  const sup = list.body.data.find((p) => p.name === 'PLATFORM_SUPERVISOR');
  assert.strictEqual(sup.scope, 'GLOBAL');
  assert.strictEqual(sup.in_use, 0, 'no users yet');
  assert.deepStrictEqual(
    sup.permissions.map((g) => `${g.scope}:${g.permission}`).sort(),
    FULL_PLATFORM_PERMS.map((g) => `${g.scope}:${g.permission}`).sort()
  );

  const evt = await auditVisible('PROFILE_CREATED', IDS.sa, 1500, (h) => h.new_data?.name === 'PLATFORM_SUPERVISOR');
  assert.ok(evt, 'PROFILE_CREATED audit event written');
  assert.strictEqual(evt.new_data.name, 'PLATFORM_SUPERVISOR');
});

// ── 4. System parity profiles are immutable ──────────────────
test('platform admin: system profiles (OWNER/STAFF) can never be mutated or deleted', async () => {
  const ownerRow = await db.baseClient.profile.findUnique({ where: { name: 'OWNER' } });

  const patch = await admin('PATCH', `/profiles/${ownerRow.id}`, {
    token: sa,
    body:  { granted: [{ permission: 'customer:read', scope: 'SHOWROOM' }] },
  });
  assert.strictEqual(patch.status, 403);
  assert.strictEqual(patch.body.code, 'SYSTEM_PROFILE_PROTECTED');

  const del = await admin('DELETE', `/profiles/${ownerRow.id}`, { token: sa });
  assert.strictEqual(del.status, 403);
  assert.strictEqual(del.body.code, 'SYSTEM_PROFILE_PROTECTED');

  const still = await db.baseClient.profile.findUnique({ where: { name: 'OWNER' } });
  assert.ok(still, 'OWNER row untouched');
});

// ── 5. Administrators — creation rules ────────────────────────
test('platform admin: SUPER_ADMIN creates a delegated administrator on the system showroom', async () => {
  const created = await admin('POST', '/administrators', {
    token: sa,
    body:  { name: 'Boss Admin', email: 'boss@test.local', password: PASSWORD, profile_id: bossProfileId },
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  bossId = created.body.data.id;
  assert.strictEqual(created.body.data.profile_id, bossProfileId);
  assert.strictEqual(created.body.data.profile.name, 'PLATFORM_SUPERVISOR');
  assert.strictEqual(created.body.data.profile.scope, 'GLOBAL');
  assert.strictEqual(created.body.data.role, 'OWNER', 'legacy envelope role');
  assert.strictEqual(created.body.data.showroom.id, 'sh-sys', 'lives on the system showroom');

  const row = await db.baseClient.user.findUnique({ where: { id: bossId } });
  assert.strictEqual(row.showroom_id, 'sh-sys');
  assert.ok(row.profile_id, 'profile_id persisted');

  bossToken = await login('boss@test.local');
  const me = await api(base, 'GET', '/auth/me', { token: bossToken });
  const authz = me.body.data.authorization;
  assert.strictEqual(authz.profile, 'PLATFORM_SUPERVISOR', 'DB-resolved delegated profile');
  assert.strictEqual(authz.scope, 'GLOBAL');
  assert.ok(authz.permissions.some((g) => g.permission === 'platform_admin:create'), 'grants resolved');

  const evt = await auditVisible('ADMIN_CREATED', IDS.sa);
  assert.ok(evt, 'ADMIN_CREATED audit event written');
  assert.strictEqual(evt.new_data.profile_name, 'PLATFORM_SUPERVISOR');
});

test('platform admin: forbidden profile targets for administrators fail closed', async () => {
  const ownerRow = await db.baseClient.profile.findUnique({ where: { name: 'OWNER' } });

  const systemProfile = await admin('POST', '/administrators', {
    token: sa,
    body:  { name: 'Sys X', email: 'x@test.local', password: PASSWORD, profile_id: ownerRow.id },
  });
  assert.strictEqual(systemProfile.status, 403, 'system profile is not an administrator profile');
  assert.strictEqual(systemProfile.body.code, 'SYSTEM_PROFILE_PROTECTED');

  const nonGlobal = await admin('POST', '/administrators', {
    token: sa,
    body:  { name: 'Local Y', email: 'y@test.local', password: PASSWORD, profile_id: regionalProfileId },
  });
  assert.strictEqual(nonGlobal.status, 403, 'SHOWROOM-scope profile cannot carry an administrator');
  assert.strictEqual(nonGlobal.body.code, 'PROFILE_NOT_GLOBAL');

  const ghost = await admin('POST', '/administrators', {
    token: sa,
    body:  { name: 'Ghost Z', email: 'z@test.local', password: PASSWORD, profile_id: 'profile-ghost' },
  });
  assert.strictEqual(ghost.status, 404);

  const dupEmail = await admin('POST', '/administrators', {
    token: sa,
    body:  { name: 'Boss Clone', email: 'boss@test.local', password: PASSWORD, profile_id: bossProfileId },
  });
  assert.strictEqual(dupEmail.status, 400, 'email uniqueness enforced');
});

// ── 6. Delegated administration in action ─────────────────────
test('platform admin: full-authority delegate can manage profiles, admins, and read surfaces', async () => {
  const profiles = await admin('GET', '/profiles', { token: bossToken });
  assert.strictEqual(profiles.status, 200);
  assert.ok(profiles.body.data.some((p) => p.name === 'PLATFORM_SUPERVISOR'));

  const users = await admin('GET', '/users', { token: bossToken });
  assert.strictEqual(users.status, 200);
  assert.ok(users.body.data.length >= 1, 'platform users readable');

  const showrooms = await admin('GET', '/showrooms', { token: bossToken });
  assert.strictEqual(showrooms.status, 200);
  assert.strictEqual(showrooms.body.data.length, 6, 'all seeded showrooms visible');

  const admins = await admin('GET', '/administrators', { token: bossToken });
  assert.strictEqual(admins.status, 200);
  assert.ok(admins.body.data.some((u) => u.email === 'boss@test.local'));

  // Delegation: the delegate creates child profiles + admins it has
  // authority for (containment holds — FULL ⊆ FULL).
  const manager = await admin('POST', '/profiles', {
    token: bossToken,
    body:  { name: 'PLATFORM_MANAGER', scope: 'GLOBAL', permissions: FULL_PLATFORM_PERMS },
  });
  assert.strictEqual(manager.status, 201, `delegate creates profile: ${JSON.stringify(manager.body)}`);
  managerProfileId = manager.body.data.id;

  const managerAdmin = await admin('POST', '/administrators', {
    token: bossToken,
    body:  { name: 'Manager Admin', email: 'manager@test.local', password: PASSWORD, profile_id: managerProfileId },
  });
  assert.strictEqual(managerAdmin.status, 201, 'delegate creates another administrator');
  managerId = managerAdmin.body.data.id;
  managerToken = await login('manager@test.local');
});

test('platform admin: read-only delegate is denied every write (granular permissions)', async () => {
  const viewerProfile = await admin('POST', '/profiles', {
    token: sa,
    body:  { name: 'PLATFORM_VIEWER', scope: 'GLOBAL', permissions: VIEWER_PERMS },
  });
  assert.strictEqual(viewerProfile.status, 201, JSON.stringify(viewerProfile.body));
  viewerProfileId = viewerProfile.body.data.id;

  const created = await admin('POST', '/administrators', {
    token: sa,
    body:  { name: 'Viewer Admin', email: 'viewer@test.local', password: PASSWORD, profile_id: viewerProfileId },
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  viewerId = created.body.data.id;
  viewerToken = await login('viewer@test.local');

  assert.strictEqual((await admin('GET', '/profiles', { token: viewerToken })).status, 200);
  assert.strictEqual((await admin('GET', '/users', { token: viewerToken })).status, 200);
  assert.strictEqual((await admin('GET', '/showrooms', { token: viewerToken })).status, 200);

  const createProfile = await admin('POST', '/profiles', {
    token: viewerToken,
    body:  { name: 'STOLEN', scope: 'GLOBAL', permissions: FULL_PLATFORM_PERMS },
  });
  assert.strictEqual(createProfile.status, 403);
  assert.strictEqual(createProfile.body.code, 'INSUFFICIENT_PERMISSION');

  const listAdmins = await admin('GET', '/administrators', { token: viewerToken });
  assert.strictEqual(listAdmins.status, 403, 'no platform_admin:read');
  assert.strictEqual(listAdmins.body.code, 'INSUFFICIENT_PERMISSION');

  const patchSup = await admin('PATCH', `/profiles/${bossProfileId}`, {
    token: viewerToken,
    body:  { granted: [{ permission: 'platform_admin:read', scope: 'GLOBAL' }] },
  });
  assert.strictEqual(patchSup.status, 403, 'no platform_profile:update');
});

test('platform admin: no privilege amplification — a delegate can never grant what it does not hold', async () => {
  // Mid-tier delegate: can CREATE profiles but only grants it also holds.
  const personnelProfile = await admin('POST', '/profiles', {
    token: sa,
    body:  { name: 'PLATFORM_PERSONNEL', scope: 'GLOBAL', permissions: PERSONNEL_PERMS },
  });
  assert.strictEqual(personnelProfile.status, 201, JSON.stringify(personnelProfile.body));

  const personnelAdmin = await admin('POST', '/administrators', {
    token: sa,
    body:  { name: 'Personnel Admin', email: 'personnel@test.local', password: PASSWORD, profile_id: personnelProfile.body.data.id },
  });
  assert.strictEqual(personnelAdmin.status, 201, JSON.stringify(personnelAdmin.body));
  const personnelId   = personnelAdmin.body.data.id;
  const personnelToken = await login('personnel@test.local');

  // Contained creation succeeds (granted ⊆ held: platform_admin:read ⊂ personnel).
  const reporter = await admin('POST', '/profiles', {
    token: personnelToken,
    body:  { name: 'REPORTER', scope: 'GLOBAL', permissions: [{ permission: 'platform_admin:read', scope: 'GLOBAL' }] },
  });
  assert.strictEqual(reporter.status, 201, `contained delegation allowed: ${JSON.stringify(reporter.body)}`);

  // Amplification attempt — granting platform_admin:create (not held) → rejected
  // server-side by validateProfileTarget, NOT just by the route permission.
  const amplify = await admin('POST', '/profiles', {
    token: personnelToken,
    body:  { name: 'AMPLIFIER', scope: 'GLOBAL', permissions: [{ permission: 'platform_admin:create', scope: 'GLOBAL' }] },
  });
  assert.strictEqual(amplify.status, 403, 'creating a permission the actor lacks must be rejected');
  assert.strictEqual(amplify.body.code, 'INSUFFICIENT_ROLE');

  const evt = await auditVisible('AUTHZ_ESCALATION_ATTEMPT', personnelId);
  assert.ok(evt, 'amplification attempt is audited');

  const check = await admin('GET', '/profiles', { token: sa });
  assert.ok(!check.body.data.some((p) => p.name === 'AMPLIFIER'), 'no partial profile leaked through');
});

test('platform admin: read-only delegate is denied every write (granular permissions)', async () => {
  const readerPerms = [
    { permission: 'platform_admin:read', scope: 'GLOBAL' },
  ];

  const readerProfile = await admin('POST', '/profiles', {
    token: sa,
    body:  { name: 'PLATFORM_READER', scope: 'GLOBAL', permissions: readerPerms },
  });
  assert.strictEqual(readerProfile.status, 201, JSON.stringify(readerProfile.body));

  const created = await admin('POST', '/administrators', {
    token: sa,
    body:  { name: 'Reader Admin', email: 'reader@test.local', password: PASSWORD, profile_id: readerProfile.body.data.id },
  });
  assert.strictEqual(created.status, 201, JSON.stringify(created.body));
  const readerId     = created.body.data.id;
  const readerToken  = await login('reader@test.local');

  // Elevation attempt — holding platform_admin:read must NOT imply any write.
  const escalate = await admin('POST', '/administrators', {
    token: readerToken,
    body:  { name: 'Rogue', email: 'rogue@test.local', password: PASSWORD, profile_id: readerProfile.body.data.id },
  });
  assert.strictEqual(escalate.status, 403, 'no platform_admin:create');
  assert.strictEqual(escalate.body.code, 'INSUFFICIENT_PERMISSION');

  const escalateEvt = await auditVisible('AUTHZ_ESCALATION_ATTEMPT', readerId);
  assert.ok(!escalateEvt, 'route-level denial needs no audit event (identity never reached the controller)');
});

// ── 7. Profile permission deltas ──────────────────────────────
test('platform admin: grant/revoke deltas apply and are audited', async () => {
  const grant = await admin('PATCH', `/profiles/${regionalProfileId}`, {
    token: sa,
    body:  { granted: [{ permission: 'inventory:read', scope: 'SHOWROOM' }] },
  });
  assert.strictEqual(grant.status, 200, JSON.stringify(grant.body));

  let list = await admin('GET', '/profiles', { token: sa });
  let regional = list.body.data.find((p) => p.id === regionalProfileId);
  assert.ok(regional.permissions.some((g) => g.permission === 'inventory:read' && g.scope === 'SHOWROOM'));

  const grantEvt = await auditVisible('PROFILE_PERMISSION_GRANTED', IDS.sa);
  assert.ok(grantEvt);
  assert.strictEqual(grantEvt.new_data.permission, 'inventory:read');

  const badGrant = await admin('PATCH', `/profiles/${regionalProfileId}`, {
    token: sa,
    body:  { granted: [{ permission: 'ghost:read', scope: 'SHOWROOM' }] },
  });
  assert.strictEqual(badGrant.status, 400, 'unknown grant still blocked at validation');

  const revoke = await admin('PATCH', `/profiles/${regionalProfileId}`, {
    token: sa,
    body:  { revoked: [{ permission: 'inventory:read', scope: 'SHOWROOM' }] },
  });
  assert.strictEqual(revoke.status, 200);

  list = await admin('GET', '/profiles', { token: sa });
  regional = list.body.data.find((p) => p.id === regionalProfileId);
  assert.ok(!regional.permissions.some((g) => g.permission === 'inventory:read'), 'revoked grant is gone');

  const revokeEvt = await auditVisible('PROFILE_PERMISSION_REVOKED', IDS.sa);
  assert.ok(revokeEvt);
  assert.strictEqual(revokeEvt.new_data.permission, 'inventory:read');
});

// ── 8. Deletion rules ─────────────────────────────────────────
test('platform admin: unused profiles delete; in-use profiles get 409; events audited', async () => {
  const unused = await admin('DELETE', `/profiles/${regionalProfileId}`, { token: sa });
  assert.strictEqual(unused.status, 200, JSON.stringify(unused.body));

  const list = await admin('GET', '/profiles', { token: sa });
  assert.ok(!list.body.data.some((p) => p.id === regionalProfileId), 'deleted profile gone');

  const delEvt = await auditVisible('PROFILE_DELETED', IDS.sa);
  assert.ok(delEvt);
  assert.strictEqual(delEvt.new_data.name, 'REGIONAL_VIEWER');

  const inUse = await admin('DELETE', `/profiles/${bossProfileId}`, { token: sa });
  assert.strictEqual(inUse.status, 409, 'profile assigned to an administrator cannot be deleted');
  assert.strictEqual(inUse.body.code, 'PROFILE_IN_USE');

  const stillThere = await admin('GET', '/profiles', { token: sa });
  assert.ok(stillThere.body.data.some((p) => p.id === bossProfileId));
});

// ── 9. Administrator lifecycle ────────────────────────────────
test('platform admin: disabling is immediate; re-enabling restores access (audited)', async () => {
  const disable = await admin('PATCH', `/administrators/${bossId}`, {
    token: sa,
    body:  { is_active: false },
  });
  assert.strictEqual(disable.status, 200, JSON.stringify(disable.body));

  const locked = await admin('GET', '/profiles', { token: bossToken });
  assert.strictEqual(locked.status, 401, 'previously-issued token is rejected immediately');
  assert.strictEqual(locked.body.code, 'ACCOUNT_DISABLED');

  const disableEvt = await auditVisible('ADMIN_DISABLED', IDS.sa);
  assert.ok(disableEvt);
  assert.strictEqual(disableEvt.entity_id, bossId);

  const enable = await admin('PATCH', `/administrators/${bossId}`, {
    token: sa,
    body:  { is_active: true },
  });
  assert.strictEqual(enable.status, 200);

  const restored = await admin('GET', '/profiles', { token: bossToken });
  assert.strictEqual(restored.status, 200, 'same token works again after re-enable');

  const enableEvt = await auditVisible('ADMIN_ENABLED', IDS.sa);
  assert.ok(enableEvt);
});

test('platform admin: profile reassignment swaps the effective authority (audited)', async () => {
  const reassign = await admin('PATCH', `/administrators/${bossId}`, {
    token: sa,
    body:  { profile_id: managerProfileId },
  });
  assert.strictEqual(reassign.status, 200, JSON.stringify(reassign.body));

  const me = await api(base, 'GET', '/auth/me', { token: bossToken });
  assert.strictEqual(me.body.data.authorization.profile, 'PLATFORM_MANAGER', 'same token, DB-resolved new profile');

  const evt = await auditVisible('ADMIN_MODIFIED', IDS.sa);
  assert.ok(evt);
  assert.strictEqual(evt.old_data.profile_id, bossProfileId);
  assert.strictEqual(evt.new_data.profile_id, managerProfileId);

  // Reassigning to a SHOWROOM-scope profile is refused.
  const bad = await db.baseClient.profile.findUnique({ where: { name: 'OWNER' } });
  const toSystem = await admin('PATCH', `/administrators/${viewerId}`, {
    token: sa,
    body:  { profile_id: bad.id },
  });
  assert.strictEqual(toSystem.status, 403);
  assert.strictEqual(toSystem.body.code, 'SYSTEM_PROFILE_PROTECTED');
});

test('platform admin: non-administrators and SUPER_ADMIN are outside this surface (404)', async () => {
  const patchOwner = await admin('PATCH', `/administrators/${IDS.ownerA}`, {
    token: sa,
    body:  { is_active: false },
  });
  assert.strictEqual(patchOwner.status, 404, 'OWNER has no administrator row');

  const patchSa = await admin('PATCH', `/administrators/${IDS.sa}`, {
    token: sa,
    body:  { is_active: false },
  });
  assert.strictEqual(patchSa.status, 404, 'SUPER_ADMIN is never an administrator row');

  const ownerRow = await db.baseClient.user.findUnique({ where: { id: IDS.ownerA } });
  assert.strictEqual(ownerRow.is_active, true, 'no state change leaked through');
}); 

// ── 10. Password lifecycle ────────────────────────────────────
test('platform admin: password reset rotates creds and revokes refresh tokens', async () => {
  const reset = await admin('POST', `/administrators/${bossId}/reset-password`, {
    token: sa,
    body:  {},
  });
  assert.strictEqual(reset.status, 200, JSON.stringify(reset.body));
  assert.ok(reset.body.data.temp_password.startsWith('Ys-'), 'auto-generated temp password returned once');
  assert.strictEqual(reset.body.data.tokens_revoked, true);

  const oldRefresh = await db.baseClient.refreshToken.findFirst({ where: { user_id: bossId } });
  assert.strictEqual(oldRefresh, null, 'sessions terminated');

  const newToken = await login('boss@test.local', reset.body.data.temp_password);
  const ok = await admin('GET', '/profiles', { token: newToken });
  assert.strictEqual(ok.status, 200, 'temp password authenticates');

  const evt = await auditVisible('ADMIN_PASSWORD_RESET', IDS.sa);
  assert.ok(evt);
  assert.strictEqual(evt.new_data.target_user, 'boss@test.local');
  assert.strictEqual(evt.new_data.password_auto_generated, true);

  const resetSa = await admin('POST', `/administrators/${IDS.sa}/reset-password`, {
    token: sa,
    body:  {},
  });
  assert.strictEqual(resetSa.status, 404, 'SUPER_ADMIN never reachable via this surface');
});

// ── 11. Delegate read parity ──────────────────────────────────
test('platform admin: manager delegate sees the platform read surfaces intact', async () => {
  const showrooms = await admin('GET', '/showrooms', { token: managerToken });
  assert.strictEqual(showrooms.status, 200);
  assert.strictEqual(showrooms.body.data.length, 6);

  const users = await admin('GET', '/users', { token: managerToken });
  assert.strictEqual(users.status, 200);
  assert.ok(users.body.data.length >= 1);

  const admins = await admin('GET', '/administrators', { token: managerToken });
  assert.strictEqual(admins.status, 200);
  const emails = admins.body.data.map((u) => u.email);
  assert.ok(emails.includes('boss@test.local'), 'delegated admins are visible to other delegates');
});