// ============================================================
// YS-MATRIX ERP — Supplier Service (Phase 2 Stage 2)
// ============================================================

'use strict';

const prisma = require('../config/database');
const { Prisma } = require('@prisma/client');
const { getPagination, buildPaginationMeta, getOrderBy } = require('../utils/pagination');

const ALLOWED_SORT = ['name', 'total_due', 'total_paid', 'created_at'];

// ─────────────────────────────────────────
// SUPPLIER LEDGER SEMANTICS (documented decision — production hardening)
// ─────────────────────────────────────────
// The Supplier model carries two accumulated counters (schema.prisma):
//   • total_due  — CUMULATIVE declared purchases from this supplier.
//     It is initialized to 0 at createSupplier and is NOT auto-
//     incremented by inventory creation (inventory.create merely
//     links supplier_id; it does not touch the ledger). In current
//     business logic the figure is maintained manually (seeds set
//     demo balances) — i.e. it is the business's declared outstanding
//     purchase volume, never a derived/averaged number.
//   • total_paid — cumulative payments made to the supplier; the ONLY
//     counter incremented by code (addPayment, atomically with the
//     SupplierPayment row).
//   • balance    — computed ALWAYS as `total_due - total_paid` at
//     read time (listSuppliers/getSupplier/getSupplierStats); never
//     stored.
// Consequently `total_due` alone is NOT "amount currently owed" —
// the current owed amount is `balance`. addPayment enforces
// amount ≤ balance (overpayment blocked atomically). Reports
// (analytics.service.js) sum total_due/total_paid and derive the
// same balance. This is the intended deferred-ledger behavior; do
// not reinterpret total_due as a live debt accumulator without a
// product decision to auto-accrue purchases on inventory creation.
// ─────────────────────────────────────────

