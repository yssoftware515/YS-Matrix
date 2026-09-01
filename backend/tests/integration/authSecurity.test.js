'use strict';
// ============================================================
// Phase 3 — Authentication & Session Security.
// Coverage for the security-audit surface (report P3-A..P3-R):
//   • Login response hygiene — no password_hash / token hashes /
//     lockout state leaks to the client
//   • Refresh-token lifecycle — rotation, single-use burn, replay
//     blocked, CONCURRENT race (exactly one winner, loser gets a
//     clean 401 — P3-B, never a 500), revoked by logout / password
//     change / password reset, expired rows, malformed input
//   • Access-token-after-logout — the stateless-JWT 15-minute window
//     is a DOCUMENTED design characteristic (refresh revocation is
//     the designed kill-switch), asserted here so it can never be
//     mistaken for a regression
//   • Deactivation is effective immediately (per-request DB check),
//     and refresh is blocked while the account is inactive
//   • Concurrent logins for the same user in the same second — the
//     jwtid nonce (config/jwt.js) makes every minted token unique
//   • Password-reset token lifecycle — single-use burn, replay
//     blocked, superseded by a newer request, expiry enforced, and
//     a completed reset revokes every existing refresh token
//   • Impersonation — access-only (no refresh token issued), cannot
//     reach the /superadmin surface (privilege boundary), and the
//     access token cannot be traded for a session via /auth/refresh
//   • /auth/me hygiene — no tokens in the response
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, PASSWORD, IDS } = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const future = (ms = 3600_000) => new Date(Date.now() + ms);
const hex = () => crypto.randomBytes(16).toString('hex');

let base;

test.before(async () => {
  base = await startServer();
  await seedAll();
});

test.after(async () => {
  await stopServer();
});

async function login(email = 'owner-a@test.local', password = PASSWORD) {
  const res = await api(base, 'POST', '/auth/login', { body: { email, password } });
  assert.strictEqual(res.status, 200, `login(${email}) should succeed`);
  return res.body.data;
}

const refresh = (refreshToken) =>
  api(base, 'POST', '/auth/refresh', { body: { refreshToken } });

// Seed a password-reset token row directly (hash-to-hash, exactly as
// forgotPasswordRequest would) and return the RAW token for the API.
async function craftReset(userId, { expired = false } = {}) {
  const raw = `rt-${hex()}`;
  await db.passwordResetToken.create({
    data: {
      user_id:    userId,
      token_hash: sha256(raw),
      expires_at: expired ? future(-60_000) : future(),
    },
  });
  return raw;
}

const resetVia = (token, newPassword) =>
  api(base, 'POST', '/auth/reset-password', { body: { token, newPassword, confirmPassword: newPassword } });

// ─────────────────────────────────────────
// P3-1 — LOGIN RESPONSE HYGIENE
// ─────────────────────────────────────────
test('P3-1: login response leaks no password hash, lockout state, or tokens in user', async () => {
  const data = await login();
  assert.ok(data.accessToken, 'access token present');
  assert.ok(data.refreshToken, 'refresh token present');

  assert.ok(!('password_hash' in data.user), 'password_hash never in the response');
  assert.ok(!('failed_login_attempts' in data.user), 'lockout counter never in the response');
  assert.ok(!('locked_until' in data.user), 'lockout window never in the response');
  assert.ok(!('accessToken' in data.user) && !('refreshToken' in data.user), 'tokens not nested in user');
});

// ─────────────────────────────────────────
// P3-2 — REFRESH ROTATION
// ─────────────────────────────────────────
test('P3-2: refresh rotates the token — new pair issued, old token burned', async () => {
  const d = await login();

  const r1 = await refresh(d.refreshToken);
  assert.strictEqual(r1.status, 200, 'refresh succeeds');
  assert.ok(r1.body.data.accessToken, 'new access token issued');
  assert.ok(r1.body.data.refreshToken, 'new refresh token issued');
  assert.notStrictEqual(r1.body.data.refreshToken, d.refreshToken, 'token rotated, not reissued');

  const oldRow = await db.refreshToken.findUnique({ where: { token: sha256(d.refreshToken) } });
  assert.strictEqual(oldRow, null, 'old token row burned');
  const newRow = await db.refreshToken.findUnique({ where: { token: sha256(r1.body.data.refreshToken) } });
  assert.ok(newRow, 'new token row stored (hashed)');
});

