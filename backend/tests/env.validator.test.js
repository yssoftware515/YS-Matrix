'use strict';
// Phase A (P2-4) — environment validator unit coverage. The pure
// collectEnvProblems() core is tested against synthetic env objects
// (no process.env mutation, no process.exit): production requires a
// strong CRON_SECRET (missing/placeholder → flagged), non-production
// tolerates its absence but still rejects weak values, and the
// pre-existing JWT/origins/bcrypt rules keep working unchanged.
const test = require('node:test');
const assert = require('node:assert');

const { collectEnvProblems } = require('../src/config/env.validator');

const SECRET_A = 'a'.repeat(64);
const SECRET_B = 'b'.repeat(64);
const CRON_OK  = 'c'.repeat(64);

const validProdEnv = {
  JWT_ACCESS_SECRET: SECRET_A,
  JWT_REFRESH_SECRET: SECRET_B,
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  ALLOWED_ORIGINS: 'https://app.ys-matrix.com',
  CRON_SECRET: CRON_OK,
};

test('env validator: valid production environment passes clean', () => {
  assert.deepStrictEqual(collectEnvProblems(validProdEnv, true), []);
});

test('env validator: production WITHOUT CRON_SECRET is flagged', () => {
  const env = { ...validProdEnv, CRON_SECRET: undefined };
  const problems = collectEnvProblems(env, true);
  assert.ok(problems.some((p) => p.startsWith('CRON_SECRET')), `CRON_SECRET must be required in production. Got: ${problems}`);
});

test('env validator: production with a KNOWN PLACEHOLDER CRON_SECRET is flagged', () => {
  const env = { ...validProdEnv, CRON_SECRET: 'changeme' };
  const problems = collectEnvProblems(env, true);
  assert.ok(problems.some((p) => p.startsWith('CRON_SECRET') && p.includes('placeholder')));
});

test('env validator: production with a SHORT CRON_SECRET is flagged', () => {
  const env = { ...validProdEnv, CRON_SECRET: 'short-secret' };
  const problems = collectEnvProblems(env, true);
  assert.ok(problems.some((p) => p.startsWith('CRON_SECRET') && p.includes('characters')));
});

test('env validator: non-production tolerates missing CRON_SECRET', () => {
  const env = { ...validProdEnv, CRON_SECRET: undefined };
  assert.deepStrictEqual(collectEnvProblems(env, false), []);
});

test('env validator: non-production still rejects a weak CRON_SECRET if set', () => {
  const env = { ...validProdEnv, CRON_SECRET: 'changeme' };
  const problems = collectEnvProblems(env, false);
  assert.ok(problems.some((p) => p.startsWith('CRON_SECRET')), 'a placeholder must never be accepted in any environment');
});

test('env validator: production with localhost origins is flagged', () => {
  const env = { ...validProdEnv, ALLOWED_ORIGINS: 'https://app.ys-matrix.com,http://localhost:3000' };
  const problems = collectEnvProblems(env, true);
  assert.ok(problems.some((p) => p.startsWith('ALLOWED_ORIGINS')));
});

test('env validator: identical JWT secrets are flagged', () => {
  const env = { ...validProdEnv, JWT_REFRESH_SECRET: SECRET_A };
  const problems = collectEnvProblems(env, true);
  assert.ok(problems.some((p) => p.includes('must NOT be the same value')));
});

test('env validator: missing JWT secrets are flagged in every environment', () => {
  const env = { ...validProdEnv, JWT_ACCESS_SECRET: undefined };
  const problems = collectEnvProblems(env, false);
  assert.ok(problems.some((p) => p.startsWith('JWT_ACCESS_SECRET')));
});

test('env validator: garbage BCRYPT_ROUNDS is flagged in every environment', () => {
  const env = { ...validProdEnv, BCRYPT_ROUNDS: '12abc' };
  const problems = collectEnvProblems(env, false);
  assert.ok(problems.some((p) => p.startsWith('BCRYPT_ROUNDS')));
});

test('env validator: production SUPER_ADMIN_PASSWORD placeholder is flagged when set', () => {
  const env = { ...validProdEnv, SUPER_ADMIN_PASSWORD: 'changeme' };
  const problems = collectEnvProblems(env, true);
  assert.ok(problems.some((p) => p.startsWith('SUPER_ADMIN_PASSWORD')));
});

// Phase 4C (4C-F1): the .env.example placeholder values themselves.
// All three are long enough to pass the 32-char strength gate on
// length alone — they must be rejected by NAME, not length.
test('env validator: production with the .env.example JWT_ACCESS_SECRET placeholder is flagged', () => {
  const env = { ...validProdEnv, JWT_ACCESS_SECRET: 'GENERATE_STRONG_64_CHAR_SECRET_HERE' };
  const problems = collectEnvProblems(env, true);
  assert.ok(
    problems.some((p) => p.startsWith('JWT_ACCESS_SECRET') && p.includes('placeholder')),
    `the .env.example template secret must never pass production validation. Got: ${problems}`
  );
});

test('env validator: production with the .env.example JWT_REFRESH_SECRET placeholder is flagged', () => {
  const env = { ...validProdEnv, JWT_REFRESH_SECRET: 'GENERATE_ANOTHER_STRONG_64_CHAR_SECRET_HERE' };
  const problems = collectEnvProblems(env, true);
  assert.ok(
    problems.some((p) => p.startsWith('JWT_REFRESH_SECRET') && p.includes('placeholder')),
    `the .env.example template secret must never pass production validation. Got: ${problems}`
  );
});

test('env validator: verbatim .env.example copy is rejected in production (JWT + superadmin)', () => {
  const env = {
    JWT_ACCESS_SECRET:    'GENERATE_STRONG_64_CHAR_SECRET_HERE',
    JWT_REFRESH_SECRET:   'GENERATE_ANOTHER_STRONG_64_CHAR_SECRET_HERE',
    DATABASE_URL:         'postgresql://user:pass@localhost:5432/db',
    ALLOWED_ORIGINS:      'https://app.ys-matrix.com',
    CRON_SECRET:          CRON_OK,
    SUPER_ADMIN_PASSWORD: 'enter strong pass',
  };
  const problems = collectEnvProblems(env, true);
  assert.ok(problems.some((p) => p.startsWith('JWT_ACCESS_SECRET') && p.includes('placeholder')));
  assert.ok(problems.some((p) => p.startsWith('JWT_REFRESH_SECRET') && p.includes('placeholder')));
  assert.ok(problems.some((p) => p.startsWith('SUPER_ADMIN_PASSWORD') && p.includes('placeholder')));
});