// ─────────────────────────────────────────
// LIST
// ─────────────────────────────────────────
const listSuppliers = async ({ showroomId, query }) => {
  const { page, limit, skip } = getPagination(query);
  const { search, include_inactive } = query;

  const orderBy = getOrderBy(query, ALLOWED_SORT, 'name', 'asc');
  const where   = { showroom_id: showroomId };

  if (include_inactive !== 'true') where.is_active = true;

  if (search) {
    where.OR = [
      { name:  { contains: search, mode: 'insensitive' } },
      { phone: { contains: search } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [suppliers, total] = await Promise.all([
    prisma.supplier.findMany({
      where,
      skip,
      take:    limit,
      orderBy,
      include: { _count: { select: { inventory: true, payments: true } } },
    }),
    prisma.supplier.count({ where }),
  ]);

  const suppliersWithBalance = suppliers.map((s) => ({
    ...s,
    balance: parseFloat(s.total_due) - parseFloat(s.total_paid),
  }));

  return { suppliers: suppliersWithBalance, pagination: buildPaginationMeta(total, page, limit) };
};

// ─────────────────────────────────────────
// GET ONE
// ─────────────────────────────────────────
const getSupplier = async ({ showroomId, id }) => {
  const supplier = await prisma.supplier.findFirst({
    where: { id, showroom_id: showroomId },
    include: {
      payments:  { orderBy: { paid_at: 'desc' }, take: 20 },
      inventory: {
        where:  { status: 'IN_STOCK' },
        select: {
          id: true, vehicle_type: true, brand: true,
          model: true, quantity: true, selling_price: true, status: true,
        },
        take: 20,
      },
      _count: { select: { inventory: true, payments: true } },
    },
  });

  if (!supplier) return null;

  return {
    ...supplier,
    balance: parseFloat(supplier.total_due) - parseFloat(supplier.total_paid),
  };
};

// ─────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────
const createSupplier = async ({ showroomId, data }) => {
  const { name, phone, email, address, notes } = data;

  if (!name?.trim()) {
    throw Object.assign(new Error('اسم المورد مطلوب.'), { code: 'VALIDATION_ERROR' });
  }

  return prisma.supplier.create({
    data: {
      showroom_id: showroomId,
      name:        name.trim(),
      phone:       phone   || null,
      email:       email   || null,
      address:     address || null,
      notes:       notes   || null,
      is_active:   true,
      total_due:   0,
      total_paid:  0,
    },
  });
};

// ─────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────
const updateSupplier = async ({ showroomId, id, data }) => {
  const existing = await prisma.supplier.findFirst({ where: { id, showroom_id: showroomId } });
  if (!existing) throw Object.assign(new Error('المورد غير موجود.'), { code: 'NOT_FOUND' });

  const { name, phone, email, address, notes } = data;

  // STRICT name validation: `name && { name }` treated an explicit empty
  // string / whitespace-only name as "field not sent" and silently kept
  // the old name — no error surfaced to the client. Worse, a
  // whitespace-only name ("   ") is truthy in JS, so it would have been
  // saved AS-IS with no trim — garbage data with zero indication anything
  // went wrong.
  //
  // New semantics (matches PATCH conventions already used below for
  // phone/email/address/notes, but name is a REQUIRED field so an
  // explicitly-empty value is an error, not a "clear the field" request):
  //   - `name` key absent from payload   → untouched (partial update)
  //   - `name` present but empty/blank   → reject with 400
  //   - `name` present and valid         → trimmed, then saved
  let nameUpdate = {};
  if (name !== undefined) {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
      throw Object.assign(new Error('اسم المورد لا يمكن أن يكون فارغاً.'), { code: 'VALIDATION_ERROR' });
    }
    nameUpdate = { name: trimmedName };
  }

  const updated = await prisma.supplier.update({
    where: { id },
    data: {
      ...nameUpdate,
      ...(phone   !== undefined && { phone }),
      ...(email   !== undefined && { email }),
      ...(address !== undefined && { address }),
      ...(notes   !== undefined && { notes }),
    },
  });

  return { existing, updated };
};

// ─────────────────────────────────────────
// SOFT DELETE
// ─────────────────────────────────────────
const deleteSupplier = async ({ showroomId, id }) => {
  const existing = await prisma.supplier.findFirst({ where: { id, showroom_id: showroomId } });
  if (!existing) throw Object.assign(new Error('المورد غير موجود.'), { code: 'NOT_FOUND' });
  if (!existing.is_active) {
    throw Object.assign(new Error('المورد معطل مسبقاً.'), { code: 'CONFLICT' });
  }

  return prisma.supplier.update({
    where: { id },
    data:  { is_active: false },
  });
};

// ─────────────────────────────────────────
// REACTIVATE
// ─────────────────────────────────────────
const reactivateSupplier = async ({ showroomId, id }) => {
  const existing = await prisma.supplier.findFirst({ where: { id, showroom_id: showroomId } });
  if (!existing) throw Object.assign(new Error('المورد غير موجود.'), { code: 'NOT_FOUND' });
  if (existing.is_active) {
    throw Object.assign(new Error('المورد نشط مسبقاً.'), { code: 'CONFLICT' });
  }

  return prisma.supplier.update({ where: { id }, data: { is_active: true } });
};

// ─────────────────────────────────────────
// ADD PAYMENT
// ─────────────────────────────────────────
const addPayment = async ({ showroomId, supplierId, data }) => {
  const { amount, payment_type = 'CASH', reference, note } = data;

  if (!amount || parseFloat(amount) <= 0) {
    throw Object.assign(new Error('مبلغ الدفعة يجب أن يكون أكبر من صفر.'), { code: 'VALIDATION_ERROR' });
  }

  // Phase C.6 (P1 — concurrency fix): the previous code read the balance
  // OUTSIDE the transaction and then wrote unconditionally inside it —
  // a TOCTOU race: two simultaneous payments for the same supplier both
  // read an old total_paid, both passed the `amount <= balance` check,
  // and both incremented, jointly overpaying the supplier (money-out,
  // same integrity class as the C.4 payInstallment race).
  //
  // The balance enforcement now lives IN the transaction as an atomic
  // conditional claim — updateMany with `total_paid <= balance - amount`
  // in the where clause increments at most one row. Under PostgreSQL
  // READ COMMITTED, a concurrent claimant that reads a stale total_paid
  // blocks on the row lock and re-evaluates the WHERE against the
  // committed row before its own UPDATE proceeds, so the loser's
  // affected-row count is 0 and it fails with the same clean
  // overpayment error the sequential path gives — nothing written.
  const payment = await prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({
      where: { id: supplierId, showroom_id: showroomId },
    });
    if (!supplier) throw Object.assign(new Error('المورد غير موجود.'), { code: 'NOT_FOUND' });

    const amountNum = parseFloat(amount);
    const balance   = parseFloat(supplier.total_due) - parseFloat(supplier.total_paid);

    // The claim compares the row's CURRENT total_paid against
    // `total_due − amount` (i.e. total_paid + amount must not exceed
    // total_due). Decimal.js math keeps the boundary EXACT for
    // fractional balances — float64 would drift (e.g. 1000 − 333.33
    // → 666.6699999999999) and wrongly reject a valid payment that
    // exactly clears the balance.
    const threshold = new Prisma.Decimal(String(supplier.total_due))
      .minus(new Prisma.Decimal(String(amountNum)));

    const claim = await tx.supplier.updateMany({
      where: {
        id:         supplierId,
        showroom_id: showroomId,
        total_paid: { lte: threshold },
      },
      data: { total_paid: { increment: amountNum } },
    });

    if (claim.count === 0) {
      throw Object.assign(
        new Error(`الدفعة (${amount}) تتجاوز الرصيد المستحق (${balance}).`),
        { code: 'VALIDATION_ERROR' }
      );
    }

    return tx.supplierPayment.create({
      data: {
        supplier_id:  supplierId,
        amount:       amountNum,
        payment_type,
        reference:    reference || null,
        note:         note      || null,
        paid_at:      new Date(),
      },
    });
  });

  return payment;
};

