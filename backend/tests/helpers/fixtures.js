'use strict';
// ============================================================
// Phase 0.5 deterministic test fixtures.
//
// Synthetic identities ONLY — no real customer data anywhere.
// Uses the unscoped baseClient (cross-showroom writes need it).
// Safe to run from multiple test processes: idempotent under a
// Postgres advisory lock (deletes + recreates the fixed IDs).
// ============================================================

const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const { baseClient: db } = require('../../src/config/database');
const { seedAuthorization } = require('../../src/utils/seed.authorization');
const { encrypt } = require('../../src/utils/encryption');

const PASSWORD = 'Phase0#Test2026!';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

// Fixed TOTP secret for test SUPER_ADMIN — allows tokenFor() to
// generate valid codes programmatically without enrolling each time.
const SA_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';

const DAY = 24 * 60 * 60 * 1000;
const future = (d) => new Date(Date.now() + d * DAY).toISOString();

const IDS = {
  sys:       'sh-sys',
  showroomA: 'sh-a',
  showroomB: 'sh-b',
  showroomE: 'sh-e',   // expired license (-5d)
  showroomW: 'sh-w',   // warning window (+3d)
  showroomD: 'sh-d',   // inactive (for impersonation rejection)

  sa:    'u-sa',
  ownerA: 'u-oa', staffA: 'u-sta',
  ownerB: 'u-ob', staffB: 'u-stb',
  ownerE: 'u-oe', staffE: 'u-ste', ownerW: 'u-ow', ownerD: 'u-od',

  custA1: 'c-a1', custB1: 'c-b1',
  itemA1: 'i-a1',
  supA1: 's-a1',  supB1: 's-b1',
  saleCashA: 'sale-cash-a', saleInstA: 'sale-inst-a',
  instA1: 'inst-a1', instA2: 'inst-a2',
};

