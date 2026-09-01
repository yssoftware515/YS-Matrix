'use strict';
// ============================================================
// YS-MATRIX SAFETY SELF-TEST (Phase 0.6 — Objective 8)
//
// Proves, WITHOUT touching any database, that a production-like
// DATABASE_URL is rejected by the same validation used in the
// destructive path. Demonstrates:
//     production-like DATABASE_URL → SAFETY CHECK → REJECT → NO DB COMMAND
//
// Also re-runs the real guard script as a child with a
// production-like ambient DATABASE_URL and asserts it exits 1.
// No network access occurs anywhere in this file.
// ============================================================

const { spawnSync } = require('child_process');
const path = require('path');
const { validateTestDbUrl, EXPECTED_TEST_DB } = require('./test-env');

const cases = [
  {
    name: 'production Neon URL',
    url: 'postgresql://user:secret@ep-delicate-math-ap1zxr48-pooler.c-7.us-east-1.aws.neon.tech/neondb',
  },
  {
    name: 'production-like Neon URL (different account name)',
    url: 'postgresql://user:secret@ep-somepool-123456-pooler.us-east-1.aws.neon.tech/mydb',
  },
  {
    name: 'wrong host (remote server)',
    url: 'postgresql://user:secret@db.example.com:5432/ys_matrix_test',
  },
  {
    name: 'wrong port (local 5432 — the running 5432 cluster)',
    url: 'postgresql://user:secret@localhost:5432/ys_matrix_test',
  },
  {
    name: 'wrong database name',
    url: 'postgresql://user:secret@localhost:5433/neondb',
  },
  {
    name: 'missing URL',
    url: '',
  },
  {
    name: 'non-URL garbage',
    url: 'not-a-url',
  },
];

let failures = 0;

for (const c of cases) {
  const res = validateTestDbUrl(c.url);
  const rejected = !res.ok;
  const expected = c.url !== '' && c.url !== 'not-a-url';
  const verdict = rejected ? 'REJECTED' : 'ACCEPTED';
  if (rejected) {
    console.log(`  PASS — ${c.name}: ${verdict}`);
  } else {
    console.log(`  FAIL — ${c.name}: ${verdict} (must be rejected)`);
    failures++;
  }
}

// Correct URL must pass (proves the validator is not over-broad)
const good = validateTestDbUrl(`postgresql://postgres:${'x'.repeat(16)}@localhost:5433/ys_matrix_test`);
if (good.ok) {
  console.log('  PASS — canonical local test URL: ACCEPTED');
} else {
  console.log(`  FAIL — canonical local test URL rejected: ${good.problems.join('; ')}`);
  failures++;
}

// Expected identity sanity
if (EXPECTED_TEST_DB.host !== 'localhost' || EXPECTED_TEST_DB.port !== '5433' || EXPECTED_TEST_DB.database !== 'ys_matrix_test') {
  console.log('  FAIL — EXPECTED_TEST_DB constants drifted');
  failures++;
}

// End-to-end: the REAL guard script, spawned with a production-like
// ambient DATABASE_URL, must exit 1 without executing anything else.
const guard = spawnSync(
  process.execPath,
  [path.join(__dirname, 'test-db-guard.js')],
  { env: { ...process.env, DATABASE_URL: cases[0].url }, encoding: 'utf8' }
);
if (guard.status === 1 && /REFUSED|FAIL/.test(guard.stderr + guard.stdout)) {
  console.log('  PASS — guard child process with ambient production URL: exit=1 (BLOCKED)');
} else {
  console.log(`  FAIL — guard child with production URL exited ${guard.status} — MUST exit 1`);
  console.log(guard.stdout, guard.stderr);
  failures++;
}

if (failures > 0) {
  console.error(`[SELF-TEST] FAILED — ${failures} safety check(s) failed. Destructive testing is NOT safe.`);
  process.exit(1);
}
console.log('[SELF-TEST] PASS — all production-like configurations are rejected before any database command.');
process.exit(0);