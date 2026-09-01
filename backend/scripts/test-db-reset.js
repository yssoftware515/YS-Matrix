'use strict';
// ============================================================
// YS-MATRIX TEST DB RESET (Phase 0.6 — hardened)
//
// The destructive Prisma process is spawned with an EXPLICIT
// environment built by scripts/test-env.js:
//   - .env.test is loaded in THIS process (not a sibling)
//   - DATABASE_URL is structurally validated
//   - the child env FORCES the validated test URL (any ambient or
//     inherited production value is overwritten)
//   - NODE_ENV=test is forced
//   - a FINAL PREFLIGHT re-validates the exact URL being passed
//     (Check D) immediately before spawning
// Because DATABASE_URL is already present in the child's process
// environment, Prisma CLI's implicit `.env` auto-load cannot
// override it — eliminating the Phase 0.5 failure mode entirely.
//
// --dry-run: prints the sanitized child database identity and the
// exact spawn command WITHOUT executing anything.
// ============================================================

const { spawnSync } = require('child_process');
const path = require('path');
const { buildChildEnv } = require('./test-env');

const DRY_RUN = process.argv.includes('--dry-run');

let childEnv;
let parsed;
try {
  ({ childEnv, parsed } = buildChildEnv());
} catch (err) {
  console.error('[RESET] ABORTED — safety preflight failed. Nothing was reset.');
  console.error(err.message);
  process.exit(1);
}

const prismaCli = path.join(__dirname, '..', 'node_modules', 'prisma', 'build', 'index.js');
const schemaPath = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const args = ['migrate', 'reset', '--force', '--skip-generate', '--schema', schemaPath];

console.log(`[RESET] Child process will target: ${parsed.host}:${parsed.port}/${parsed.database}`);
console.log(`[RESET] Child process NODE_ENV: ${childEnv.NODE_ENV}`);
console.log(`[RESET] DATABASE_URL present in child env: ${typeof childEnv.DATABASE_URL === 'string' && childEnv.DATABASE_URL.length > 0}`);
if (DRY_RUN) {
  console.log('[RESET] DRY-RUN — no command executed. Would run:');
  console.log(`        ${process.execPath} ${prismaCli} ${args.join(' ')}`);
  process.exit(0);
}

const run = spawnSync(process.execPath, [prismaCli, ...args], { stdio: 'inherit', env: childEnv });

if (run.status !== 0) {
  console.error('[RESET] FAIL — Prisma migrate reset did not complete.');
  process.exit(run.status || 1);
}

console.log('[RESET] PASS — test database schema reset and migrations applied.');
process.exit(0);