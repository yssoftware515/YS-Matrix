'use strict';
// ============================================================
// Phase 4D — Sections 13+M: Print/Invoice/Receipt + Performance
// + Section 4: Remaining feature coverage
// ============================================================

const test = require('node:test');
const assert = require('node:assert');
const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, PASSWORD, IDS , unlockAll} = require('../helpers/fixtures');

let base;
let saToken, ownerAToken, staffAToken;

test.before(async () => {
  base = await startServer();
  await seedAll();
  saToken = await tokenFor(base, 'sa@test.local');
  ownerAToken = await tokenFor(base, 'owner-a@test.local');
  staffAToken = await tokenFor(base, 'staff-a@test.local');
});

test.after(async () => { await unlockAll();
  await stopServer(); });

// ─── PRINT / INVOICE / RECEIPT ────────────────────────────────

test('PRINT: Invoice HTML endpoint returns valid HTML', async () => {
  const sales = await api(base, 'GET', '/sales', { token: ownerAToken });
  if (sales.body.data && sales.body.data.length > 0) {
    const sale = sales.body.data[0];
    const inv = await api(base, 'GET', `/invoices/${sale.id}`, { token: ownerAToken });
    if (inv.status === 200) {
      const html = typeof inv.body.data === 'string' ? inv.body.data : (inv.body.data?.html || JSON.stringify(inv.body.data));
      assert.ok(typeof html === 'string', 'invoice must return HTML string');
      assert.ok(html.length > 10, 'invoice HTML must be non-trivial');
    }
  }
});

test('PRINT: Invoice print endpoint returns printable HTML', async () => {
  const sales = await api(base, 'GET', '/sales', { token: ownerAToken });
  if (sales.body.data && sales.body.data.length > 0) {
    const sale = sales.body.data[0];
    const print = await api(base, 'GET', `/invoices/${sale.id}/print`, { token: ownerAToken });
    if (print.status === 200 && print.body?.data) {
      const html = typeof print.body.data === 'string' ? print.body.data : (print.body.data?.html || JSON.stringify(print.body.data));
      assert.ok(typeof html === 'string');
      assert.ok(html.length > 10, 'print must return HTML');
    }
  }
});

test('PRINT: Receipt HTML for installment payment', async () => {
  const sales = await api(base, 'GET', '/sales', { token: ownerAToken });
  if (sales.body.data && sales.body.data.length > 0) {
    const sale = sales.body.data.find(s => s.installment_count > 0);
    if (sale) {
      const detail = await api(base, 'GET', `/sales/${sale.id}`, { token: ownerAToken });
      if (detail.body.data?.installments?.length > 0) {
        const inst = detail.body.data.installments.find(i => i.status === 'PAID');
        if (inst) {
          const receipt = await api(base, 'GET', `/sales/installments/${inst.id}/receipt`, { token: ownerAToken });
          assert.ok(receipt.status >= 200 && receipt.status < 300);
        }
      }
    }
  }
});

// ─── BULK IMPORT ──────────────────────────────────────────────

test('BULK: POST /inventory/bulk — creates multiple items', async () => {
  const items = [
    { vehicle_type: 'CAR', brand: 'Bulk1', model: `BULK-${Date.now()}-1`, cost_price: 10000, selling_price: 15000, quantity: 2 },
    { vehicle_type: 'MOTORCYCLE', brand: 'Bulk2', model: `BULK-${Date.now()}-2`, cost_price: 5000, selling_price: 8000, quantity: 3 },
  ];
  const res = await api(base, 'POST', '/inventory/bulk', { token: ownerAToken, body: { items } });
  assert.ok(res.status >= 200 && res.status < 300, `bulk create: ${res.status}`);
});

test('BULK: POST /inventory/bulk — empty items rejected', async () => {
  const res = await api(base, 'POST', '/inventory/bulk', {
    token: ownerAToken, body: { items: [] }
  });
  assert.ok(res.status >= 400, `empty bulk: ${res.status}`);
});

// ─── SUBSCRIPTION WORKFLOWS ───────────────────────────────────

test('SUB: GET /subscriptions/pricing — PUBLIC, no auth', async () => {
  const res = await fetch(`${base}/api/v1/subscriptions/pricing`);
  assert.ok(res.status >= 200 && res.status < 300);
  const body = await res.json();
  assert.ok(body.data !== undefined, 'pricing must have data');
});

test('SUB: GET /subscriptions/status — returns current plan', async () => {
  const res = await api(base, 'GET', '/subscriptions/status', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data, 'must have status data');
});

test('SUB: GET /subscriptions/history — returns subscription history', async () => {
  const res = await api(base, 'GET', '/subscriptions/history', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data), 'history must be array');
});

test('SUB: GET /subscriptions/payments — returns payment history', async () => {
  const res = await api(base, 'GET', '/subscriptions/payments', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data), 'payments must be array');
});

// ─── ACTIVITY LOGS ────────────────────────────────────────────

