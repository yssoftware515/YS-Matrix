'use strict';
// ============================================================
// Phase 2 — F-01 REGRESSION SUITE: test-environment credential
// isolation. DB-free unit tests.
//
// Each scenario runs in a CHILD process with a CONTROLLED ambient
// environment, so the shared loader (src/config/env.js) is proven
// against hostile values without polluting the test runner itself.
//
// Proven here:
//   A. Test mode never imports ambient production secrets.
//   B. The application surface cannot see production credentials
//      in test mode (email service booted with key stripped).
//   C. Password-reset emails are simulated in tests — never sent.
//      Failure paths stay deterministic (EMAIL_SIMULATE_FAILURE,
//      EMAIL_NOT_CONFIGURED). Even a misconfigured transport cannot
//      cause an outbound call: the API key is always stripped.
//   D. Production config still loads correctly when explicitly
//      provided in production mode (no stripping, validation clean).
//   E. Missing/invalid test config fails closed (REFUSED, no silent
//      fallback to production values).
//   F. The real test-db guard still refuses a production-looking
//      DATABASE_URL — with production credentials present too.
// ============================================================

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('path');

const BACKEND_ROOT = path.join(__dirname, '..');
const node = process.execPath;

/** Runs a script in a child process with explicit ambient env. */
function runChild(script, envOverrides = {}) {
  return spawnSync(node, ['-e', script], {
    cwd: BACKEND_ROOT,
    env: { ...process.env, ...envOverrides },
    encoding: 'utf8',
    timeout: 30000,
  });
}

/** Ambient production-looking values injected into every hostile child. */
const AMBIENT_PROD = {
  RESEND_API_KEY: 'sk_prod_ambient_probe_1234567890',
  RESEND_FROM_EMAIL: 'prod@example.com',
  FRONTEND_URL: 'https://prod.example.com',
  ALLOWED_ORIGINS: 'https://prod.example.com',
  SUPER_ADMIN_EMAIL: 'admin@prod.example.com',
  SUPER_ADMIN_PASSWORD: 'ProdOnlyPass_987654321',
  LOG_LEVEL: 'debug',
};

const SECRET_64A = 'a'.repeat(64);
const SECRET_64B = 'b'.repeat(64);

// ─────────────────────────────────────────
// A — TEST MODE NEVER IMPORTS AMBIENT PRODUCTION SECRETS
// ─────────────────────────────────────────
test('F-01/A: test mode strips every production-surface key not approved in .env.test', () => {
  const r = runChild(
    `const { loadTestEnv } = require('./src/config/env');
     loadTestEnv();
     const e = process.env;
     console.log(JSON.stringify({
       resend: e.RESEND_API_KEY ?? null,
       resendFrom: e.RESEND_FROM_EMAIL ?? null,
       rateMax: e.RATE_LIMIT_MAX ?? null,
       rateWindow: e.RATE_LIMIT_WINDOW_MS ?? null,
       frontend: e.FRONTEND_URL ?? null,
       origins: e.ALLOWED_ORIGINS ?? null,
       saEmail: e.SUPER_ADMIN_EMAIL ?? null,
       saPass: e.SUPER_ADMIN_PASSWORD ?? null,
       logLevel: e.LOG_LEVEL ?? null,
       nodeEnv: e.NODE_ENV,
       db: e.DATABASE_URL ?? null,
     }));`,
    { NODE_ENV: 'test', ...AMBIENT_PROD }
  );

  assert.strictEqual(r.status, 0, `child failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.resend, null, 'RESEND_API_KEY must be stripped');
  // RESEND_FROM_EMAIL is NOT declared in backend/.env nor .env.example —
  // not part of the production surface — and is useless without the API
  // key (which IS stripped), so it survives untouched. This proves the
  // strip is targeted at the declared production surface, not a blind wipe.
  assert.strictEqual(out.resendFrom, 'prod@example.com', 'non-surface key survives (harmless without the key)');
  assert.strictEqual(out.frontend, null, 'FRONTEND_URL must be stripped (not approved in .env.test)');
  assert.strictEqual(out.origins, null, 'ALLOWED_ORIGINS must be stripped');
  assert.strictEqual(out.saEmail, null, 'SUPER_ADMIN_EMAIL must be stripped');
  assert.strictEqual(out.saPass, null, 'SUPER_ADMIN_PASSWORD must be stripped');
  assert.strictEqual(out.logLevel, null, 'LOG_LEVEL must be stripped');
  assert.strictEqual(out.nodeEnv, 'test', 'NODE_ENV must be forced to test');
  assert.ok(out.db && out.db.endsWith('/ys_matrix_test'), 'approved test DATABASE_URL must survive');
  assert.strictEqual(out.rateMax, '10000', 'approved .env.test RATE_LIMIT_MAX must survive');
  assert.strictEqual(out.rateWindow, '60000', 'approved .env.test RATE_LIMIT_WINDOW_MS must survive');
});

// ─────────────────────────────────────────
// B — THE APPLICATION SURFACE SEES NO PRODUCTION CREDENTIALS
// ─────────────────────────────────────────
test('F-01/B: app modules booted in test mode have no Resend credentials', () => {
  const r = runChild(
    `const { loadTestEnv } = require('./src/config/env');
     loadTestEnv();
     require('./src/services/email.service');
     console.log(JSON.stringify({ resend: process.env.RESEND_API_KEY ?? null }));
     `,
    { NODE_ENV: 'test', ...AMBIENT_PROD }
  );

  assert.strictEqual(r.status, 0, `child failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.resend, null, 'email.service must boot with no production key in sight');
});

