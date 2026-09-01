// ============================================================
// YS-MATRIX ERP — Global Search Service (Phase 2 Stage 3)
// Single endpoint — searches across:
//   • Inventory (brand, model, chassis, engine)
//   • Customers (name, phone, national_id)
//   • Suppliers (name, phone)
//   • Sales (invoice_number)
// All results scoped to showroom — tenant isolation guaranteed
// ============================================================

'use strict';

const prisma = require('../config/database');

const MIN_QUERY_LENGTH = 2;
const MAX_RESULTS_PER_ENTITY = 5;

const globalSearch = async ({ showroomId, query }) => {
  const q = (query || '').trim();

  if (!q || q.length < MIN_QUERY_LENGTH) {
    throw Object.assign(
      new Error(`يجب أن يكون البحث حرفين على الأقل.`),
      { code: 'VALIDATION_ERROR' }
    );
  }

  const searchFilter = { contains: q, mode: 'insensitive' };

  // All 4 searches run in parallel — single round-trip to DB
  const [inventory, customers, suppliers, sales] = await Promise.all([

    // ── Inventory ──────────────────────────────────────────
    prisma.inventory.findMany({
      where: {
        showroom_id: showroomId,
        OR: [
          { brand:          searchFilter },
          { model:          searchFilter },
          { color:          searchFilter },
          { chassis_number: searchFilter },
          { engine_number:  searchFilter },
        ],
      },
      take:   MAX_RESULTS_PER_ENTITY,
      select: {
        id:           true,
        brand:        true,
        model:        true,
        vehicle_type: true,
        color:        true,
        status:       true,
        selling_price: true,
        quantity:     true,
      },
    }),

    // ── Customers ──────────────────────────────────────────
    prisma.customer.findMany({
      where: {
        showroom_id: showroomId,
        is_active:   true,
        OR: [
          { name:        searchFilter },
          { phone:       { contains: q } },
          { national_id: { contains: q } },
        ],
      },
      take:   MAX_RESULTS_PER_ENTITY,
      select: {
        id:          true,
        name:        true,
        phone:       true,
        national_id: true,
        address:     true,
      },
    }),

    // ── Suppliers ──────────────────────────────────────────
    prisma.supplier.findMany({
      where: {
        showroom_id: showroomId,
        is_active:   true,
        OR: [
          { name:  searchFilter },
          { phone: { contains: q } },
          { email: searchFilter },
        ],
      },
      take:   MAX_RESULTS_PER_ENTITY,
      select: {
        id:        true,
        name:      true,
        phone:     true,
        email:     true,
        total_due: true,
        total_paid: true,
      },
    }),

    // ── Sales / Invoices ───────────────────────────────────
    prisma.sale.findMany({
      where: {
        showroom_id: showroomId,
        OR: [
          { invoice_number: { contains: q, mode: 'insensitive' } },
          { customer: { name: searchFilter } },
          { customer: { phone: { contains: q } } },
        ],
      },
      take:   MAX_RESULTS_PER_ENTITY,
      orderBy: { sold_at: 'desc' },
      select: {
        id:             true,
        invoice_number: true,
        sale_type:      true,
        status:         true,
        total:          true,
        sold_at:        true,
        customer: {
          select: { name: true, phone: true },
        },
      },
    }),
  ]);

  const totalResults =
    inventory.length + customers.length + suppliers.length + sales.length;

  return {
    query:         q,
    total_results: totalResults,
    results: {
      inventory: {
        count: inventory.length,
        items: inventory,
        type:  'inventory',
        route: '/dashboard/inventory',
      },
      customers: {
        count: customers.length,
        items: customers,
        type:  'customer',
        route: '/dashboard/customers',
      },
      suppliers: {
        count: suppliers.length,
        items: suppliers,
        type:  'supplier',
        route: '/dashboard/suppliers',
      },
      sales: {
        count: sales.length,
        items: sales,
        type:  'sale',
        route: '/dashboard/sales',
      },
    },
  };
};

module.exports = { globalSearch };
