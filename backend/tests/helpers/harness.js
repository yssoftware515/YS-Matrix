'use strict';
// ============================================================
// Phase 0.5 integration harness.
//
// 1. Loads ONLY backend/.env.test (never backend/.env) via the
//    shared loader (src/config/env.js) — which additionally
//    STRIPS any production-surface key not approved in .env.test
//    (Phase 2 — F-01: RESEND_API_KEY and friends can no longer
//    leak in from backend/.env or the ambient environment).
// 2. Fail-closed guard: refuses to run unless DATABASE_URL
//    positively identifies the isolated local test database
//    (localhost:5433/ys_matrix_test).
// 3. Boots the real Express app (src/index.js) on an ephemeral
//    port and exposes HTTP helpers.
// 4. Exposes the unscoped Prisma client for fixtures/assertions.
//
// Import order is critical: env + guard MUST run before any
// module that instantiates Prisma or reads JWT config.
// ============================================================

const path = require('path');
const http = require('http');

// ── 1. test-only env (shared loader — the ONLY dotenv loader) ──────────────
require(path.join(__dirname, '..', '..', 'src', 'config', 'env')).loadTestEnv();

// ── 2. fail-closed guard (defense in depth — uses the SAME validator as
//      the destructive scripts; also enforced by scripts/test-db-guard.js
//      in the npm run chain) ────────────────────────────────────────────────
(function guard() {
  const { validateTestDbUrl } = require(path.join(__dirname, '..', '..', 'scripts', 'test-env.js'));
  const raw = process.env.DATABASE_URL;
  const res = validateTestDbUrl(raw);
  if (!res.ok) {
    console.error(`[HARNESS] REFUSED — integration tests must never run outside the isolated test database:\n  - ${res.problems.join('\n  - ')}`);
    process.exit(1);
  }
})();

// ── 3. real app + unscoped prisma (order: AFTER env guard) ─────────────────
const app = require(path.join(__dirname, '..', '..', 'src', 'index.js'));
const db = require(path.join(__dirname, '..', '..', 'src', 'config', 'database'));
const { baseClient } = db;

let server = null;

async function startServer() {
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return `http://127.0.0.1:${port}`;
}

async function stopServer() {
  if (server) {
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  await baseClient.$disconnect();
}

async function api(base, method, p, { token, body, query } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const qs = query
    ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)])).toString()}`
    : '';
  const res = await fetch(`${base}/api/v1${p}${qs}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty body */ }
  return { status: res.status, headers: res.headers, body: json };
}

module.exports = { startServer, stopServer, api, baseClient: db.baseClient || baseClient, db };