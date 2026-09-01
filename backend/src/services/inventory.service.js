// ============================================================
// YS-MATRIX ERP — Inventory Service (Phase 2 Stage 2)
// 
// Extracts all business logic from inventory.controller.js
// Controller becomes thin — only parses request/response.
// Service is testable, reusable, framework-agnostic.
// ============================================================

'use strict';

const prisma  = require('../config/database');
const logger  = require('../config/logger');
const notificationService = require('./notification.service');
const { getPagination, buildPaginationMeta, getOrderBy } = require('../utils/pagination');

const ALLOWED_SORT = ['created_at', 'selling_price', 'cost_price', 'brand', 'model', 'quantity'];

// ─────────────────────────────────────────
// LOW_STOCK_THRESHOLD (Matrix Audit — Notification Integration #12)
// ─────────────────────────────────────────
// Previously hardcoded as the literal `2` independently in getStats()
// and getLowStock() below. Now a single named constant — both of those
// AND the new notifyLowStock trigger in updateItem() (this file) and
// the post-sale trigger in sales.service.js's createSale() all read
// from this one value, so the three checks can never silently drift
// out of sync with each other.
const LOW_STOCK_THRESHOLD = 2;

// ─────────────────────────────────────────
// Strict numeric parsing (bug fix — see audit note)
//
// ROOT CAUSE FOUND: this file has NO Zod validation layer at all
// (unlike auth/sale/showroom — there is no inventory.validation.js).
// createItem/updateItem previously did raw `parseFloat(cost_price)` /
// `parseInt(year, 10)` with no presence/type check first. A missing
// or empty-string numeric field (e.g. a cleared form input) silently
// becomes NaN, which then reaches Prisma's Decimal/Int columns and
// throws an unhandled PrismaClientValidationError — which has no
// `.code`, so inventory.controller.js's handleServiceError() falls
// through to a raw, unhelpful 500. This is the actual bug behind
// "adding/adjusting inventory items was failing and throwing errors"
// — not a transaction or cascade-delete issue (both audited and
// confirmed already correct — see PR discussion).
//
// Uses Number(), not parseFloat()/parseInt() — parseFloat('12abc')
// === 12, silently truncating trailing garbage instead of rejecting
// it (same class of bug already fixed in checkBcryptRounds, see
// env.validator.js).
// ─────────────────────────────────────────

/** Required, non-negative decimal (price fields on CREATE). */
function parseRequiredPrice(value, fieldName) {
  const num = Number(value);
  if (value === undefined || value === null || value === '' || !Number.isFinite(num) || num < 0) {
    throw Object.assign(
      new Error(`${fieldName} مطلوب ويجب أن يكون رقماً موجباً صحيحاً.`),
      { code: 'VALIDATION_ERROR', field: fieldName }
    );
  }
  return num;
}

/**
 * Optional decimal for PATCH-style updates:
 *   - undefined → field not sent, skip (returns undefined)
 *   - null/''   → explicit clear (returns null, for nullable columns)
 *   - anything else → must be a valid non-negative number
 */
function parseOptionalPrice(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) {
    throw Object.assign(
      new Error(`${fieldName} يجب أن يكون رقماً موجباً صحيحاً.`),
      { code: 'VALIDATION_ERROR', field: fieldName }
    );
  }
  return num;
}

/** Same contract as parseOptionalPrice, but for integer fields (year, engine_cc, quantity). */
function parseOptionalInt(value, fieldName) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const num = Number(value);
  if (!Number.isInteger(num) || num < 0) {
    throw Object.assign(
      new Error(`${fieldName} يجب أن يكون عدداً صحيحاً موجباً.`),
      { code: 'VALIDATION_ERROR', field: fieldName }
    );
  }
  return num;
}

