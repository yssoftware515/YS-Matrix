'use strict';
// ============================================================
// YS-MATRIX — SINGLE-SOURCE TEST DATABASE CONFIGURATION
// Phase 0.6 — incident remediation (production reset via Prisma
// CLI silently loading backend/.env instead of backend/.env.test).
//
// RULES (must never regress):
//   1. The process performing a destructive database operation
//      loads .env.test ITSELF (never relies on a sibling process,
//      shell state, or Prisma's implicit .env loading).
//   2. DATABASE_URL is validated structurally (scheme + host +
//      port + database) — never a single substring check.
//   3. The exact environment passed to the destructive child is
//      REBUILT with the validated test URL forced in, so any
//      ambient/production value is overwritten, and Prisma's
//      implicit `.env` auto-load cannot take effect (an already
//      set environment variable wins over dotenv file loading).
//   4. A final preflight re-validates the exact URL object that
//      will be handed to the child, immediately before spawning.
//   5. FAIL CLOSED: any ambiguity/unknown → process.exit(1), no
//      destructive command.
// ============================================================

const fs = require('fs');
const path = require('path');
const { loadTestEnv } = require('../src/config/env');

const EXP_TEST_ENV_FILE = path.join(__dirname, '..', '.env.test');

// Positive identification of the isolated local test database.
const EXPECTED_TEST_DB = {
  scheme: 'postgresql',
  host: 'localhost',
  port: '5434',
  database: 'ys_matrix_test',
};

/**
 * Loads backend/.env.test into the CURRENT process via the shared
 * loader (src/config/env.js — the only dotenv loader in the repo).
 * The loader also STRIPS any production-surface key that is not
 * explicitly approved in .env.test (Phase 2 — F-01), so an ambient
 * production RESEND_API_KEY / DATABASE_URL can never reach this
 * process. The explicit existsSync check below keeps the original
 * clear error message; the loader itself silently no-ops on a
 * missing file (fail closed — validation refuses downstream).
 */
function loadTestEnvFile() {
  if (!fs.existsSync(EXP_TEST_ENV_FILE)) {
    throw new Error(`[TEST-ENV] backend/.env.test does not exist at ${EXP_TEST_ENV_FILE}. Refusing.`);
  }
  loadTestEnv();
}

/**
 * Structural validation of a DATABASE_URL against the expected test
 * database identity. Pure function — no env access, no network.
 * Returns { ok: boolean, problems: string[], parsed?: object }.
 */
function validateTestDbUrl(rawUrl) {
  const problems = [];

  if (!rawUrl || typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    return { ok: false, problems: ['DATABASE_URL is missing or empty.'] };
  }

  let parsed;
  try {
    parsed = new URL(rawUrl.replace(/^postgres(?:ql)?:\/\//, 'postgresql://'));
  } catch {
    return { ok: false, problems: [`DATABASE_URL is not parseable as a URI.`] };
  }

  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  const host = (parsed.hostname || '').toLowerCase();
  const port = parsed.port || '5432';
  const database = parsed.pathname.replace(/^\//, '').split('?')[0];

  if (scheme !== EXPECTED_TEST_DB.scheme) {
    problems.push(`scheme "${scheme}" != expected "${EXPECTED_TEST_DB.scheme}"`);
  }
  if (!(host === 'localhost' || host === '127.0.0.1')) {
    problems.push(`host "${host}" is not the local test host "${EXPECTED_TEST_DB.host}"`);
  }
  if (port !== EXPECTED_TEST_DB.port) {
    problems.push(`port "${port}" != expected "${EXPECTED_TEST_DB.port}"`);
  }
  if (database !== EXPECTED_TEST_DB.database) {
    problems.push(`database "${database}" != expected "${EXPECTED_TEST_DB.database}"`);
  }
  if (host.includes('neon.tech') || host.includes('neon')) {
    problems.push('host looks like the production provider (Neon) — refusing.');
  }

  return {
    ok: problems.length === 0,
    problems,
    parsed: { scheme, host, port, database },
  };
}

/**
 * Loads .env.test and validates the effective DATABASE_URL.
 * FAIL CLOSED: throws on any problem (caller decides to exit).
 */
function loadAndValidate() {
  loadTestEnvFile();
  const result = validateTestDbUrl(process.env.DATABASE_URL);
  if (!result.ok) {
    const msg = `[TEST-ENV] REFUSED — not the isolated test database:\n  - ${result.problems.join('\n  - ')}`;
    throw new Error(msg);
  }
  return result.parsed;
}

/**
 * Builds the EXPLICIT child environment for a destructive Prisma
 * process. The validated test DATABASE_URL is forced in (overwrites
 * any ambient value), NODE_ENV=test is forced, and the final value
 * is re-validated (Check D — final preflight on the exact env being
 * handed to the child).
 */
function buildChildEnv() {
  const parsed = loadAndValidate();
  const doubled = validateTestDbUrl(process.env.DATABASE_URL);
  if (!doubled.ok) {
    throw new Error(`[TEST-ENV] Final preflight failed: ${doubled.problems.join('; ')}`);
  }
  const childEnv = {
    ...process.env,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: 'test',
  };
  return { childEnv, parsed };
}

module.exports = {
  EXPECTED_TEST_DB,
  loadTestEnvFile,
  validateTestDbUrl,
  loadAndValidate,
  buildChildEnv,
};