// ============================================================
// YS-MATRIX ERP - Seed Script: SuperAdmin (ALL environments)
// YS Systems & Software
// Run: node src/utils/seed.superadmin.js
//
// Creates/updates the System Showroom and the SuperAdmin user.
// This is the ONLY seed script permitted to run in production.
// It refuses to run without an explicit SUPER_ADMIN_PASSWORD —
// no fallback, ever, in any environment.
// ============================================================

'use strict';

require('../config/env').loadEnv();

const bcrypt = require('bcryptjs');
const { baseClient: db } = require('../config/database');
const SECURITY = require('../config/security');
const { validateEnvOrCrash, validateSuperAdminCredentialsOrCrash } = require('../config/env.validator');
const logger = require('../config/logger');

async function main() {
  // 1) General environment sanity (JWT secrets, DATABASE_URL, CORS-in-prod).
  //    Same gate index.js uses — this script cannot bypass it.
  validateEnvOrCrash(logger);

  // 2) Strict SuperAdmin credential gate — always enforced, no fallback.
  validateSuperAdminCredentialsOrCrash(logger);

  console.log('🌱 Seeding YS-MATRIX SuperAdmin...\n');

  const systemShowroomId = SECURITY.tenant.systemShowroomId;
  const adminEmail = process.env.SUPER_ADMIN_EMAIL || 'admin@ys-matrix.com';
  const adminName = process.env.SUPER_ADMIN_NAME || 'System Administrator';
  const adminPassword = process.env.SUPER_ADMIN_PASSWORD; // validated above — guaranteed present & sound

  const systemShowroom = await db.showroom.upsert({
    where: { slug: 'ys-matrix-system' },
    update: {},
    create: {
      id: systemShowroomId,
      name: 'YS-MATRIX System',
      slug: 'ys-matrix-system',
      is_active: true,
      license_expiry: new Date('2099-12-31'),
    },
  });
  console.log('✅ System showroom:', systemShowroom.name);

  const adminHash = await bcrypt.hash(adminPassword, SECURITY.password.bcryptRounds);

  const superAdmin = await db.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      showroom_id: systemShowroom.id,
      name: adminName,
      email: adminEmail,
      password_hash: adminHash,
      role: 'SUPER_ADMIN',
      is_active: true,
    },
  });
  console.log('✅ Super admin created:', superAdmin.email);

  console.log('\n🎉 SuperAdmin seed complete!\n');

  // Plaintext credentials are NEVER printed in production — stdout
  // gets captured by log aggregators, CI artifacts, and platform
  // logs, often retained indefinitely.
  if (process.env.NODE_ENV !== 'production') {
    console.log('━'.repeat(48));
    console.log('🔑 SuperAdmin Login Credentials:');
    console.log(`   Email:    ${adminEmail}`);
    console.log(`   Password: ${adminPassword}`);
    console.log('━'.repeat(48) + '\n');
  } else {
    console.log('🔒 Credentials not printed (NODE_ENV=production). Use the SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD you configured.\n');
  }
}

main()
  .catch((e) => {
    console.error('❌ SuperAdmin seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
