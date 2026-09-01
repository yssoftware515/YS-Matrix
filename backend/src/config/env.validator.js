// ============================================================
// YS-MATRIX ERP — Startup Environment Validator
// Author: Yahya Al-Sulami 🦅
//
// PURPOSE: crash the process IMMEDIATELY on boot if required
// secrets are missing, empty, or left as the known placeholder
// value. This must run BEFORE app.listen() — a server that
// starts with a forgeable JWT secret is worse than a server
// that refuses to start at all.
//
// Also used by seed scripts (see seed.superadmin.js) to enforce
// the same crash-on-weak-credential policy at seed time.
// ============================================================

'use strict';

const SECURITY = require('./security');

// bcrypt's technical range is 4–31, but practical safety bounds are
// tighter: below 4 provides negligible hashing cost (effectively
// broken protection), above 15 turns every login/register/password
// -change request into a multi-second CPU-bound operation — a
// trivial, unauthenticated DoS vector (an attacker just spams
// /auth/register or /auth/login with wrong passwords).
const MIN_BCRYPT_ROUNDS = 4;
const MAX_BCRYPT_ROUNDS = 15;

// Known placeholder strings that must NEVER reach production.
// Sourced directly from DEPLOYMENT.md / .env.example conventions.
// Phase 4C (4C-F1): the .env.example values themselves are included —
// all three are long enough to pass the 32-char strength gate on
// length alone (34/39/16 chars), so before this fix a verbatim copy
// of .env.example as .env validated CLEAN in production and booted
// with publicly-known, forgeable JWT secrets.
const KNOWN_PLACEHOLDERS = new Set([
  'REPLACE_WITH_STRONG_SECRET_64_CHARS',
  'GENERATE_STRONG_64_CHAR_SECRET_HERE',          // .env.example JWT_ACCESS_SECRET
  'GENERATE_ANOTHER_STRONG_64_CHAR_SECRET_HERE',  // .env.example JWT_REFRESH_SECRET
  'enter strong pass',                            // .env.example SUPER_ADMIN_PASSWORD
  'changeme',
  'change_me',
  'secret',
  'your_secret_here',
  'CHANGE_ME_IN_PRODUCTION',
  'YS@Admin2024!', // legacy seed.js fallback default — must never be usable again
]);

const MIN_SECRET_LENGTH = 32; // bytes of entropy as hex/base64 chars — 64-char hex is the documented standard

/**
 * Validates a single required high-entropy secret value (JWT secrets, etc).
 * Returns an array of human-readable problem strings (empty = OK).
 */
function checkSecret(name, value) {
  const problems = [];

  if (!value || value.trim().length === 0) {
    problems.push(`${name} is missing or empty.`);
    return problems;
  }

  if (KNOWN_PLACEHOLDERS.has(value.trim())) {
    problems.push(`${name} is still set to a known placeholder value ("${value}"). Generate a real secret.`);
  }

  if (value.length < MIN_SECRET_LENGTH) {
    problems.push(`${name} is only ${value.length} characters — must be at least ${MIN_SECRET_LENGTH}. Generate with: node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"`);
  }

  return problems;
}

/**
 * Validates that two secrets are not identical to each other
 * (access and refresh secrets must be distinct).
 */
function checkDistinct(nameA, valueA, nameB, valueB) {
  if (valueA && valueB && valueA === valueB) {
    return [`${nameA} and ${nameB} must NOT be the same value — they are currently identical.`];
  }
  return [];
}

/**
 * Validates a required credential that is NOT expected to be a
 * high-entropy secret (e.g. an admin login password) — no 32-char
 * entropy requirement, but zero tolerance for "missing" or "known
 * placeholder". Used by seed scripts that must refuse to run
 * rather than silently fall back to a default.
 */