// ─────────────────────────────────────────
// PAYMENT HISTORY
// ─────────────────────────────────────────
const getPaymentHistory = async ({ showroomId, supplierId, query }) => {
  const { page, limit, skip } = getPagination(query);

  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, showroom_id: showroomId },
  });
  if (!supplier) throw Object.assign(new Error('المورد غير موجود.'), { code: 'NOT_FOUND' });

  const [payments, total] = await Promise.all([
    prisma.supplierPayment.findMany({
      where:   { supplier_id: supplierId },
      skip,
      take:    limit,
      orderBy: { paid_at: 'desc' },
    }),
    prisma.supplierPayment.count({ where: { supplier_id: supplierId } }),
  ]);

  return { payments, pagination: buildPaginationMeta(total, page, limit) };
};

// ─────────────────────────────────────────
// STATS
// ─────────────────────────────────────────
const getSupplierStats = async ({ showroomId }) => {
  const where = { showroom_id: showroomId, is_active: true };

  const [total, totals, highBalance] = await Promise.all([
    prisma.supplier.count({ where }),
    prisma.supplier.aggregate({ where, _sum: { total_due: true, total_paid: true } }),
    prisma.supplier.findMany({
      where,
      orderBy: { total_due: 'desc' },
      take:    5,
      select:  { id: true, name: true, total_due: true, total_paid: true },
    }),
  ]);

  const totalBalance =
    parseFloat(totals._sum.total_due  || 0) -
    parseFloat(totals._sum.total_paid || 0);

  return {
    total_suppliers: total,
    total_due:       totals._sum.total_due  || 0,
    total_paid:      totals._sum.total_paid || 0,
    total_balance:   totalBalance,
    top_balances:    highBalance.map((s) => ({
      ...s,
      balance: parseFloat(s.total_due) - parseFloat(s.total_paid),
    })),
  };
};

module.exports = {
  listSuppliers,
  getSupplier,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  reactivateSupplier,
  addPayment,
  getPaymentHistory,
  getSupplierStats,
};
