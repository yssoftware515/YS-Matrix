'use strict';
// ============================================================
// YS-MATRIX TEST DB SAFETY GUARD (Phase 0.6 — hardened)
//
// Executed as the first link of the integration-test chain AND by
// reset itself. Loads ONLY backend/.env.test in its own process,
// validates DATABASE_URL structurally (scheme/host/port/database),
// and FAILS CLOSED on any ambiguity. Production protection is also
// independently proven by scripts/test-db-guard.selftest.js.
// ============================================================

const { loadAndValidate, EXPECTED_TEST_DB } = require('./test-env');

try {
  const parsed = loadAndValidate();
  const e = EXPECTED_TEST_DB;
  console.log(`[GUARD] PASS — test database identified: ${parsed.host}:${parsed.port}/${parsed.database} (expected ${e.scheme}://${e.host}:${e.port}/${e.database})`);
  process.exit(0);
} catch (err) {
  console.error(`[GUARD] FAIL — refusing to proceed. This guard protects production data.`);
  console.error(err.message);
  process.exit(1);
}