// ─────────────────────────────────────────
// C — EMAILS ARE SIMULATED IN TESTS; FAILURE PATHS DETERMINISTIC
// ─────────────────────────────────────────
test('F-01/C1: console transport simulates a successful send (no network, no client)', () => {
  const r = runChild(
    `(async () => {
       const { loadTestEnv } = require('./src/config/env');
       loadTestEnv();
       const { sendPasswordResetEmail } = require('./src/services/email.service');
       const keyBefore = process.env.RESEND_API_KEY ?? null;
       const result = await sendPasswordResetEmail({
         to: 'test@test.local', name: 'Tester',
         resetUrl: 'http://localhost:3000/auth/reset-password?token=abc', expiresInMinutes: 30,
       });
       console.log(JSON.stringify({ keyBefore, id: result.id, keyAfter: process.env.RESEND_API_KEY ?? null }));
     })().catch((e) => { console.error(e); process.exit(1); });`,
    { NODE_ENV: 'test', ...AMBIENT_PROD }
  );

  assert.strictEqual(r.status, 0, `child failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.keyBefore, null);
  assert.strictEqual(out.id, 'console-transport-simulated', 'console transport must resolve successfully');
  assert.strictEqual(out.keyAfter, null, 'no credential can appear during the simulated send');
});

test('F-01/C2: EMAIL_SIMULATE_FAILURE=true makes the console transport throw EMAIL_SEND_FAILED', () => {
  const r = runChild(
    `(async () => {
       const { loadTestEnv } = require('./src/config/env');
       loadTestEnv();
       const { sendPasswordResetEmail } = require('./src/services/email.service');
       try {
         await sendPasswordResetEmail({ to: 'test@test.local', name: 'T', resetUrl: 'http://x', expiresInMinutes: 30 });
         console.log(JSON.stringify({ threw: false }));
       } catch (e) {
         console.log(JSON.stringify({ threw: true, code: e.code }));
       }
     })().catch((e) => { console.error(e); process.exit(1); });`,
    { NODE_ENV: 'test', EMAIL_SIMULATE_FAILURE: 'true' }
  );

  assert.strictEqual(r.status, 0, `child failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.threw, true);
  assert.strictEqual(out.code, 'EMAIL_SEND_FAILED');
});

