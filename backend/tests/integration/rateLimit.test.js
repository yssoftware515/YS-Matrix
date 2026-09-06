'use strict';
// ============================================================
// Phase 3 — Rate-limit enforcement (dedicated file).
//
// Deliberately isolated in its OWN file: limiter state is per-server
// boot (in-memory), and these tests BURN a limiter budget — running
// them alongside other suites in the same process would poison every
// later /auth call in that process.
//
// Ceilings asserted here are the .env.test values (test-only env,
// loaded via scripts/test-db-guard.js → src/config/env.js):
//   • auth limiter ............ RATE_LIMIT_AUTH_MAX=200 / 15min
//     (Phase 3 P3-A: now scoped to login + register-account ONLY —
//     the whole /auth prefix no longer shares this budget)
//   • forgot-password limiter . fixed 3 / 15min (not env-tunable)
//   • sensitive-ops limiter ... RATE_LIMIT_SENSITIVE_MAX=100 / 15min
//     (impersonate, reset-user-password, create user)
//   • superadmin limiter ...... RATE_LIMIT_SUPERADMIN_MAX=500 / 15min
//   • global limiter .......... RATE_LIMIT_MAX=10000 / 60s
//
// The asserted behavior (LAST call of each burst → 429) is the
// invariant regardless of the exact ceiling — if a ceiling ever
// changes, the burst size must track the new value.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, PASSWORD, IDS , unlockAll} = require('../helpers/fixtures');

let base;

test.before(async () => {
  base = await startServer();
  await seedAll();
});

test.after(async () => {
  await unlockAll();
  await stopServer();
});

// ─────────────────────────────────────────
// R3 — SENSITIVE-OPS LIMITER (ceiling 100)
// ─────────────────────────────────────────
// Runs FIRST: its tokenFor() login consumes 1 of the auth budget, and
// the R1 burst below counts every prior login in this file.
test('P3-R3: sensitive-ops limiter blocks the 101st impersonation (ceiling 100/15min)', async () => {
  const sa = await tokenFor(base, 'sa@test.local');

  for (let i = 0; i < 100; i++) {
    const res = await api(base, 'POST', `/superadmin/showrooms/${IDS.showroomA}/impersonate`, {
      token: sa,
    });
    assert.strictEqual(res.status, 200, `impersonate #${i + 1} must succeed under the ceiling`);
  }

  const blocked = await api(base, 'POST', `/superadmin/showrooms/${IDS.showroomA}/impersonate`, {
    token: sa,
  });
  assert.strictEqual(blocked.status, 429, 'the ceiling+1th impersonation is throttled');
  assert.ok(blocked.body.message, 'throttle message present');
});

// ─────────────────────────────────────────
// R2 — FORGOT-PASSWORD LIMITER (test ceiling 100)
// ─────────────────────────────────────────
test('P3-R2: forgot-password-request limiter blocks the 101st request (test ceiling 100/15min)', async () => {
  for (let i = 0; i < 100; i++) {
    const res = await api(base, 'POST', '/auth/forgot-password-request', {
      body: { email: 'owner-b@test.local' },
    });
    assert.strictEqual(res.status, 200, 'request #' + (i + 1) + ' gets the generic anti-enumeration 200');
  }

  const blocked = await api(base, 'POST', '/auth/forgot-password-request', {
    body: { email: 'owner-b@test.local' },
  });
  assert.strictEqual(blocked.status, 429, 'the ceiling+1th request is throttled');
  assert.ok(blocked.body.message, 'throttle message present');
});

// ─────────────────────────────────────────
// R1 — LOGIN LIMITER (ceiling 200)
// ─────────────────────────────────────────
// Runs LAST on purpose: R3's tokenFor() already consumed 1 of the 200
// login budget — so 199 more succeed (200 total), and the next one is
// the 201st overall and must be throttled.
test('P3-R1: auth limiter blocks the 201st login (test ceiling 200/15min)', async () => {
  for (let i = 0; i < 199; i++) {
    const res = await api(base, 'POST', '/auth/login', {
      body: { email: 'owner-a@test.local', password: PASSWORD },
    });
    assert.strictEqual(res.status, 200, `login #${i + 1} must succeed under the ceiling`);
  }

  const blocked = await api(base, 'POST', '/auth/login', {
    body: { email: 'owner-a@test.local', password: PASSWORD },
  });
  assert.strictEqual(blocked.status, 429, 'the ceiling+1th login is throttled');
  assert.strictEqual(blocked.body.code, 'RATE_LIMITED');
});