// ─────────────────────────────────────────
// LIST
// ─────────────────────────────────────────
const listInventory = async ({ showroomId, query }) => {
  const { page, limit, skip } = getPagination(query);
  const {
    search,
    vehicle_type,
    status,
    supplier_id,
    min_price,
    max_price,
    include_inactive,
  } = query;

  const orderBy = getOrderBy(query, ALLOWED_SORT);

  const where = { showroom_id: showroomId };

  // Matches supplier.service.js / customer.service.js convention:
  // archived items hidden by default, opt-in visible via ?include_inactive=true
  if (include_inactive !== 'true') where.is_active = true;

  if (search) {
    where.OR = [
      { brand:          { contains: search, mode: 'insensitive' } },
      { model:          { contains: search, mode: 'insensitive' } },
      { color:          { contains: search, mode: 'insensitive' } },
      { chassis_number: { contains: search, mode: 'insensitive' } },
      { engine_number:  { contains: search, mode: 'insensitive' } },
    ];
  }

  if (vehicle_type) where.vehicle_type = vehicle_type;
  if (status)       where.status       = status;
  if (supplier_id)  where.supplier_id  = supplier_id;

  if (min_price || max_price) {
    where.selling_price = {};
    if (min_price) where.selling_price.gte = parseFloat(min_price);
    if (max_price) where.selling_price.lte = parseFloat(max_price);
  }

  // Single round-trip with count
  const [items, total] = await Promise.all([
    prisma.inventory.findMany({
      where,
      skip,
      take:    limit,
      orderBy,
      include: { supplier: { select: { id: true, name: true } } },
    }),
    prisma.inventory.count({ where }),
  ]);

  return { items, pagination: buildPaginationMeta(total, page, limit) };
};

// ─────────────────────────────────────────
// GET ONE (with sales history)
// ─────────────────────────────────────────
const getInventoryItem = async ({ showroomId, id }) => {
  const item = await prisma.inventory.findFirst({
    where:   { id, showroom_id: showroomId },
    include: {
      supplier: { select: { id: true, name: true, phone: true } },
      sale_items: {
        include: {
          sale: {
            select: {
              id:             true,
              invoice_number: true,
              sold_at:        true,
              sale_type:      true,
              status:         true,
              customer:       { select: { name: true, phone: true } },
            },
          },
        },
        take:    5,
        orderBy: { sale: { sold_at: 'desc' } },
      },
    },
  });

  return item;
};

// ─────────────────────────────────────────
// CREATE SINGLE
// ─────────────────────────────────────────
const createItem = async ({ showroomId, data }) => {
  const {
    vehicle_type, brand, model, year, color, engine_cc,
    chassis_number, engine_number,
    cost_price, selling_price, min_price,
    quantity = 1, description, supplier_id,
  } = data;

  // Validate supplier belongs to this showroom
  if (supplier_id) {
    const supplier = await prisma.supplier.findFirst({
      where: { id: supplier_id, showroom_id: showroomId },
    });
    if (!supplier) throw Object.assign(new Error('Supplier not found'), { code: 'NOT_FOUND' });
  }

  const costPrice    = parseRequiredPrice(cost_price, 'سعر التكلفة');
  const sellingPrice = parseRequiredPrice(selling_price, 'سعر البيع');

  // NOTE: the ORIGINAL check here was `parseFloat(selling_price) <
  // parseFloat(cost_price)` — a silent false-negative when either
  // field is missing: parseFloat(undefined) === NaN, and `NaN < NaN`
  // is always `false` in JS, so a request with no cost_price/
  // selling_price at all used to sail straight past this guard.
  // parseRequiredPrice() above already rejects that case with a clear
  // error before we even reach here; this compares two
  // guaranteed-valid numbers instead.
  if (sellingPrice < costPrice) {
    throw Object.assign(
      new Error('سعر البيع لا يمكن أن يكون أقل من سعر التكلفة.'),
      { code: 'VALIDATION_ERROR', field: 'selling_price' }
    );
  }

  const item = await prisma.inventory.create({
    data: {
      showroom_id:    showroomId,
      vehicle_type,
      brand,
      model,
      year:           parseOptionalInt(year, 'سنة الصنع') ?? null,
      color:          color        || null,
      engine_cc:      parseOptionalInt(engine_cc, 'سعة المحرك') ?? null,
      chassis_number: chassis_number || null,
      engine_number:  engine_number  || null,
      cost_price:     costPrice,
      selling_price:  sellingPrice,
      min_price:      parseOptionalPrice(min_price, 'أقل سعر مسموح') ?? null,
      quantity:       parseOptionalInt(quantity, 'الكمية') ?? 1,
      description:    description  || null,
      supplier_id:    supplier_id  || null,
      status:         'IN_STOCK',
      is_active:      true,
    },
  });

  return item;
};