function checkRequiredCredential(name, value, { minLength } = {}) {
  const problems = [];
  const effectiveMinLength = minLength ?? SECURITY.password.minLength;
  const trimmed = typeof value === 'string' ? value.trim() : '';

  if (!trimmed) {
    problems.push(`${name} is missing or empty. No fallback is permitted — set it explicitly before running this script.`);
    return problems;
  }

  if (KNOWN_PLACEHOLDERS.has(trimmed)) {
    problems.push(`${name} is set to a known placeholder/default value ("${trimmed}"). Choose a unique, real credential.`);
  }

  if (trimmed.length < effectiveMinLength) {
    problems.push(`${name} is only ${trimmed.length} characters — must be at least ${effectiveMinLength}.`);
  }

  return problems;
}

/**
 * Shared crash/report mechanism — every validation entry point
 * (app boot, seed scripts) prints the same banner format and
 * exits the same way. No inline duplication.
 */
function crashWithProblems(problems, logger, title) {
  const banner = '\n' + '='.repeat(70) + `\n🛑 ${title}\n` + '='.repeat(70);
  const list = problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n');
  const footer = '='.repeat(70) + '\nFix the above and restart.\n' + '='.repeat(70) + '\n';
  const fullMessage = `${banner}\n${list}\n${footer}`;

  if (logger && typeof logger.error === 'function') {
    logger.error(fullMessage);
  } else {
    console.error(fullMessage);
  }

  process.exit(1);
}

/**
 * Validates BCRYPT_ROUNDS if the operator explicitly set it.
 *
 * Deliberately does NOT require it to be set — security.js's own
 * `|| '12'` fallback is a safe, deliberate default. This function's
 * only job is to catch an EXPLICITLY set value that is garbage
 * (non-numeric) or outside the safe operating range, before it can
 * silently reach bcrypt.hash() as NaN or an unsafe round count.
 *
 * Uses Number(), not parseInt(): parseInt('12abc', 10) === 12 —
 * it silently truncates trailing garbage instead of rejecting it.
 * Number('12abc') === NaN, which is what we actually want to catch.
 */
function checkBcryptRounds(rawValue) {
  const problems = [];

  if (rawValue === undefined || rawValue === null || rawValue.trim() === '') {
    return problems; // unset — security.js's '12' default applies, nothing to validate
  }

  const trimmed = rawValue.trim();
  const parsed  = Number(trimmed);

  if (!Number.isInteger(parsed)) {
    problems.push(
      `BCRYPT_ROUNDS is not a valid integer ("${rawValue}"). ` +
      `Must be a whole number between ${MIN_BCRYPT_ROUNDS} and ${MAX_BCRYPT_ROUNDS}.`
    );
    return problems;
  }

  if (parsed < MIN_BCRYPT_ROUNDS || parsed > MAX_BCRYPT_ROUNDS) {
    problems.push(
      `BCRYPT_ROUNDS is ${parsed}, outside the safe range ` +
      `[${MIN_BCRYPT_ROUNDS}-${MAX_BCRYPT_ROUNDS}]. Too low weakens password ` +
      `hashing to near-uselessness; too high turns every login/register/` +
      `password-change request into a CPU-exhaustion DoS vector.`
    );
  }

  return problems;
}

/**
 * Pure problem-collection core — no process.exit, no side effects.
 *
 * Given an env object and a production flag, returns the full list
 * of environment problems (empty array = OK). Separated from
 * validateEnvOrCrash so tests can run the exact same checks against
 * synthetic env objects, and so boot/seed entry points share ONE
 * source of truth for what "a valid environment" means.
 */