// ─────────────────────────────────────────
// P3-3 — REPLAY (SEQUENTIAL)
// ─────────────────────────────────────────
test('P3-3: replaying an already-rotated refresh token is rejected with 401', async () => {
  const d = await login();
  const r1 = await refresh(d.refreshToken);
  assert.strictEqual(r1.status, 200);

  const replay = await refresh(d.refreshToken);
  assert.strictEqual(replay.status, 401, 'consumed token never issues a second session');
  assert.strictEqual(replay.body.code, 'REFRESH_TOKEN_NOT_FOUND');
});

// ─────────────────────────────────────────
// P3-4 — CONCURRENT RACE (P3-B regression)
// ─────────────────────────────────────────
test('P3-4: concurrent refresh of one token — exactly one winner, loser gets clean 401, never 500', async () => {
  const d = await login();
  const [a, b] = await Promise.all([refresh(d.refreshToken), refresh(d.refreshToken)]);

  const winners = [a, b].filter((r) => r.status === 200);
  assert.strictEqual(winners.length, 1, 'exactly one session may be minted from one token');
  assert.strictEqual(winners[0].body.data.refreshToken, winners[0].body.data.refreshToken);

  const losers = [a, b].filter((r) => r.status !== 200);
  assert.strictEqual(losers.length, 1, 'exactly one loser');
  assert.notStrictEqual(losers[0].status, 500, 'P3-B: a replay race must not surface as a server error');
  assert.strictEqual(losers[0].status, 401);
});

// ─────────────────────────────────────────
// P3-5 — LOGOUT REVOKES
// ─────────────────────────────────────────
test('P3-5: logout revokes the refresh token — subsequent refresh is 401', async () => {
  const d = await login();
  const lg = await api(base, 'POST', '/auth/logout', {
    token: d.accessToken,
    body:  { refreshToken: d.refreshToken },
  });
  assert.strictEqual(lg.status, 200, 'logout succeeds');

  const r = await refresh(d.refreshToken);
  assert.strictEqual(r.status, 401, 'revoked refresh token is dead');
});

// ─────────────────────────────────────────
// P3-6 — CHANGE-PASSWORD REVOKES ALL SESSIONS
// ─────────────────────────────────────────
test('P3-6: change-password revokes every refresh token; new password logs in', async () => {
  const d = await login();
  const cp = await api(base, 'PUT', '/auth/change-password', {
    token: d.accessToken,
    body:  { currentPassword: PASSWORD, newPassword: 'NewPass#2026!', confirmPassword: 'NewPass#2026!' },
  });
  assert.strictEqual(cp.status, 200, 'change-password succeeds');

  const r = await refresh(d.refreshToken);
  assert.strictEqual(r.status, 401, 'old session revoked by password change');

  // restore the fixture password so later tests keep working
  const back = await api(base, 'PUT', '/auth/change-password', {
    token: d.accessToken,
    body:  { currentPassword: 'NewPass#2026!', newPassword: PASSWORD, confirmPassword: PASSWORD },
  });
  assert.strictEqual(back.status, 200, 'password restored');
});

// ─────────────────────────────────────────
// P3-7 — PASSWORD-RESET REVOKES ALL SESSIONS
// ─────────────────────────────────────────
test('P3-7: password reset revokes existing sessions and accepts the new password', async () => {
  const d = await login('staff-a@test.local');
  const raw = await craftReset(IDS.staffA);

  const rs = await resetVia(raw, 'ResetPass#2026!');
  assert.strictEqual(rs.status, 200, 'reset succeeds');

  const r = await refresh(d.refreshToken);
  assert.strictEqual(r.status, 401, 'pre-reset refresh token revoked');

  const rel = await api(base, 'POST', '/auth/login', {
    body: { email: 'staff-a@test.local', password: 'ResetPass#2026!' },
  });
  assert.strictEqual(rel.status, 200, 'new password logs in');

  // restore the fixture password via a fresh reset token
  const raw2 = await craftReset(IDS.staffA);
  const back = await resetVia(raw2, PASSWORD);
  assert.strictEqual(back.status, 200, 'fixture password restored');
});