// ─────────────────────────────────────────
// BULK CREATE
// ─────────────────────────────────────────
const bulkCreateItems = async ({ showroomId, items }) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error('items array is required'), { code: 'VALIDATION_ERROR' });
  }
  if (items.length > 100) {
    throw Object.assign(new Error('Cannot bulk insert more than 100 items'), { code: 'VALIDATION_ERROR' });
  }

  const errors = [];
  items.forEach((item, idx) => {
    if (!item.vehicle_type) errors.push(`Item ${idx + 1}: vehicle_type required`);
    if (!item.brand)        errors.push(`Item ${idx + 1}: brand required`);
    if (!item.model)        errors.push(`Item ${idx + 1}: model required`);
    // NOTE: same root-cause fix as createItem — previously
    // `!item.cost_price` treated 0 as falsy-missing (an edge case,
    // unlikely for a real price but still wrong) and did nothing to
    // stop a non-numeric string ("abc") from reaching parseFloat()
    // below and becoming NaN. Number.isFinite() correctly rejects
    // missing, non-numeric, AND negative values, and correctly
    // ACCEPTS a legitimate 0.
    if (item.cost_price === undefined || item.cost_price === null || item.cost_price === '' || !Number.isFinite(Number(item.cost_price)) || Number(item.cost_price) < 0) {
      errors.push(`Item ${idx + 1}: cost_price must be a valid non-negative number`);
    }
    if (item.selling_price === undefined || item.selling_price === null || item.selling_price === '' || !Number.isFinite(Number(item.selling_price)) || Number(item.selling_price) < 0) {
      errors.push(`Item ${idx + 1}: selling_price must be a valid non-negative number`);
    }
  });

  if (errors.length > 0) {
    throw Object.assign(new Error('Validation failed'), { code: 'VALIDATION_ERROR', errors });
  }

  const data = items.map((item) => ({
    showroom_id:    showroomId,
    vehicle_type:   item.vehicle_type,
    brand:          item.brand,
    model:          item.model,
    year:           parseOptionalInt(item.year, 'سنة الصنع') ?? null,
    color:          item.color       || null,
    engine_cc:      parseOptionalInt(item.engine_cc, 'سعة المحرك') ?? null,
    chassis_number: item.chassis_number || null,
    engine_number:  item.engine_number  || null,
    cost_price:     Number(item.cost_price),
    selling_price:  Number(item.selling_price),
    min_price:      parseOptionalPrice(item.min_price, 'أقل سعر مسموح') ?? null,
    quantity:       parseOptionalInt(item.quantity, 'الكمية') ?? 1,
    description:    item.description || null,
    supplier_id:    item.supplier_id || null,
    status:         'IN_STOCK',
    is_active:      true,
  }));

  const result = await prisma.inventory.createMany({ data });
  return { count: result.count };
};

