// ============================================================
// YS-MATRIX ERP — Authorization Seeder (Phase 1)
//
// Idempotent: safe to run any number of times, additive only —
// never deletes catalog rows, never touches user/business data.
// Syncs src/services/permissionCatalog.js (the single source of
// truth) into the permission / profiles / profile_permissions
// tables. Used by:
//   • npm run db:seed:authz        (dev/prod-style seeding)
//   • tests/helpers/fixtures.js    (integration test DB)
//
// Definitions:
//   • Permissions are upserted by key (resource:action).
//   • Profiles (OWNER / STAFF) are upserted by name; is_system
//     true — parity profiles are system-managed.
//   • ProfilePermission rows are inserted when missing (skip
//     duplicates) — the compound unique key profile_id +
//     permission_id + scope makes this safe under concurrency.
// ============================================================

'use strict';

const { baseClient: db } = require('../config/database');
const { PROFILE_DEFINITIONS, PERMISSIONS } = require('../services/permissionCatalog');

async function seedAuthorization() {
  // ── Permissions ─────────────────────────────────────────────
  for (const p of PERMISSIONS) {
    await db.permission.upsert({
      where:       { key: p.key },
      update:      { resource: p.resource, action: p.action, description: p.description },
      create:      { key: p.key, resource: p.resource, action: p.action, description: p.description },
    });
  }

  // ── Profiles + assignments ──────────────────────────────────
  for (const def of Object.values(PROFILE_DEFINITIONS)) {
    const profile = await db.profile.upsert({
      where:  { name: def.name },
      update: { description: def.description, scope: def.scope, is_system: true },
      create: {
        name:        def.name,
        description: def.description,
        scope:       def.scope,
        is_system:   true,
      },
    });

    if (def.permissions.length === 0) continue;

    // Resolve permission ids for this profile's grants (catalog
    // guarantees they exist — created above).
    const keys   = [...new Set(def.permissions.map((g) => g.permission))];
    const permRows = await db.permission.findMany({ where: { key: { in: keys } } });
    const permIdByKey = new Map(permRows.map((r) => [r.key, r.id]));

    await db.profilePermission.createMany({
      data: def.permissions
        .filter((g) => permIdByKey.has(g.permission))
        .map((g) => ({
          profile_id:    profile.id,
          permission_id: permIdByKey.get(g.permission),
          scope:         g.scope,
        })),
      skipDuplicates: true,
    });
  }

  return { permissions: PERMISSIONS.length, profiles: Object.keys(PROFILE_DEFINITIONS).length };
}

// Direct CLI execution (npm run db:seed:authz)
if (require.main === module) {
  seedAuthorization()
    .then((summary) => {
      // eslint-disable-next-line no-console
      console.log(`[AUTHZ-SEED] PASS — ${summary.permissions} permissions, ${summary.profiles} profiles synced.`);
      process.exit(0);
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[AUTHZ-SEED] FAIL —', err.message);
      process.exit(1);
    });
}

module.exports = { seedAuthorization };