// ─────────────────────────────────────────
// P3-8 — RESET TOKEN SINGLE-USE
// ─────────────────────────────────────────
test('P3-8: reset token is single-use — replay is rejected even within its TTL', async () => {
  const raw = await craftReset(IDS.ownerB);

  const first = await resetVia(raw, 'ReplayPass#2026!');
  assert.strictEqual(first.status, 200, 'first use succeeds');

  const replay = await resetVia(raw, 'AnotherPass#2026!');
  assert.strictEqual(replay.status, 401, 'burned token cannot reset again');
  assert.strictEqual(replay.body.code, 'RESET_TOKEN_INVALID');

  // restore the fixture password
  const raw2 = await craftReset(IDS.ownerB);
  const back = await resetVia(raw2, PASSWORD);
  assert.strictEqual(back.status, 200, 'fixture password restored');
});

// ─────────────────────────────────────────
// P3-9 — RESET TOKEN SUPERSEDED
// ─────────────────────────────────────────
test('P3-9: a newer forgot-password request invalidates the previous still-valid link', async () => {
  const rawT1 = await craftReset(IDS.ownerB);

  const req = await api(base, 'POST', '/auth/forgot-password-request', {
    body: { email: 'owner-b@test.local' },
  });
  assert.strictEqual(req.status, 200, 'generic anti-enumeration response');
  assert.strictEqual(req.body.data, null, 'no token material in the response');

  const old = await resetVia(rawT1, 'Superseded#2026!');
  assert.strictEqual(old.status, 401, 'superseded token is dead');
  assert.strictEqual(old.body.code, 'RESET_TOKEN_INVALID');
});

// ─────────────────────────────────────────
// P3-10 — RESET TOKEN EXPIRY
// ─────────────────────────────────────────
test('P3-10: expired reset token is rejected', async () => {
  const raw = await craftReset(IDS.ownerB, { expired: true });
  const r = await resetVia(raw, 'ExpiredPass#2026!');
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.code, 'RESET_TOKEN_INVALID');
});

// ─────────────────────────────────────────
// P3-11 — ACCESS-TOKEN-AFTER-LOGOUT (DOCUMENTED)
// ─────────────────────────────────────────
test('P3-11: access token stays valid for its stateless window after logout (documented design)', async () => {
  const d = await login();
  const lg = await api(base, 'POST', '/auth/logout', {
    token: d.accessToken,
    body:  { refreshToken: d.refreshToken },
  });
  assert.strictEqual(lg.status, 200);

  // The 15-minute stateless-JWT window after logout is a documented
  // trade-off (refresh revocation is the real kill-switch). This
  // asserts the characteristic is stable — NOT that it is a vuln.
  const me = await api(base, 'GET', '/auth/me', { token: d.accessToken });
  assert.strictEqual(me.status, 200, 'stateless access token valid for up to 15m — by design');

  const r = await refresh(d.refreshToken);
  assert.strictEqual(r.status, 401, 'the session itself is dead');
});

// ─────────────────────────────────────────
// P3-12 — DEACTIVATION IS IMMEDIATE
// ─────────────────────────────────────────
test('P3-12: deactivated account is blocked per-request, refresh included, with the distinct code', async () => {
  const d = await login('staff-a@test.local');

  await db.user.update({ where: { id: IDS.staffA }, data: { is_active: false } });
  try {
    const me = await api(base, 'GET', '/auth/me', { token: d.accessToken });
    assert.strictEqual(me.status, 401, 'existing access token dies immediately');
    assert.strictEqual(me.body.code, 'ACCOUNT_DISABLED', 'distinct deactivation code');

    const r = await refresh(d.refreshToken);
    assert.strictEqual(r.status, 401, 'refresh refused for an inactive account');
  } finally {
    await db.user.update({ where: { id: IDS.staffA }, data: { is_active: true } });
  }
});