// ─────────────────────────────────────────
// UPDATE
// ─────────────────────────────────────────
const updateItem = async ({ showroomId, id, data }) => {
  const existing = await prisma.inventory.findFirst({
    where: { id, showroom_id: showroomId },
  });

  if (!existing) throw Object.assign(new Error('Item not found'), { code: 'NOT_FOUND' });
  if (existing.status === 'SOLD') {
    throw Object.assign(new Error('لا يمكن تعديل منتج مباع.'), { code: 'FORBIDDEN' });
  }

  // Matrix Audit (Phase 2): updateItem already blocked edits to SOLD
  // items, but allowed changing a RESERVED item straight back to
  // IN_STOCK as a plain side effect of any generic PATCH — risking two
  // staff members selling the same reserved item to different
  // customers (one via whatever reservation flow holds it, another via
  // a fresh sale once it silently reappears as available stock).
  //
  // This does NOT block the transition outright — there's a legitimate
  // need to release a cancelled/expired reservation back to stock, and
  // there's no separate "release reservation" endpoint to redirect to.
  // Instead it requires an EXPLICIT, deliberate flag in the request
  // body — distinguishing "staff member intentionally releasing this
  // reservation" from "this just happened to be in the payload of an
  // unrelated edit." Mirrors the existing SOLD guard's pattern/style.
  if (existing.status === 'RESERVED' && data.status === 'IN_STOCK' && !data.release_reservation) {
    throw Object.assign(
      new Error('هذا المنتج محجوز حالياً. لتحرير الحجز وإعادته للمخزون المتاح، أكّد ذلك صريحاً عبر release_reservation.'),
      { code: 'CONFLICT', field: 'status' }
    );
  }

  const {
    brand, model, year, color, engine_cc,
    chassis_number, engine_number,
    cost_price, selling_price, min_price,
    quantity, description, supplier_id, status,
  } = data;

  const parsedYear         = parseOptionalInt(year, 'سنة الصنع');
  const parsedEngineCc     = parseOptionalInt(engine_cc, 'سعة المحرك');
  const parsedCostPrice    = parseOptionalPrice(cost_price, 'سعر التكلفة');
  const parsedSellingPrice = parseOptionalPrice(selling_price, 'سعر البيع');
  const parsedMinPrice     = parseOptionalPrice(min_price, 'أقل سعر مسموح');
  const parsedQuantity     = parseOptionalInt(quantity, 'الكمية');

  // NOTE: this cross-field check did not exist at all on update
  // (only createItem had it) — an update could set selling_price
  // below the existing cost_price, or cost_price above the existing
  // selling_price, with no validation. Effective values fall back to
  // the EXISTING row's value when the field wasn't part of this
  // request, so this correctly validates the resulting row, not just
  // the two fields in isolation.
  const effectiveCost    = parsedCostPrice    !== undefined ? parsedCostPrice    : parseFloat(existing.cost_price);
  const effectiveSelling = parsedSellingPrice !== undefined ? parsedSellingPrice : parseFloat(existing.selling_price);
  if (effectiveSelling < effectiveCost) {
    throw Object.assign(
      new Error('سعر البيع لا يمكن أن يكون أقل من سعر التكلفة.'),
      { code: 'VALIDATION_ERROR', field: 'selling_price' }
    );
  }

  const updated = await prisma.inventory.update({
    where: { id },
    data: {
      ...(brand              !== undefined && { brand }),
      ...(model              !== undefined && { model }),
      ...(parsedYear         !== undefined && { year: parsedYear }),
      ...(color              !== undefined && { color }),
      ...(parsedEngineCc     !== undefined && { engine_cc: parsedEngineCc }),
      ...(chassis_number     !== undefined && { chassis_number }),
      ...(engine_number      !== undefined && { engine_number }),
      ...(parsedCostPrice    !== undefined && { cost_price: parsedCostPrice }),
      ...(parsedSellingPrice !== undefined && { selling_price: parsedSellingPrice }),
      ...(parsedMinPrice     !== undefined && { min_price: parsedMinPrice }),
      ...(parsedQuantity     !== undefined && { quantity: parsedQuantity }),
      ...(description        !== undefined && { description }),
      ...(supplier_id        !== undefined && { supplier_id }),
      ...(status             !== undefined && { status }),
    },
  });

  // NOTIFICATION WIRING (Matrix Audit #12): notifyLowStock existed but
  // was never called from anywhere. Fired here specifically when THIS
  // update touches `quantity` and the resulting row would itself
  // qualify for the low-stock list (same condition as getStats'/
  // getLowStock's own filter: IN_STOCK + qty <= threshold) — not on
  // every edit to an already-low item (e.g. editing only `description`
  // doesn't re-fire this). Awaited deliberately: createNotification()
  // already swallows its own errors internally (never throws), so
  // awaiting it cannot fail this request — it just keeps execution
  // order deterministic instead of leaving a dangling promise.
  if (
    quantity !== undefined &&
    updated.status === 'IN_STOCK' &&
    updated.quantity <= LOW_STOCK_THRESHOLD
  ) {
    await notificationService.notifyLowStock(showroomId, {
      brand:    updated.brand,
      model:    updated.model,
      quantity: updated.quantity,
    });
  }

  return { existing, updated };
};

