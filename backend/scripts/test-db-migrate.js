'use strict';
// ============================================================
// YS-MATRIX TEST DB MIGRATE (Phase 4 — safety)
//
// Exactly like test-db-reset.js: Prisma CLI is spawned with an
// EXPLICIT child environment built by scripts/test-env.js so the
// migration can ONLY ever touch the isolated test database
// (localhost:5433/ys_matrix_test). NODE_ENV=test + the validated
// DATABASE_URL are forced, defeating Prisma's implicit `.env`
// auto-load (the Phase 0.5 failure mode).
//
// Usage:
//   node scripts/test-db-migrate.js --name phase4_lifecycle_and_payments
//   node scripts/test-db-migrate.js --name foo --dry-run   (inspect only)
// ============================================================

const { spawnSync } = require('child_process');
const path = require('path');
const { buildChildEnv } = require('./test-env');

const NAME   = (() => {
  const i = process.argv.indexOf('--name');
  return i >= 0 ? process.argv[i + 1] : null;
})();
const DRY_RUN = process.argv.includes('--dry-run');

if (!NAME) {
  console.error('[MIGRATE] ABORTED — missing --name <migration_name>.');
  console.error('          Usage: node scripts/test-db-migrate.js --name <name> [--dry-run]');
  process.exit(1);
}

let childEnv;
let parsed;
try {
  ({ childEnv, parsed } = buildChildEnv());
} catch (err) {
  console.error('[MIGRATE] ABORTED — safety preflight failed. Nothing was migrated.');
  console.error(err.message);
  process.exit(1);
}

const prismaCli   = path.join(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js');
const schemaPath  = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const args = ['migrate', 'dev', '--name', NAME, '--schema', schemaPath];

console.log(`[MIGRATE] Child process will target: ${parsed.host}:${parsed.port}/${parsed.database}`);
console.log(`[MIGRATE] Child process NODE_ENV: ${childEnv.NODE_ENV}`);
console.log(`[MIGRATE] DATABASE_URL present in child env: ${typeof childEnv.DATABASE_URL === 'string' && childEnv.DATABASE_URL.length > 0}`);
if (DRY_RUN) {
  console.log('[MIGRATE] DRY-RUN — no command executed. Would run:');
  console.log(`        ${process.execPath} ${prismaCli} ${args.join(' ')}`);
  process.exit(0);
}

const run = spawnSync(process.execPath, [prismaCli, ...args], { stdio: 'inherit', env: childEnv });

if (run.status !== 0) {
  console.error('[MIGRATE] FAIL — Prisma migrate dev did not complete.');
  process.exit(run.status || 1);
}

console.log('[MIGRATE] PASS — test database migration applied.');
process.exit(0);