test('F-01/C3: even a misconfigured transport cannot cause an outbound call — key is stripped', () => {
  // EMAIL_TRANSPORT=resend ambient: allowed to survive (approved key),
  // but RESEND_API_KEY is stripped → the lazy client throws
  // EMAIL_NOT_CONFIGURED at send time. No network possible.
  const r = runChild(
    `(async () => {
       const { loadTestEnv } = require('./src/config/env');
       loadTestEnv();
       const { sendPasswordResetEmail } = require('./src/services/email.service');
       try {
         await sendPasswordResetEmail({ to: 'test@test.local', name: 'T', resetUrl: 'http://x', expiresInMinutes: 30 });
         console.log(JSON.stringify({ threw: false }));
       } catch (e) {
         console.log(JSON.stringify({ threw: true, code: e.code, key: process.env.RESEND_API_KEY ?? null }));
       }
     })().catch((e) => { console.error(e); process.exit(1); });`,
    { NODE_ENV: 'test', EMAIL_TRANSPORT: 'resend', ...AMBIENT_PROD }
  );

  assert.strictEqual(r.status, 0, `child failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.threw, true, 'resend transport without a key must fail closed');
  assert.strictEqual(out.code, 'EMAIL_NOT_CONFIGURED');
  assert.strictEqual(out.key, null);
});

// ─────────────────────────────────────────
// D — PRODUCTION CONFIG STILL LOADS CORRECTLY
// ─────────────────────────────────────────
test('F-01/D: production mode loads explicit production config, validates clean, strips nothing', () => {
  const r = runChild(
    `const { loadEnv } = require('./src/config/env');
     loadEnv();
     const { collectEnvProblems } = require('./src/config/env.validator');
     const e = process.env;
     console.log(JSON.stringify({
       problems: collectEnvProblems(process.env, true),
       origins: e.ALLOWED_ORIGINS,
       resend: e.RESEND_API_KEY ?? null,
       nodeEnv: e.NODE_ENV,
       db: e.DATABASE_URL,
     }));`,
    {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/prod_db',
      JWT_ACCESS_SECRET: SECRET_64A,
      JWT_REFRESH_SECRET: SECRET_64B,
      ALLOWED_ORIGINS: 'https://app.example.com',
      CRON_SECRET: SECRET_64A,
      BCRYPT_ROUNDS: '12',
      RESEND_API_KEY: 'sk_prod_explicit',
      FRONTEND_URL: 'https://app.example.com',
    }
  );

  assert.strictEqual(r.status, 0, `child failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.deepStrictEqual(out.problems, [], 'explicit production config must validate clean');
  assert.strictEqual(out.origins, 'https://app.example.com');
  assert.strictEqual(out.resend, 'sk_prod_explicit', 'production mode must NOT strip credentials');
  assert.strictEqual(out.nodeEnv, 'production');
});

// ─────────────────────────────────────────
// E — MISSING/INVALID TEST CONFIG FAILS CLOSED
// ─────────────────────────────────────────
test('F-01/E: a test process with a production-looking DATABASE_URL refuses to validate', () => {
  const r = runChild(
    `try {
       const { loadAndValidate } = require('./scripts/test-env');
       loadAndValidate();
       console.log(JSON.stringify({ refused: false }));
     } catch (e) {
       console.log(JSON.stringify({ refused: true, message: e.message, resend: process.env.RESEND_API_KEY ?? null }));
     }`,
    {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/prod_db',
      ...AMBIENT_PROD,
    }
  );

  assert.strictEqual(r.status, 0, `child failed: ${r.stderr}`);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  assert.strictEqual(out.refused, true, 'loadAndValidate must refuse a production URL');
  assert.ok(out.message.includes('REFUSED'), 'message must be the explicit REFUSED banner');
  assert.strictEqual(out.resend, null, 'strip must have run even though validation failed');
});

// ─────────────────────────────────────────
// F — THE REAL TEST-DB GUARD STILL PROTECTS
// ─────────────────────────────────────────
test('F-01/F1: the real guard script exits 1 against a production-looking DATABASE_URL', () => {
  const r = runChild(
    `require('./scripts/test-db-guard');`,
    {
      DATABASE_URL: 'postgresql://user:pass@db.example.com:5432/prod_db',
      RESEND_API_KEY: 'sk_prod_ambient_probe_1234567890',
    }
  );

  assert.strictEqual(r.status, 1, 'guard must refuse (exit 1)');
  assert.ok(r.stderr.includes('REFUSED') || r.stderr.includes('not the isolated test database'),
    `stderr must explain the refusal: ${r.stderr}`);
});

test('F-01/F2: the real guard script passes for the approved local test database', () => {
  const r = runChild(
    `require('./scripts/test-db-guard');`,
    {
      DATABASE_URL: 'postgresql://postgres:testpass@localhost:5434/ys_matrix_test',
      RESEND_API_KEY: 'sk_prod_ambient_probe_1234567890',
    }
  );

  assert.strictEqual(r.status, 0, `guard must pass for the test db: ${r.stderr}`);
  assert.ok(r.stdout.includes('PASS'), 'guard must print its PASS banner');
});