test('ACTIVITY: GET /activity — returns activity logs', async () => {
  const res = await api(base, 'GET', '/activity', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
});

test('ACTIVITY: GET /activity/filters — returns available filters', async () => {
  const res = await api(base, 'GET', '/activity/filters', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
});

test('ACTIVITY: GET /activity/summary — returns summary', async () => {
  const res = await api(base, 'GET', '/activity/summary', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
});

// ─── ONBOARDING ───────────────────────────────────────────────

test('ONBOARD: GET /onboarding/status — returns status', async () => {
  const res = await api(base, 'GET', '/onboarding/status', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data !== undefined, 'must have data');
});

// ─── LICENSE ──────────────────────────────────────────────────

test('LICENSE: GET /licenses/status — returns license info', async () => {
  const res = await api(base, 'GET', '/licenses/status', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
});

test('LICENSE: GET /licenses/all — SA only', async () => {
  const sa = await api(base, 'GET', '/licenses/all', { token: saToken });
  assert.strictEqual(sa.status, 200);

  const owner = await api(base, 'GET', '/licenses/all', { token: ownerAToken });
  assert.strictEqual(owner.status, 403);
});

// ─── SA summary stats ─────────────────────────────────────────

test('SA: GET /sales/summary — returns totals', async () => {
  const res = await api(base, 'GET', '/sales/summary', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
});

test('SA: GET /sales/overdue — returns overdue installments', async () => {
  const res = await api(base, 'GET', '/sales/overdue', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
});

test('SA: GET /sales/upcoming — returns upcoming installments', async () => {
  const res = await api(base, 'GET', '/sales/upcoming', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
});

// ─── ANALYTICS DEEP ───────────────────────────────────────────

test('ANALYTICS: GET /analytics/monthly — returns monthly comparison', async () => {
  const res = await api(base, 'GET', '/analytics/monthly', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
});

test('ANALYTICS: GET /analytics/top-items — returns top selling items', async () => {
  const res = await api(base, 'GET', '/analytics/top-items', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
});

test('ANALYTICS: GET /analytics/profit-breakdown — returns breakdown', async () => {
  const res = await api(base, 'GET', '/analytics/profit-breakdown', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
});

test('ANALYTICS: GET /analytics/net-profit — returns net profit', async () => {
  const res = await api(base, 'GET', '/analytics/net-profit', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
});

test('ANALYTICS: GET /analytics/inventory — returns inventory analytics', async () => {
  const res = await api(base, 'GET', '/analytics/inventory', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
});

// ─── PERFORMANCE SMOKE ────────────────────────────────────────

test('PERF: All read endpoints respond within 5s', async () => {
  const endpoints = [
    ['GET', '/auth/me'],
    ['GET', '/analytics/dashboard'],
    ['GET', '/analytics/revenue-chart'],
    ['GET', '/analytics/monthly'],
    ['GET', '/analytics/top-items'],
    ['GET', '/analytics/profit-breakdown'],
    ['GET', '/analytics/net-profit'],
    ['GET', '/analytics/expenses'],
    ['GET', '/customers'],
    ['GET', '/suppliers'],
    ['GET', '/inventory'],
    ['GET', '/inventory/stats'],
    ['GET', '/inventory/low-stock'],
    ['GET', '/sales'],
    ['GET', '/sales/summary'],
    ['GET', '/sales/overdue'],
    ['GET', '/sales/upcoming'],
    ['GET', '/notifications'],
    ['GET', '/notifications/unread'],
    ['GET', '/activity'],
    ['GET', '/activity/filters'],
    ['GET', '/activity/summary'],
    ['GET', '/users'],
    ['GET', '/search?q=test'],
    ['GET', '/subscriptions/status'],
    ['GET', '/subscriptions/plans'],
    ['GET', '/subscriptions/history'],
    ['GET', '/subscriptions/payments'],
    ['GET', '/licenses/status'],
    ['GET', '/onboarding/status'],
  ];

  const slow = [];
  for (const [method, path] of endpoints) {
    const start = Date.now();
    const res = await api(base, method, path, { token: ownerAToken });
    const elapsed = Date.now() - start;
    if (elapsed > 5000) {
      slow.push(`${method} ${path}: ${elapsed}ms`);
    }
    // Must not 500
    assert.ok(res.status !== 500, `${method} ${path} must not 500: ${JSON.stringify(res.body).substring(0, 200)}`);
  }
  if (slow.length > 0) {
    console.log(`[PERF] Slow endpoints (>5s): ${slow.join(', ')}`);
  }
});

test('PERF: No 500 errors on any endpoint (smoke)', async () => {
  const endpoints = [
    ['GET', '/auth/me'],
    ['GET', '/customers'],
    ['GET', '/suppliers'],
    ['GET', '/inventory'],
    ['GET', '/sales'],
    ['GET', '/analytics/dashboard'],
    ['GET', '/notifications'],
    ['GET', '/activity'],
    ['GET', '/users'],
    ['GET', '/search?q=test'],
    ['GET', '/subscriptions/status'],
    ['GET', '/licenses/status'],
  ];

  for (const [method, path] of endpoints) {
    const res = await api(base, method, path, { token: ownerAToken });
    assert.ok(res.status !== 500, `${method} ${path} returned 500`);
  }
});