async function seedAll() {
  // Serialize concurrent test processes (node --test runs files in
  // parallel): advisory lock scoped to this session. The lock is
  // HELD for the entire test lifecycle (released by unlockAll())
  // so a parallel file cannot truncate tables mid-test.
  await db.$executeRawUnsafe('SELECT pg_advisory_lock(424242)');
  try {
    // FK-safe full wipe of the public schema (except Prisma's own
    // migrations table). CASCADE handles every relation — this can
    // never violate a constraint such as sale_items→inventory,
    // regardless of schema evolution.
    const rows = await db.$queryRawUnsafe(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`
    );
    if (rows.length > 0) {
      const tables = rows.map((r) => `"${r.tablename}"`).join(', ');
      await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables} RESTART IDENTITY CASCADE`);
    }

    // Phase 1 (Authorization Foundation) — sync the permission
    // catalog + parity profiles (idempotent, additive). Runs AFTER
    // the truncate so every integration file starts from the
    // canonical catalog state.
    await seedAuthorization();

    await db.showroom.createMany({
      data: [
        { id: IDS.sys,       name: 'System',     slug: 'system-showroom',   license_expiry: future(365), is_active: true,  is_onboarded: true },
        { id: IDS.showroomA, name: 'Showroom A', slug: 'showroom-a',        license_expiry: future(60),  is_active: true,  is_onboarded: true },
        { id: IDS.showroomB, name: 'Showroom B', slug: 'showroom-b',        license_expiry: future(60),  is_active: true,  is_onboarded: true },
        { id: IDS.showroomE, name: 'Expired S',  slug: 'showroom-expired',  license_expiry: future(-5),  is_active: true,  is_onboarded: true },
        { id: IDS.showroomW, name: 'Warning S',  slug: 'showroom-warning',  license_expiry: future(3.2), is_active: true,  is_onboarded: true },
        { id: IDS.showroomD, name: 'Disabled S', slug: 'showroom-disabled', license_expiry: future(30),  is_active: false, is_onboarded: true },
      ],
    });

    await db.user.createMany({
      data: [
        {
          id: IDS.sa, showroom_id: IDS.sys, name: 'Test Super Admin',
          email: 'sa@test.local', password_hash: PASSWORD_HASH,
          role: 'SUPER_ADMIN', is_active: true,
          totp_secret_encrypted: encrypt(SA_TOTP_SECRET),
          totp_enabled: true,
          backup_codes: [],
        },
        { id: IDS.ownerA, showroom_id: IDS.showroomA, name: 'Owner A',          email: 'owner-a@test.local',   password_hash: PASSWORD_HASH, role: 'OWNER',       is_active: true },
        { id: IDS.staffA, showroom_id: IDS.showroomA, name: 'Staff A',          email: 'staff-a@test.local',   password_hash: PASSWORD_HASH, role: 'STAFF',       is_active: true },
        { id: IDS.ownerB, showroom_id: IDS.showroomB, name: 'Owner B',          email: 'owner-b@test.local',   password_hash: PASSWORD_HASH, role: 'OWNER',       is_active: true },
        { id: IDS.staffB, showroom_id: IDS.showroomB, name: 'Staff B',          email: 'staff-b@test.local',   password_hash: PASSWORD_HASH, role: 'STAFF',       is_active: true },
        { id: IDS.ownerE, showroom_id: IDS.showroomE, name: 'Owner E',          email: 'owner-e@test.local',   password_hash: PASSWORD_HASH, role: 'OWNER',       is_active: true },
        { id: IDS.staffE, showroom_id: IDS.showroomE, name: 'Staff E',          email: 'staff-e@test.local',   password_hash: PASSWORD_HASH, role: 'STAFF',       is_active: true },
        { id: IDS.ownerW, showroom_id: IDS.showroomW, name: 'Owner W',          email: 'owner-w@test.local',   password_hash: PASSWORD_HASH, role: 'OWNER',       is_active: true },
        { id: IDS.ownerD, showroom_id: IDS.showroomD, name: 'Owner D',          email: 'owner-d@test.local',   password_hash: PASSWORD_HASH, role: 'OWNER',       is_active: true },
      ],
    });

    await db.customer.createMany({
      data: [
        { id: IDS.custA1, showroom_id: IDS.showroomA, name: 'Customer A One',  phone: '+10000000001' },
        { id: IDS.custB1, showroom_id: IDS.showroomB, name: 'Customer B One',  phone: '+10000000002' },
      ],
    });

    await db.inventory.createMany({
      data: [
        { id: IDS.itemA1, showroom_id: IDS.showroomA, vehicle_type: 'CAR', brand: 'Synth', model: 'A-1', cost_price: 8000, selling_price: 10000, quantity: 5, status: 'IN_STOCK' },
      ],
    });

    await db.supplier.createMany({
      data: [
        { id: IDS.supA1, showroom_id: IDS.showroomA, name: 'Supplier A One', total_due: 1000, total_paid: 0, is_active: false },
        { id: IDS.supB1, showroom_id: IDS.showroomB, name: 'Supplier B One', total_due: 500,  total_paid: 0, is_active: true  },
      ],
    });

    // CASH sale in A — cancellable; inventory pre-decremented (qty 4)
    await db.sale.create({
      data: {
        id: IDS.saleCashA, showroom_id: IDS.showroomA, customer_id: IDS.custA1, user_id: IDS.ownerA,
        invoice_number: 'INV-TEST-CASH-A', sale_type: 'CASH', status: 'ACTIVE',
        subtotal: 10000, discount: 0, total: 10000, profit: 2000,
        items: { create: [
          { id: 'si-cash-1', inventory_id: IDS.itemA1, quantity: 1, unit_price: 10000, cost_price: 8000, total_price: 10000, profit: 2000 },
        ] },
      },
    });
    await db.inventory.update({ where: { id: IDS.itemA1 }, data: { quantity: 4 } });

    // INSTALLMENT sale in A — 2 unpaid installments
    await db.sale.create({
      data: {
        id: IDS.saleInstA, showroom_id: IDS.showroomA, customer_id: IDS.custA1, user_id: IDS.ownerA,
        invoice_number: 'INV-TEST-INST-A', sale_type: 'INSTALLMENT', status: 'ACTIVE',
        subtotal: 20000, discount: 0, total: 20000, profit: 4000,
        down_payment: 5000, monthly_amount: 7500, installment_months: 2, next_due_date: future(30),
        installments: { create: [
          { id: IDS.instA1, amount: 7500, due_date: future(30), is_paid: false },
          { id: IDS.instA2, amount: 7500, due_date: future(60), is_paid: false },
        ] },
      },
    });
  } catch (err) {
    await db.$executeRawUnsafe('SELECT pg_advisory_unlock(424242)');
    throw err;
  }
  // Lock held until unlockAll() — prevents parallel truncate mid-test.
}

async function unlockAll() {
  await db.$executeRawUnsafe('SELECT pg_advisory_unlock(424242)');
}

async function tokenFor(base, email) {
  const res = await fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`login(${email}) failed: ${res.status} ${JSON.stringify(json)}`);

  const { data } = json;

  // SUPER_ADMIN login returns tempToken + mfa_required instead of
  // full session tokens. Complete the MFA flow programmatically:
  // 1. Generate a TOTP code from the known test secret
  // 2. Call /mfa/verify to exchange tempToken for accessToken
  if (data.mfa_required && data.tempToken) {
    const mfaCode = speakeasy.totp({
      secret: SA_TOTP_SECRET,
      encoding: 'base32',
    });

    const mfaRes = await fetch(`${base}/api/v1/mfa/verify`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${data.tempToken}`,
      },
      body: JSON.stringify({ code: mfaCode }),
    });
    const mfaJson = await mfaRes.json();
    if (!mfaRes.ok) throw new Error(`mfa/verify(${email}) failed: ${mfaRes.status} ${JSON.stringify(mfaJson)}`);
    return mfaJson.data.accessToken;
  }

  return data.accessToken;
}

module.exports = { seedAll, unlockAll, tokenFor, PASSWORD, IDS, SA_TOTP_SECRET };