function collectEnvProblems(env, isProduction) {
  const problems = [];

  // ── JWT secrets — always required, regardless of environment.
  // A weak secret in "development" that gets promoted by accident
  // (wrong .env file copied, env var not overridden on the host)
  // is exactly the failure mode we're guarding against.
  problems.push(...checkSecret('JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET));
  problems.push(...checkSecret('JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET));
  problems.push(...checkDistinct(
    'JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET,
    'JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET
  ));

  // ── Database — Prisma will fail anyway without this, but its
  // native error is a stack trace, not an actionable message.
  if (!env.DATABASE_URL || env.DATABASE_URL.trim().length === 0) {
    problems.push('DATABASE_URL is missing or empty. Prisma cannot connect without it.');
  }

  // Checked in ALL environments, not just production — a malformed
  // BCRYPT_ROUNDS is a correctness bug (crashes bcrypt.hash at the
  // first real request), not a production-only policy concern like
  // ALLOWED_ORIGINS.
  problems.push(...checkBcryptRounds(env.BCRYPT_ROUNDS));

  // ── CORS — only hard-fail in production. In development, the
  // 'http://localhost:3000' fallback in security.js is fine.
  if (isProduction) {
    const origins = env.ALLOWED_ORIGINS;
    if (!origins || origins.trim().length === 0) {
      problems.push('ALLOWED_ORIGINS is not set in production — CORS would fall back to localhost, blocking your real frontend.');
    } else if (origins.includes('localhost')) {
      problems.push(`ALLOWED_ORIGINS contains "localhost" in production (${origins}). Remove localhost entries before deploying.`);
    }

    // Phase A (P2-4): CRON_SECRET gates the scheduled-notifications
    // trigger (/api/cron/*). REQUIRED in production — a missing or
    // placeholder secret would leave the trigger forgeable, and a
    // placeholder in the env is the failure signature that one leaked.
    problems.push(...checkSecret('CRON_SECRET', env.CRON_SECRET));

    // We do NOT require SUPER_ADMIN_PASSWORD to be present at app
    // boot time — it's a seed-time-only credential (see
    // validateSuperAdminCredentialsOrCrash below for the strict,
    // unconditional gate used by seed.superadmin.js). But IF it
    // happens to be set in the environment, it must not be a
    // known-weak placeholder.
    if (env.SUPER_ADMIN_PASSWORD) {
      problems.push(...checkRequiredCredential('SUPER_ADMIN_PASSWORD', env.SUPER_ADMIN_PASSWORD));
    }
  } else if (env.CRON_SECRET) {
    // Non-production: CRON_SECRET is optional (dev/test may run
    // without it) — but if set, it must still pass the same
    // strength gate so a placeholder can never be rehearsed locally
    // and then shipped verbatim.
    problems.push(...checkSecret('CRON_SECRET', env.CRON_SECRET));
  }

  return problems;
}

/**
 * Main entry point. Call this once, at the very top of index.js,
 * before any route, middleware, or app.listen() is set up.
 *
 * Throws (does not return) on any validation failure, with a
 * single consolidated, readable error message listing every
 * problem found — not just the first one.
 */
function validateEnvOrCrash(logger) {
  const isProduction = process.env.NODE_ENV === 'production';
  const problems = collectEnvProblems(process.env, isProduction);

  if (problems.length > 0) {
    crashWithProblems(problems, logger, 'STARTUP ABORTED — ENVIRONMENT VALIDATION FAILED');
  }

  return true;
}

/**
 * Strict, unconditional SUPER_ADMIN_PASSWORD gate — called ONLY by
 * seed.superadmin.js. Unlike validateEnvOrCrash (which only checks
 * this var IF present, and only in production), this function
 * ALWAYS requires it to be present, non-placeholder, and long
 * enough — in every environment. A seed script that creates a real
 * login credential must never fall back to a guessable default,
 * dev or prod.
 */
function validateSuperAdminCredentialsOrCrash(logger) {
  const problems = checkRequiredCredential('SUPER_ADMIN_PASSWORD', process.env.SUPER_ADMIN_PASSWORD);

  if (problems.length > 0) {
    crashWithProblems(problems, logger, 'SEED ABORTED — SUPER ADMIN CREDENTIAL VALIDATION FAILED');
  }

  return true;
}

module.exports = {
  validateEnvOrCrash,
  validateSuperAdminCredentialsOrCrash,
  collectEnvProblems,
  checkSecret,
  checkRequiredCredential,
  checkBcryptRounds,
  KNOWN_PLACEHOLDERS,
  MIN_SECRET_LENGTH,
  MIN_BCRYPT_ROUNDS,
  MAX_BCRYPT_ROUNDS,
};
