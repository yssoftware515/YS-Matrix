'use strict';
// Batch 5 — P0-B: national_id visibility restriction tests.
// Verifies that STAFF users cannot see national_id in customer
// list, customer detail, search results, and invoice endpoints.
// OWNER and SUPER_ADMIN can still see it.

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');

const { startServer, stopServer, api } = require('../helpers/harness');
const { seedAll, tokenFor, IDS , unlockAll} = require('../helpers/fixtures');
const { baseClient: db } = require('../../src/config/database');

const cuid = () => `c${crypto.randomBytes(12).toString('hex')}`;

let base;
let superToken, ownerAToken, staffAToken;
let customerId;

test.before(async () => {
  base = await startServer();
  await seedAll();

  superToken  = await tokenFor(base, 'sa@test.local');
  ownerAToken = await tokenFor(base, 'owner-a@test.local');
  staffAToken = await tokenFor(base, 'staff-a@test.local');

  // Create a customer with national_id for testing
  const res = await api(base, 'POST', '/customers', {
    token: ownerAToken,
    body: {
      name: 'PII Test Customer',
      phone: '+967700999000',
      national_id: `NID-PII-${cuid()}`,
      address: 'Test Address',
    },
  });
  customerId = res.body.data.id;
});

test.after(async () => {
  await unlockAll();
  await stopServer();
});

// ── Customer List ────────────────────────────────────────────

test('PII-B1: OWNER sees national_id in customer list', async () => {
  const res = await api(base, 'GET', '/customers', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
  const customer = res.body.data.find((c) => c.id === customerId);
  assert.ok(customer, 'customer should exist in list');
  assert.ok(customer.national_id, 'OWNER should see national_id');
});

test('PII-B2: STAFF does NOT see national_id in customer list', async () => {
  const res = await api(base, 'GET', '/customers', { token: staffAToken });
  assert.strictEqual(res.status, 200);
  const customer = res.body.data.find((c) => c.id === customerId);
  assert.ok(customer, 'customer should exist in list');
  assert.strictEqual(customer.national_id, undefined, 'STAFF must not see national_id');
});

test('PII-B3: SUPER_ADMIN sees national_id in customer list', { skip: 'SUPER_ADMIN login now requires MFA enrollment — skip until MFA test harness is built' }, async () => {
  const res = await api(base, 'GET', '/customers', { token: superToken });
  assert.strictEqual(res.status, 200);
  const customer = res.body.data.find((c) => c.id === customerId);
  assert.ok(customer, 'customer should exist in list');
  assert.ok(customer.national_id, 'SUPER_ADMIN should see national_id');
});

// ── Customer Detail ──────────────────────────────────────────

test('PII-B4: OWNER sees national_id in customer detail', async () => {
  const res = await api(base, 'GET', `/customers/${customerId}`, { token: ownerAToken });
  assert.strictEqual(res.status, 200);
  assert.ok(res.body.data.national_id, 'OWNER should see national_id in detail');
});

test('PII-B5: STAFF does NOT see national_id in customer detail', async () => {
  const res = await api(base, 'GET', `/customers/${customerId}`, { token: staffAToken });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.national_id, undefined, 'STAFF must not see national_id in detail');
});

// ── Global Search ────────────────────────────────────────────

test('PII-B6: OWNER sees national_id in search results', async () => {
  const res = await api(base, 'GET', '/search?q=PII Test', { token: ownerAToken });
  assert.strictEqual(res.status, 200);
  const customer = res.body.data.results.customers.items.find((c) => c.id === customerId);
  assert.ok(customer, 'customer should appear in search');
  assert.ok(customer.national_id, 'OWNER should see national_id in search');
});

test('PII-B7: STAFF does NOT see national_id in search results', async () => {
  const res = await api(base, 'GET', '/search?q=PII Test', { token: staffAToken });
  assert.strictEqual(res.status, 200);
  const customer = res.body.data.results.customers.items.find((c) => c.id === customerId);
  assert.ok(customer, 'customer should appear in search');
  assert.strictEqual(customer.national_id, undefined, 'STAFF must not see national_id in search');
});
