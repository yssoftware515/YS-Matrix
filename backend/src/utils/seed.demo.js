// ============================================================
// YS-MATRIX ERP - Seed Script: Demo Data (NON-PRODUCTION ONLY)
// Author: Yahya Al-Sulami 🦅
// Run: node src/utils/seed.demo.js
//
// Creates the demo showroom, demo Owner/Staff, demo suppliers,
// and demo inventory. Hard-refuses to run when NODE_ENV=production
// — this data must never exist on a real customer deployment.
// ============================================================

'use strict';

require('../config/env').loadEnv();

const bcrypt = require('bcryptjs');
const { baseClient: db } = require('../config/database');
const SECURITY = require('../config/security');
const { validateEnvOrCrash } = require('../config/env.validator');
const logger = require('../config/logger');

const DEMO_OWNER_PASSWORD = process.env.DEMO_OWNER_PASSWORD || 'Demo@Owner2024!';
const DEMO_STAFF_PASSWORD = process.env.DEMO_STAFF_PASSWORD || 'Demo@Staff2024!';

async function main() {
  // General environment sanity — cannot bypass the shared validator.
  validateEnvOrCrash(logger);

  // Hard production guard. This check happens BEFORE any DB write.
  if (process.env.NODE_ENV === 'production') {
    console.error('🛑 seed.demo.js refused to run: NODE_ENV=production. Demo/mock data must never be seeded on a production deployment.');
    process.exit(1);
  }

  console.log('🌱 Seeding YS-MATRIX demo data...\n');

  const demoShowroom = await db.showroom.upsert({
    where: { slug: 'alnajma-demo' },
    update: {},
    create: {
      id: 'demo-showroom-001',
      name: 'معرض النجمة للدراجات',
      slug: 'alnajma-demo',
      address: 'صنعاء - شارع الستين',
      phone: '+967712345678',
      email: 'demo@showroom.com',
      is_active: true,
      license_expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });
  console.log('✅ Demo showroom:', demoShowroom.name);

  const ownerHash = await bcrypt.hash(DEMO_OWNER_PASSWORD, SECURITY.password.bcryptRounds);
  const demoOwner = await db.user.upsert({
    where: { email: 'owner@demo.com' },
    update: {},
    create: {
      showroom_id: demoShowroom.id,
      name: 'صاحب المعرض',
      email: 'owner@demo.com',
      password_hash: ownerHash,
      role: 'OWNER',
      is_active: true,
    },
  });
  console.log('✅ Demo owner:', demoOwner.email);

  const staffHash = await bcrypt.hash(DEMO_STAFF_PASSWORD, SECURITY.password.bcryptRounds);
  const demoStaff = await db.user.upsert({
    where: { email: 'staff@demo.com' },
    update: {},
    create: {
      showroom_id: demoShowroom.id,
      name: 'موظف المعرض',
      email: 'staff@demo.com',
      password_hash: staffHash,
      role: 'STAFF',
      is_active: true,
    },
  });
  console.log('✅ Demo staff:', demoStaff.email);

  const supplier1 = await db.supplier.upsert({
    where: { id: 'supplier-demo-001' },
    update: {},
    create: {
      id: 'supplier-demo-001',
      showroom_id: demoShowroom.id,
      name: 'شركة باجاج للاستيراد',
      phone: '+967771234567',
      total_due: 500000,
      total_paid: 250000,
    },
  });

  const supplier2 = await db.supplier.upsert({
    where: { id: 'supplier-demo-002' },
    update: {},
    create: {
      id: 'supplier-demo-002',
      showroom_id: demoShowroom.id,
      name: 'مورد قطع الغيار الصيني',
      phone: '+967781234567',
      total_due: 120000,
      total_paid: 80000,
    },
  });
  console.log('✅ Demo suppliers created');

  const inventoryItems = [
    { id: 'inv-demo-001', showroom_id: demoShowroom.id, vehicle_type: 'MOTORCYCLE', brand: 'باجاج', model: 'بوكسر 150', year: 2024, color: 'أحمر', engine_cc: 150, cost_price: 850000, selling_price: 1100000, quantity: 5, status: 'IN_STOCK', supplier_id: supplier1.id },
    { id: 'inv-demo-002', showroom_id: demoShowroom.id, vehicle_type: 'MOTORCYCLE', brand: 'هوندا', model: 'CG 125', year: 2024, color: 'أزرق', engine_cc: 125, cost_price: 700000, selling_price: 950000, quantity: 3, status: 'IN_STOCK', supplier_id: supplier1.id },
    { id: 'inv-demo-003', showroom_id: demoShowroom.id, vehicle_type: 'TUKTUK', brand: 'باجاج', model: 'ريكشا', year: 2024, color: 'أصفر', engine_cc: 200, cost_price: 1200000, selling_price: 1600000, quantity: 2, status: 'IN_STOCK', supplier_id: supplier1.id },
    { id: 'inv-demo-004', showroom_id: demoShowroom.id, vehicle_type: 'SPARE_PART', brand: 'عام', model: 'إطار خلفي 3.00-17', cost_price: 15000, selling_price: 25000, quantity: 20, status: 'IN_STOCK', supplier_id: supplier2.id },
  ];

  for (const item of inventoryItems) {
    await db.inventory.upsert({ where: { id: item.id }, update: {}, create: item });
  }
  console.log('✅ Demo inventory created (4 items)');

  console.log('\n🎉 Demo data seed complete!\n');
  console.log('━'.repeat(48));
  console.log('🔑 Demo Login Credentials:');
  console.log(`   Owner: owner@demo.com / ${DEMO_OWNER_PASSWORD}`);
  console.log(`   Staff: staff@demo.com / ${DEMO_STAFF_PASSWORD}`);
  console.log('━'.repeat(48) + '\n');
}

main()
  .catch((e) => {
    console.error('❌ Demo seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
