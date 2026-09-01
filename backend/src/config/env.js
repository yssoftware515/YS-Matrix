// ============================================================
// YS-MATRIX ERP — Single Environment Loader (Phase 2 — F-01)
// YS Systems & Software
//
// THE only module that loads dotenv files. Every entry point
// (server boot, test harness, destructive test scripts, seed
// scripts) routes through here so the loading rules cannot
// drift apart.
//
// RULES:
//   1. Normal mode (NODE_ENV !== 'test'): loads backend/.env
//      (explicit path — never depends on process.cwd()).
//   2. Test mode: loads ONLY backend/.env.test. backend/.env is
//      NEVER loaded, and production-declared keys that happen to
//      be present in the process environment (ambient shell vars,
//      CI exports, a dotenv call from a sibling module) are
//      REMOVED — fail closed: an absent secret beats a silently
//      inherited production one. NODE_ENV is forced to 'test'.
//
// Approved-key strip: a key is kept in test mode only if it is
// declared in backend/.env.test. The production surface is the
// union of keys declared in backend/.env and backend/.env.example,
// so any NEW production key added later is stripped automatically
// until somebody explicitly approves a test value for it.
// ============================================================

'use strict';

const dotenv = require('dotenv');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..', '..');
const PROD_ENV_FILE = path.join(ROOT_DIR, '.env');
const TEST_ENV_FILE = path.join(ROOT_DIR, '.env.test');
const ENV_EXAMPLE_FILE = path.join(ROOT_DIR, '.env.example');

/**
 * Parses just the KEY NAMES declared in a dotenv-style file.
 * Never returns values — this module never logs or exposes them.
 * Missing/unparseable file → empty set (fail closed: fewer
 * approved keys means MORE stripping, never less).
 */
function parseDeclaredKeys(filePath) {
  try {
    if (!fs.existsSync(filePath)) return new Set();
    return new Set(Object.keys(dotenv.parse(fs.readFileSync(filePath, 'utf8'))));
  } catch {
    return new Set();
  }
}

/**
 * True when the current process runs in test mode.
 */
function isTestMode() {
  return process.env.NODE_ENV === 'test';
}

/**
 * Fail-closed strip (test mode only): deletes any production-surface
 * key that is not explicitly approved in .env.test. Covers both the
 * file-backfill vector (a sibling dotenv call loading backend/.env)
 * and the ambient vector (shell/CI exporting production values) —
 * they are the same code path here.
 *
 * Platform variables (PATH, HOME, ...) are never declared in these
 * files, so they pass through untouched.
 */
function stripProductionConfig() {
  const approved = parseDeclaredKeys(TEST_ENV_FILE);
  const productionSurface = new Set([
    ...parseDeclaredKeys(PROD_ENV_FILE),
    ...parseDeclaredKeys(ENV_EXAMPLE_FILE),
  ]);

  for (const key of productionSurface) {
    if (!approved.has(key)) {
      delete process.env[key];
    }
  }
}

/**
 * Unconditional test-mode load — for test tooling (harness, scripts)
 * that KNOWS it is a test process regardless of the ambient NODE_ENV.
 * Loads .env.test (values never override already-set ones — anything
 * ambient is then handled by the strip), forces NODE_ENV=test, and
 * strips the production surface.
 */
function loadTestEnv() {
  process.env.NODE_ENV = 'test';
  dotenv.config({ path: TEST_ENV_FILE, override: false });
  stripProductionConfig();
}

/**
 * Mode-aware load — for the application entry point (index.js) and
 * seed scripts. Test mode (ambient NODE_ENV=test) → loadTestEnv().
 * Anything else → backend/.env, environment left untouched.
 */
function loadEnv() {
  if (isTestMode()) {
    loadTestEnv();
    return 'test';
  }
  dotenv.config({ path: PROD_ENV_FILE, override: false });
  return 'default';
}

module.exports = {
  loadEnv,
  loadTestEnv,
  isTestMode,
  stripProductionConfig,
  PROD_ENV_FILE,
  TEST_ENV_FILE,
  ENV_EXAMPLE_FILE,
};