// ─────────────────────────────────────────
// DELETE
// ─────────────────────────────────────────
const deleteItem = async ({ showroomId, id }) => {
  const existing = await prisma.inventory.findFirst({
    where: { id, showroom_id: showroomId },
  });

  if (!existing) throw Object.assign(new Error('Item not found'), { code: 'NOT_FOUND' });
  if (!existing.is_active) {
    throw Object.assign(new Error('المنتج مؤرشف مسبقاً.'), { code: 'CONFLICT' });
  }

  // Soft delete (F-25 follow-up, 2026-07-04): this is now the ONLY
  // way inventory rows are removed from view — no `prisma.inventory
  // .delete()` anywhere. The two guards that used to live here
  // (blocking SOLD items, blocking anything with linked SaleItem
  // rows) existed ONLY to prevent the FK-constraint crash a real
  // DELETE would cause against SaleItem's immutable snapshot
  // references. That risk doesn't exist anymore — archiving a SOLD
  // item is now the normal, expected action (hide it from the active
  // inventory list without touching any historical sale data).
  return prisma.inventory.update({
    where: { id },
    data:  { is_active: false },
  });
};

// ─────────────────────────────────────────
// REACTIVATE — symmetric with supplier/customer reactivate*
// ─────────────────────────────────────────
const reactivateItem = async ({ showroomId, id }) => {
  const existing = await prisma.inventory.findFirst({
    where: { id, showroom_id: showroomId },
  });

  if (!existing) throw Object.assign(new Error('Item not found'), { code: 'NOT_FOUND' });
  if (existing.is_active) {
    throw Object.assign(new Error('المنتج نشط مسبقاً.'), { code: 'CONFLICT' });
  }

  return prisma.inventory.update({
    where: { id },
    data:  { is_active: true },
  });
};

// ─────────────────────────────────────────
// STATS (dashboard KPIs) — optimized single query
// ─────────────────────────────────────────
const getStats = async ({ showroomId }) => {
  // Archived items excluded from all dashboard KPIs by default —
  // matches supplier.service.js's getSupplierStats convention.
  const filter = { showroom_id: showroomId, is_active: true };

  const [
    totalItems,
    inStock,
    sold,
    reserved,
    lowStock,
    byType,
    stockValue,
  ] = await Promise.all([
    prisma.inventory.count({ where: filter }),
    prisma.inventory.count({ where: { ...filter, status: 'IN_STOCK' } }),
    prisma.inventory.count({ where: { ...filter, status: 'SOLD' } }),
    prisma.inventory.count({ where: { ...filter, status: 'RESERVED' } }),
    prisma.inventory.count({ where: { ...filter, status: 'IN_STOCK', quantity: { lte: LOW_STOCK_THRESHOLD } } }),
    prisma.inventory.groupBy({
      by:    ['vehicle_type'],
      where: filter,
      _count: true,
      _sum:   { quantity: true },
    }),
    prisma.inventory.aggregate({
      where: { ...filter, status: 'IN_STOCK' },
      _sum:  { cost_price: true, selling_price: true },
    }),
  ]);

  return {
    totals: { total: totalItems, in_stock: inStock, sold, reserved, low_stock: lowStock },
    by_type:     byType,
    stock_value: {
      cost:    stockValue._sum.cost_price    || 0,
      selling: stockValue._sum.selling_price || 0,
    },
  };
};

// ─────────────────────────────────────────
// LOW STOCK ALERTS
// ─────────────────────────────────────────
const getLowStock = async ({ showroomId, threshold = LOW_STOCK_THRESHOLD }) => {
  return prisma.inventory.findMany({
    where:   { showroom_id: showroomId, is_active: true, status: 'IN_STOCK', quantity: { lte: threshold } },
    orderBy: { quantity: 'asc' },
    take:    50,
  });
};

module.exports = {
  listInventory,
  getInventoryItem,
  createItem,
  bulkCreateItems,
  updateItem,
  deleteItem,
  reactivateItem,
  getStats,
  getLowStock,
  LOW_STOCK_THRESHOLD,
};
