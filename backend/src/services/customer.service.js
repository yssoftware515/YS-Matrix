// ============================================================
// YS-MATRIX ERP — Customer Service (Phase 2 Stage 2)
// ============================================================

'use strict';

const prisma = require('../config/database');
const { getPagination, buildPaginationMeta } = require('../utils/pagination');

// ─────────────────────────────────────────
// LIST
// ─────────────────────────────────────────
const listCustomers = async ({ showroomId, query }) => {
  const { page, limit, skip } = getPagination(query);
  const { search, include_inactive } = query;

  const where = { showroom_id: showroomId };
  if (include_inactive !== 'true') where.is_active = true;

  if (search) {
    where.OR = [
      { name:        { contains: search, mode: 'insensitive' } },
      { phone:       { contains: search } },
      { national_id: { contains: search } },
    ];
  }

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { created_at: 'desc' },
      include: { _count: { select: { sales: true } } },
    }),
    prisma.customer.count({ where }),
  ]);

  return { customers, pagination: buildPaginationMeta(total, page, limit) };
};

// ─────────────────────────────────────────
// GET ONE
// ─────────────────────────────────────────
const getCustomer = async ({ showroomId, id }) => {
  return prisma.customer.findFirst({
    where: { id, showroom_id: showroomId },
    select: {
      id: true, name: true, phone: true, national_id: true,
      address: true, notes: true, created_at: true,
      sales: {
        orderBy: { sold_at: 'desc' },
        take:    10,
        select: {
          id: true, invoice_number: true,
          sale_type: true, status: true,
          total: true, sold_at: true,
        },
      },
    },
  });
};

// ─────────────────────────────────────────
// CREATE
// ─────────────────────────────────────────
const createCustomer = async ({ showroomId, data }) => {
  const { name, phone, national_id, address, notes } = data;

  if (!name?.trim()) {
    throw Object.assign(new Error('اسم العميل مطلوب.'), { code: 'VALIDATION_ERROR' });
  }

  // Phase C.1 (3A) — duplicate protection WITHIN this showroom only.
  // The lookup is scoped by showroom_id + is_active, so it can never
  // become a cross-tenant probe: another showroom's customer with the
  // same phone/national_id is a different customer and is allowed.
  // national_id is the strongest identity key; the phone check catches
  // the common sales-floor case. The existing customer's name is
  // included in the message so the staff member can pick the existing
  // record instead of typing a new one.
  const trimmedNationalId = national_id?.trim();
  if (trimmedNationalId) {
    const existing = await prisma.customer.findFirst({
      where: { showroom_id: showroomId, national_id: trimmedNationalId, is_active: true },
    });
    if (existing) {
      throw Object.assign(
        new Error(`يوجد عميل مسجل بهذا الرقم الوطني (الاسم: ${existing.name})`),
        { code: 'CONFLICT' }
      );
    }
  }

  const trimmedPhone = phone?.trim();
  if (trimmedPhone) {
    const existing = await prisma.customer.findFirst({
      where: { showroom_id: showroomId, phone: trimmedPhone, is_active: true },
    });
    if (existing) {
      throw Object.assign(
        new Error(`يوجد عميل مسجل بهذا الرقم (الاسم: ${existing.name})`),
        { code: 'CONFLICT' }
      );
    }
  }

  return prisma.customer.create({
    data: {
      showroom_id: showroomId,
      name:        name.trim(),
      phone:       trimmedPhone || null,
      national_id: trimmedNationalId || null,
      address:     address     || null,
      notes:       notes       || null,
      is_active:   true,
    },
  });
};

// ─────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────
const updateCustomer = async ({ showroomId, id, data }) => {
  const existing = await prisma.customer.findFirst({ where: { id, showroom_id: showroomId } });
  if (!existing) throw Object.assign(new Error('العميل غير موجود.'), { code: 'NOT_FOUND' });

  const { name, phone, national_id, address, notes } = data;

  // STRICT name validation — same fix and rationale as supplier.service.js
  // updateSupplier(). See that file for the full comment.
  let nameUpdate = {};
  if (name !== undefined) {
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName) {
      throw Object.assign(new Error('اسم العميل لا يمكن أن يكون فارغاً.'), { code: 'VALIDATION_ERROR' });
    }
    nameUpdate = { name: trimmedName };
  }

  // Phase C.3 (C3-2) — duplicate protection on UPDATE, mirroring the
  // createCustomer contract exactly: same-showroom, active-only lookups
  // on national_id/phone, values trimmed, and the record being updated
  // excluded. Without this, editing a customer could silently produce
  // duplicate identity keys inside one showroom — breaking the guarantee
  // createCustomer already enforces. null still clears the field, and
  // null/undefined never participates in the dup lookup.
  let nationalIdUpdate = {};
  if (national_id !== undefined) {
    const trimmedNationalId = national_id === null ? null : national_id.trim();
    if (trimmedNationalId) {
      const dup = await prisma.customer.findFirst({
        where: {
          showroom_id: showroomId,
          national_id: trimmedNationalId,
          is_active:   true,
          NOT:         { id },
        },
      });
      if (dup) {
        throw Object.assign(
          new Error(`يوجد عميل مسجل بهذا الرقم الوطني (الاسم: ${dup.name})`),
          { code: 'CONFLICT' }
        );
      }
    }
    nationalIdUpdate = { national_id: trimmedNationalId };
  }

  let phoneUpdate = {};
  if (phone !== undefined) {
    const trimmedPhone = phone === null ? null : phone.trim();
    if (trimmedPhone) {
      const dup = await prisma.customer.findFirst({
        where: {
          showroom_id: showroomId,
          phone:       trimmedPhone,
          is_active:   true,
          NOT:         { id },
        },
      });
      if (dup) {
        throw Object.assign(
          new Error(`يوجد عميل مسجل بهذا الرقم (الاسم: ${dup.name})`),
          { code: 'CONFLICT' }
        );
      }
    }
    phoneUpdate = { phone: trimmedPhone };
  }

  const updated = await prisma.customer.update({
    where: { id },
    data: {
      ...nameUpdate,
      ...phoneUpdate,
      ...nationalIdUpdate,
      ...(address !== undefined && { address }),
      ...(notes   !== undefined && { notes }),
    },
  });

  return { existing, updated };
};

// ─────────────────────────────────────────
// SOFT DELETE
// ─────────────────────────────────────────
const deleteCustomer = async ({ showroomId, id }) => {
  const existing = await prisma.customer.findFirst({ where: { id, showroom_id: showroomId } });
  if (!existing) throw Object.assign(new Error('العميل غير موجود.'), { code: 'NOT_FOUND' });
  if (!existing.is_active) {
    throw Object.assign(new Error('العميل معطل مسبقاً.'), { code: 'CONFLICT' });
  }

  return prisma.customer.update({ where: { id }, data: { is_active: false } });
};

// ─────────────────────────────────────────
// REACTIVATE
// ─────────────────────────────────────────
const reactivateCustomer = async ({ showroomId, id }) => {
  const existing = await prisma.customer.findFirst({ where: { id, showroom_id: showroomId } });
  if (!existing) throw Object.assign(new Error('العميل غير موجود.'), { code: 'NOT_FOUND' });
  if (existing.is_active) {
    throw Object.assign(new Error('العميل نشط مسبقاً.'), { code: 'CONFLICT' });
  }

  return prisma.customer.update({ where: { id }, data: { is_active: true } });
};

module.exports = {
  listCustomers,
  getCustomer,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  reactivateCustomer,
};