// ─────────────────────────────────────────
// P3-13 — CONCURRENT LOGINS (JWTID NONCE)
// ─────────────────────────────────────────
test('P3-13: two logins for the same user in the same second both succeed with distinct tokens', async () => {
  const [a, b] = await Promise.all([
    login('owner-a@test.local'),
    login('owner-a@test.local'),
  ]);

  assert.ok(a.accessToken && b.accessToken, 'both sessions issued');
  assert.notStrictEqual(a.refreshToken, b.refreshToken, 'jwtid nonce mints distinct refresh tokens');

  const ra = await refresh(a.refreshToken);
  const rb = await refresh(b.refreshToken);
  assert.strictEqual(ra.status, 200, 'session A usable');
  assert.strictEqual(rb.status, 200, 'session B usable');
});

// ─────────────────────────────────────────
// P3-14 — IMPERSONATION PRIVILEGE BOUNDARY
// ─────────────────────────────────────────
test('P3-14: impersonation session is access-only, cannot reach /superadmin, cannot be refreshed', async () => {
  const sa = await login('sa@test.local');

  const imp = await api(base, 'POST', `/superadmin/showrooms/${IDS.showroomA}/impersonate`, {
    token: sa.accessToken,
  });
  assert.strictEqual(imp.status, 200, 'impersonation issued');
  assert.ok(imp.body.data.accessToken, 'access token present');
  assert.ok(!('refreshToken' in imp.body.data), 'impersonation is access-only — no refresh token');

  const impToken = imp.body.data.accessToken;

  // identity resolution works on the impersonated OWNER…
  const me = await api(base, 'GET', '/auth/me', { token: impToken });
  assert.strictEqual(me.status, 200, 'impersonated identity resolves');
  assert.strictEqual(me.body.data.id, IDS.ownerA, 'resolves to the impersonated owner');

  // …but the privilege boundary holds: no /superadmin surface.
  const probe = await api(base, 'GET', '/superadmin/users', { token: impToken });
  assert.strictEqual(probe.status, 403, 'impersonated OWNER is not a SUPER_ADMIN on the platform surface');

  // and the access token cannot be traded for a session.
  const rf = await refresh(impToken);
  assert.strictEqual(rf.status, 401, 'refresh rejects an access token');
});

// ─────────────────────────────────────────
// P3-15 — ME RESPONSE HYGIENE
// ─────────────────────────────────────────
test('P3-15: /auth/me returns no tokens', async () => {
  const d = await login();
  const me = await api(base, 'GET', '/auth/me', { token: d.accessToken });
  assert.strictEqual(me.status, 200);
  assert.ok(!('accessToken' in me.body.data), 'no access token');
  assert.ok(!('refreshToken' in me.body.data), 'no refresh token');
  assert.ok(!('password_hash' in me.body.data), 'no password hash');
});

// ─────────────────────────────────────────
// P3-16 — MALFORMED REFRESH INPUT
// ─────────────────────────────────────────
test('P3-16: malformed refresh token is rejected cleanly, never 500', async () => {
  const r = await refresh('definitely-not-a-jwt');
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.code, 'REFRESH_TOKEN_INVALID');
});

// ─────────────────────────────────────────
// P3-17 — EXPIRED REFRESH TOKEN ROW
// ─────────────────────────────────────────
test('P3-17: expired refresh token row yields REFRESH_TOKEN_EXPIRED and is deleted', async () => {
  const d = await login();
  await db.refreshToken.update({
    where: { token: sha256(d.refreshToken) },
    data:  { expires_at: future(-60_000) },
  });

  const r = await refresh(d.refreshToken);
  assert.strictEqual(r.status, 401);
  assert.strictEqual(r.body.code, 'REFRESH_TOKEN_EXPIRED');

  const row = await db.refreshToken.findUnique({ where: { token: sha256(d.refreshToken) } });
  assert.strictEqual(row, null, 'expired row cleaned up');
});