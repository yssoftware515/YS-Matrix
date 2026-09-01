// ============================================================
// YS-MATRIX ERP — Sales Service (Phase 2 Stage 2)
//
// Extracts all business logic from sales.controller.js
// Controller becomes thin — only parses request/response.
// ============================================================

'use strict';

const prisma  = require('../config/database');
const logger  = require('../config/logger');
const notificationService = require('./notification.service');
const { LOW_STOCK_THRESHOLD } = require('./inventory.service');
const { getPagination, buildPaginationMeta } = require('../utils/pagination');
const { getDateRange }  = require('../utils/dateRange');
const { generateInvoiceNumber } = require('../utils/invoice');

// ─────────────────────────────────────────
// LIST SALES
// ─────────────────────────────────────────
const listSales = async ({ showroomId, query }) => {
  const { page, limit, skip } = getPagination(query);
  const { search, sale_type, status, range, date_from, date_to } = query;

  const where     = { showroom_id: showroomId };
  const dateFilter = getDateRange({ range, date_from, date_to });
  where.sold_at   = dateFilter;

  if (sale_type) where.sale_type = sale_type;
  if (status)    where.status    = status;

  if (search) {
    where.OR = [
      { invoice_number: { contains: search, mode: 'insensitive' } },
      { customer: { name:  { contains: search, mode: 'insensitive' } } },
      { customer: { phone: { contains: search } } },
    ];
  }

  const [sales, total] = await Promise.all([
    prisma.sale.findMany({
      where,
      skip,
      take:    limit,
      orderBy: { sold_at: 'desc' },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        user:     { select: { id: true, name: true } },
        items: {
          include: {
            inventory: {
              select: { id: true, brand: true, model: true, vehicle_type: true, color: true },
            },
          },
        },
        _count: { select: { installments: true } },
      },
    }),
    prisma.sale.count({ where }),
  ]);

  // Phase C.4 (FIN-1): remaining installment balance, computed
  // SERVER-SIDE. The old approach made the frontend sum unpaid
  // installments client-side from the page rows alone — and the list
  // endpoint never returned installments at all, so the sales list
  // could not show a remaining balance. One grouped aggregate over the
  // page's sale ids (exact decimal sums, done by the database) is
  // attached to each row as `remaining_amount` — 0 for CASH sales and
  // fully-paid sales alike. Keep this computed in one place: the
  // number the list shows must equal the number the detail view
  // derives from the same underlying unpaid rows.
  const saleIds = sales.map((s) => s.id);
  const unpaidBySale = saleIds.length > 0
    ? await prisma.installment.groupBy({
        by:    ['sale_id'],
        where: { sale_id: { in: saleIds }, is_paid: false },
        _sum:  { amount: true },
      })
    : [];
  const remainingBySaleId = new Map(
    unpaidBySale.map((g) => [g.sale_id, parseFloat(g._sum.amount?.toString() || '0')])
  );
  for (const sale of sales) {
    sale.remaining_amount = remainingBySaleId.get(sale.id) ?? 0;
  }

  return { sales, pagination: buildPaginationMeta(total, page, limit) };
};

// ─────────────────────────────────────────
// GET SINGLE SALE
// ─────────────────────────────────────────
const getSale = async ({ showroomId, id }) => {
  const sale = await prisma.sale.findFirst({
    where: { id, showroom_id: showroomId },
    include: {
      customer: true,
      user:     { select: { id: true, name: true, email: true } },
      items: {
        include: {
          inventory: {
            select: {
              id: true, brand: true, model: true,
              vehicle_type: true, color: true,
              chassis_number: true, engine_number: true,
            },
          },
        },
      },
      installments: { orderBy: { due_date: 'asc' } },
    },
  });

  if (!sale) return null;

  const paidInstallments    = sale.installments.filter((i) => i.is_paid).length;
  const overdueInstallments = sale.installments.filter(
    (i) => !i.is_paid && new Date(i.due_date) < new Date()
  ).length;

  return {
    ...sale,
    installment_summary: {
      total:   sale.installments.length,
      paid:    paidInstallments,
      pending: sale.installments.length - paidInstallments,
      overdue: overdueInstallments,
    },
  };
};

// ─────────────────────────────────────────
// CREATE SALE — full transaction
// ─────────────────────────────────────────
const createSale = async ({ showroomId, userId, data }) => {
  const {
    customer_id,
    sale_type = 'CASH',
    items,
    discount = 0,
    notes,
    down_payment,
    monthly_amount,
    installment_months,
    first_due_date,
  } = data;

  // ── Validate items ───────────────────────────────────────
  if (!items || !Array.isArray(items) || items.length === 0) {
    throw Object.assign(new Error('يجب إضافة منتج واحد على الأقل.'), { code: 'VALIDATION_ERROR' });
  }

  if (sale_type === 'INSTALLMENT') {
    if (!down_payment || !monthly_amount || !installment_months || !first_due_date) {
      throw Object.assign(
        new Error('بيع التقسيط يتطلب: down_payment, monthly_amount, installment_months, first_due_date'),
        { code: 'VALIDATION_ERROR' }
      );
    }
  }

  // ── Check inventory availability ─────────────────────────
  const inventoryChecks = await Promise.all(
    items.map((item) =>
      prisma.inventory.findFirst({
        where: { id: item.inventory_id, showroom_id: showroomId, status: 'IN_STOCK' },
      })
    )
  );

  for (let i = 0; i < inventoryChecks.length; i++) {
    const inv     = inventoryChecks[i];
    const reqItem = items[i];
    if (!inv) {
      throw Object.assign(
        new Error(`المنتج ${reqItem.inventory_id} غير موجود أو غير متاح في المخزن.`),
        { code: 'VALIDATION_ERROR' }
      );
    }
    if (inv.quantity < (reqItem.quantity || 1)) {
      throw Object.assign(
        new Error(`الكمية غير كافية لـ ${inv.brand} ${inv.model}. المتاح: ${inv.quantity}`),
        { code: 'VALIDATION_ERROR' }
      );
    }
  }

  // ── Validate customer ────────────────────────────────────
  if (customer_id) {
    const customer = await prisma.customer.findFirst({
      where: { id: customer_id, showroom_id: showroomId },
    });
    if (!customer) {
      throw Object.assign(new Error('العميل غير موجود.'), { code: 'NOT_FOUND' });
    }
  }

  // ── Calculate financials ─────────────────────────────────
  const saleItems = inventoryChecks.map((inv, idx) => {
    const reqItem    = items[idx];
    const qty        = parseInt(reqItem.quantity, 10) || 1;
    const unitPrice  = parseFloat(reqItem.unit_price) || parseFloat(inv.selling_price);
    const costPrice  = parseFloat(inv.cost_price);

    // Phase C.3 (C3-3): the inventory record may carry a configured
    // minimum selling price — a floor the sales floor cannot undercut.
    // Enforced here, before the transaction/stock-claim phase, so a
    // rejected price leaves zero side effects (no sale, no sale items,
    // no stock movement, no invoice number consumed).
    if (inv.min_price != null && unitPrice < Number(inv.min_price)) {
      throw Object.assign(
        new Error(
          `سعر البيع (${unitPrice}) أقل من الحد الأدنى المسموح (${Number(inv.min_price)}) لـ ${inv.brand} ${inv.model}.`
        ),
        { code: 'VALIDATION_ERROR' }
      );
    }

    const totalPrice = unitPrice * qty;
    const profit     = (unitPrice - costPrice) * qty;

    return {
      inventory_id:   inv.id,
      quantity:       qty,
      unit_price:     unitPrice,
      cost_price:     costPrice,
      total_price:    totalPrice,
      profit,
      // Immutable snapshot at time of sale
      chassis_number: inv.chassis_number || null,
      engine_number:  inv.engine_number  || null,
      color:          inv.color          || null,
      vehicle_model:  `${inv.brand} ${inv.model}`.trim(),
      _inv: inv,
    };
  });

  const subtotal      = saleItems.reduce((sum, i) => sum + i.total_price, 0);
  const totalDiscount = parseFloat(discount) || 0;
  const total         = subtotal - totalDiscount;
  const totalProfit   = saleItems.reduce((sum, i) => sum + i.profit, 0) - totalDiscount;

  if (total <= 0) {
    throw Object.assign(new Error('إجمالي الفاتورة يجب أن يكون أكبر من صفر.'), { code: 'VALIDATION_ERROR' });
  }

  // ── Phase C.1 (1A): installment arithmetic must reconcile ────────
  // down_payment + monthly_amount × installment_months must equal the
  // invoice total (within ±0.01). Integer "cents" math (hundredths of
  // the currency unit) keeps the comparison exact — never float
  // arithmetic on money. Without this, the sale's books (total/profit)
  // and its collectible schedule (down + installments) could disagree
  // permanently. The existing `down_payment < total` rule is preserved
  // and now enforced at the service level too (previously it only lived
  // in the zod schema, which the app never exercises because the client
  // doesn't send `total`).
  if (sale_type === 'INSTALLMENT') {
    const downCents    = Math.round(parseFloat(down_payment)    * 100);
    const monthlyCents = Math.round(parseFloat(monthly_amount)  * 100);
    const months       = parseInt(installment_months, 10) || 0;
    const totalCents   = Math.round(total * 100);
    const collectible  = downCents + monthlyCents * months;

    if (downCents >= totalCents) {
      throw Object.assign(
        new Error('الدفعة الأولى يجب أن تكون أقل من الإجمالي.'),
        { code: 'VALIDATION_ERROR' }
      );
    }
    if (Math.abs(collectible - totalCents) > 1) {
      throw Object.assign(
        new Error('مجموع الدفعة الأولى والأقساط يجب أن يساوي إجمالي الفاتورة'),
        { code: 'VALIDATION_ERROR' }
      );
    }
  }

  // ── Invoice number ───────────────────────────────────────
  // Phase C.2 (STK-1 concurrency): generated INSIDE the transaction
  // below as its first step, passing `tx` — the generator's advisory
  // lock then covers the sale-row creation itself. Previously the
  // number was minted here in a separate transaction, so two
  // concurrent createSale calls could both derive the same seq from
  // the same last row (neither row existed yet when the second read)
  // and collide on the (showroom_id, invoice_number) unique index →
  // a 500. Reproduced by the C.2 concurrency tests.

  // ── Build installments schedule ──────────────────────────
  let installmentsData = [];
  if (sale_type === 'INSTALLMENT') {
    const months    = parseInt(installment_months, 10);
    const monthly   = parseFloat(monthly_amount);
    const startDate = new Date(first_due_date);

    for (let m = 0; m < months; m++) {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + m);
      installmentsData.push({ amount: monthly, due_date: dueDate, is_paid: false });
    }
  }

  // ── Transaction ──────────────────────────────────────────
  // lowStockAlerts is populated INSIDE the tx callback below (from the
  // post-claim quantity re-read per item) but the actual notification
  // calls happen AFTER the transaction commits, see below.
  // notification.service.js writes through the shared `prisma`
  // client, not `tx` — calling it from inside this callback would reach
  // for a second connection while the first is mid-transaction, and the
  // write would land outside the transaction's atomicity anyway.
  const lowStockAlerts = [];

  let invoiceNumber = null;

  const sale = await prisma.$transaction(async (tx) => {
    // 0. Invoice number — first step of the transaction: the
    //    generator's pg_advisory_xact_lock is transaction-scoped, so
    //    holding it here serializes the read AND the row creation
    //    against every other concurrent sale in this showroom.
    invoiceNumber = await generateInvoiceNumber(showroomId, tx);

    // 1. Create sale record
    const newSale = await tx.sale.create({
      data: {
        showroom_id:    showroomId,
        customer_id:    customer_id || null,
        user_id:        userId,
        invoice_number: invoiceNumber,
        sale_type,
        status:         'ACTIVE',
        subtotal,
        discount:       totalDiscount,
        total,
        profit:         totalProfit,
        notes:          notes || null,
        sold_at:        new Date(),
        ...(sale_type === 'INSTALLMENT' && {
          down_payment:       parseFloat(down_payment),
          monthly_amount:     parseFloat(monthly_amount),
          installment_months: parseInt(installment_months, 10),
          next_due_date:      new Date(first_due_date),
        }),
      },
    });

    // 2. Create sale items with snapshot
    await tx.saleItem.createMany({
      data: saleItems.map((item) => ({
        sale_id:        newSale.id,
        inventory_id:   item.inventory_id,
        quantity:       item.quantity,
        unit_price:     item.unit_price,
        cost_price:     item.cost_price,
        total_price:    item.total_price,
        profit:         item.profit,
        chassis_number: item.chassis_number,
        engine_number:  item.engine_number,
        color:          item.color,
        vehicle_model:  item.vehicle_model,
      })),
    });

    // 3. Claim inventory quantities ATOMICALLY (Phase C.2 — STK-1).
    //    The availability pre-check above ("Check inventory
    //    availability") is a UX/validation guard only — it reads
    //    quantities OUTSIDE the transaction, so two concurrent
    //    createSale calls can both pass it on the same last unit.
    //    The authoritative claim therefore lives HERE, inside the
    //    transaction, as a CONDITIONAL update guarded on
    //    status = IN_STOCK AND quantity >= requested: exactly one
    //    concurrent caller can win the claim; the loser matches 0
    //    rows → CONFLICT → the whole sale rolls back. No negative
    //    stock, no phantom sale, no double-sell of the last unit.
    //    Same conditional-claim pattern as cancelSale's status flip
    //    (Phase A, P2-5).
    for (const item of saleItems) {
      const claim = await tx.inventory.updateMany({
        where: {
          id:       item.inventory_id,
          status:   'IN_STOCK',
          quantity: { gte: item.quantity },
        },
        data: { quantity: { decrement: item.quantity } },
      });

      if (claim.count !== 1) {
        throw Object.assign(
          new Error(`نفدت الكمية المطلوبة من ${item._inv.brand} ${item._inv.model} أثناء تنفيذ البيع. حاول مرة أخرى.`),
          { code: 'CONFLICT' }
        );
      }

      // Post-claim quantity comes from a FRESH read inside the tx —
      // the pre-check snapshot (`item._inv.quantity`) may have raced.
      // The SOLD transition (quantity → 0) is derived from this read,
      // never from the stale snapshot.
      const after = await tx.inventory.findUnique({
        where: { id: item.inventory_id },
        select: { quantity: true },
      });
      const newQty = after ? after.quantity : 0;

      await tx.inventory.update({
        where: { id: item.inventory_id },
        data:  { status: newQty === 0 ? 'SOLD' : 'IN_STOCK' },
      });

      // NOTIFICATION WIRING (Matrix Audit #12): notifyLowStock existed
      // but was never called from anywhere. Collected here (same
      // threshold/status semantics as inventory.service.js's
      // getStats/getLowStock — IN_STOCK + qty <= LOW_STOCK_THRESHOLD),
      // fired after the transaction commits — see below.
      if (newQty > 0 && newQty <= LOW_STOCK_THRESHOLD) {
        lowStockAlerts.push({
          brand:    item._inv.brand,
          model:    item._inv.model,
          quantity: newQty,
        });
      }
    }

    // 4. Create installments
    if (installmentsData.length > 0) {
      await tx.installment.createMany({
        data: installmentsData.map((inst) => ({ sale_id: newSale.id, ...inst })),
      });
    }

    // 5. Return the FULL sale with relations — fetched HERE, inside the
    // same transaction, as the last step (Matrix Audit — Phase 2). This
    // replaces what used to be a SEPARATE prisma.sale.findUnique() call
    // made AFTER this transaction had already committed — an extra
    // round-trip that also meant the read technically happened outside
    // the transaction's atomicity guarantee (no real risk in practice
    // since nothing else could touch a brand-new sale.id in that gap,
    // but there's no reason to leave that gap open at all when tx.*
    // can do the same read for free in the same round-trip instead).
    return tx.sale.findUnique({
      where:   { id: newSale.id },
      include: {
        customer:     true,
        items:        { include: { inventory: true } },
        installments: { orderBy: { due_date: 'asc' } },
      },
    });
  });

  // NOTIFICATION WIRING (Matrix Audit — Notifications Phase): fired
  // after the transaction above has fully committed and returned the
  // complete sale — `sale` here IS the full object now (see step 5
  // inside the transaction above), no second query needed.
  await notificationService.notifySaleCreated(showroomId, {
    invoiceNumber,
    total:        sale.total,
    customerName: sale.customer?.name,
  });

  for (const alert of lowStockAlerts) {
    await notificationService.notifyLowStock(showroomId, alert);
  }

  return { sale, invoiceNumber };
};

// ─────────────────────────────────────────
// CANCEL SALE
//
// Business rule (showroom-specific, not generic SaaS default):
//   • CASH sales            → always cancellable. Restore inventory, done.
//   • INSTALLMENT sales:
//       - down_payment is a field on the `sale` row itself, set once at
//         creation in createSale(). It is NEVER represented as a row in
//         `installment` — the installment rows created in createSale()
//         are exclusively the recurring monthly schedule. So "customer
//         has only paid the down payment, no recurring installments yet"
//         is naturally true whenever no installment row has is_paid=true.
//       - If ANY installment row has is_paid: true, the sale has
//         recurring payments already collected. Cancellation is BLOCKED
//         (fail-closed) with a clear CONFLICT error. Reversing already-
//         collected installment money is a financial operation (refund)
//         that must be handled deliberately, not as a side-effect of
//         flipping a status flag.
//
// FAIL-CLOSED GUARANTEE: the installment-paid check happens INSIDE the
// same $transaction as the status update and inventory restoration —
// not before it. This closes the race window where a payInstallment()
// call could land between an outside check and the cancellation,
// which would otherwise let a sale with newly-paid installments slip
// through cancellation anyway. Prisma's default transaction isolation
// (READ COMMITTED) is sufficient here because we re-read installments
// fresh from inside `tx`, not from the `sale` object fetched earlier.
// ─────────────────────────────────────────
const cancelSale = async ({ showroomId, id }) => {
  const sale = await prisma.sale.findFirst({
    where:   { id, showroom_id: showroomId },
    include: { items: true },
  });

  if (!sale) throw Object.assign(new Error('الفاتورة غير موجودة.'), { code: 'NOT_FOUND' });
  if (sale.status === 'CANCELLED') {
    throw Object.assign(new Error('الفاتورة ملغاة مسبقاً.'), { code: 'CONFLICT' });
  }
  if (sale.status === 'COMPLETED') {
    throw Object.assign(
      new Error('لا يمكن إلغاء فاتورة مكتملة بالكامل. يلزم إجراء استرداد مالي رسمي.'),
      { code: 'CONFLICT' }
    );
  }

  const cancelledSale = await prisma.$transaction(async (tx) => {
    // Re-check installment state INSIDE the transaction — this is the
    // guard that must be atomic with the cancellation itself.
    if (sale.sale_type === 'INSTALLMENT') {
      const paidInstallmentCount = await tx.installment.count({
        where: { sale_id: sale.id, is_paid: true },
      });

      if (paidInstallmentCount > 0) {
        throw Object.assign(
          new Error(
            `لا يمكن إلغاء هذه الفاتورة — تم تحصيل ${paidInstallmentCount} قسط/أقساط من العميل. ` +
            `يجب معالجة الاسترداد المالي رسمياً قبل إلغاء البيع.`
          ),
          { code: 'CONFLICT', paidInstallmentCount }
        );
      }
    }

    // Phase A (P2-5): the status flip is now a CONDITIONAL claim —
    // updateMany guarded on status = 'ACTIVE'. Previously this was an
    // unconditional update: two concurrent cancel requests on the same
    // sale could both pass the pre-transaction 'CANCELLED' check (both
    // read ACTIVE), then BOTH flip the status and BOTH restore the
    // full inventory quantity — a double-credit on the warehouse stock.
    // The count check inside the transaction makes the second
    // concurrent caller lose the claim, and the rollback guarantees
    // the loser's inventory restore never happens.
    const claim = await tx.sale.updateMany({
      where: { id: sale.id, showroom_id: sale.showroom_id, status: 'ACTIVE' },
      data:  { status: 'CANCELLED' },
    });

    if (claim.count === 0) {
      throw Object.assign(new Error('هذه الفاتورة ملغاة بالفعل.'), { code: 'CONFLICT' });
    }

    // Restore inventory — full original quantity per item, same as before.
    // Reachable ONLY after the claim succeeded; on a lost race the
    // whole transaction rolls back and nothing is restored.
    for (const item of sale.items) {
      const inv = await tx.inventory.findUnique({ where: { id: item.inventory_id } });
      if (inv) {
        await tx.inventory.update({
          where: { id: item.inventory_id },
          data:  { quantity: { increment: item.quantity }, status: 'IN_STOCK' },
        });
      }
    }

    // Mark pending (unpaid) installments as void. Since we already
    // guarded against any PAID installments existing above, every
    // installment row reachable here is guaranteed unpaid.
    await tx.installment.updateMany({
      where: { sale_id: sale.id, is_paid: false },
      data:  { note: 'SALE_CANCELLED' },
    });

    // Same shape as the old return (status CANCELLED) — the only
    // consumers use sale.id and sale.status, both unchanged here.
    return { ...sale, status: 'CANCELLED' };
  });

  // NOTIFICATION WIRING (Matrix Audit #12): notifySaleCancelled existed
  // but was never called from anywhere. `sale.invoice_number` is from
  // the pre-transaction fetch above — the invoice number never changes
  // on cancellation, so no re-fetch is needed.
  //
  // BUG FIX: this call sat un-guarded AFTER the $transaction above
  // already committed. Any failure inside it (DB hiccup, a bug in the
  // notification service, anything) rejected this whole function —
  // the controller's catch-all turned that into a 500 "فشل" response
  // to the user, even though the cancellation + inventory restore had
  // ALREADY succeeded and were already durably saved. A retry would
  // then hit the `sale.status === 'CANCELLED'` guard above and show a
  // second, different error — from the user's perspective: "it failed
  // twice" for an action that actually succeeded the first time.
  // Same fire-and-forget treatment as audit logging elsewhere in this
  // codebase — a side effect must never be able to fail the primary
  // operation's response once that operation has already committed.
  try {
    await notificationService.notifySaleCancelled(showroomId, {
      invoiceNumber: sale.invoice_number,
    });
  } catch (err) {
    logger.error('notifySaleCancelled failed (sale already cancelled successfully):', err);
  }

  return cancelledSale;
};

// ─────────────────────────────────────────
// PAY INSTALLMENT
// ─────────────────────────────────────────
const payInstallment = async ({ showroomId, installmentId, note }) => {
  const installment = await prisma.installment.findFirst({
    where:   { id: installmentId },
    include: {
      sale: {
        select: {
          showroom_id: true, id: true, invoice_number: true, status: true,
          customer:    { select: { name: true } },
        },
      },
    },
  });

  if (!installment) throw Object.assign(new Error('القسط غير موجود.'), { code: 'NOT_FOUND' });

  if (installment.sale.showroom_id !== showroomId) {
    throw Object.assign(new Error('غير مسموح.'), { code: 'FORBIDDEN' });
  }

  if (installment.is_paid) {
    throw Object.assign(new Error('القسط مدفوع مسبقاً.'), { code: 'CONFLICT' });
  }

  // Phase C.1 (1B): never accept a payment on a CANCELLED sale. A
  // cancelled invoice's installments are stamped (not destroyed) so
  // the audit trail stays intact — without this guard, a staff member
  // could still record money against an invoice that no longer exists
  // commercially. The status-correction logic below can therefore
  // assume the sale is a live (ACTIVE/OVERDUE) one.
  if (installment.sale.status === 'CANCELLED') {
    throw Object.assign(new Error('لا يمكن تسجيل دفعة على فاتورة ملغاة'), { code: 'CONFLICT' });
  }

  // Phase C.4 (concurrency fix — P1): the is_paid check ABOVE is a
  // TOCTOU-unsafe fast path — two simultaneous pay requests for the
  // same installment both read is_paid:false and both used to proceed
  // to mark it paid, double-charging the customer (both requests would
  // also race the status-correction below). The actual payment flip is
  // now CONDITIONAL on the row still being unpaid — updateMany with
  // `is_paid: false` in the where clause flips at most one row, and
  // the affected-row count declares the single winner. The loser gets
  // the same clean CONFLICT the sequential path gives, with nothing
  // written.
  const [{ count: flipped }] = await prisma.$transaction([
    prisma.installment.updateMany({
      where: { id: installmentId, is_paid: false },
      data:  { is_paid: true, paid_at: new Date(), note: note || null },
    }),
  ]);

  if (flipped === 0) {
    throw Object.assign(new Error('القسط مدفوع مسبقاً.'), { code: 'CONFLICT' });
  }

  // Reload the paid row — the updateMany above returns no row data,
  // and the controller's audit entry needs the parent invoice number
  // (Phase C.2 AUD-1 contract) plus `amount` for the notification.
  const paid = await prisma.installment.findUnique({
    where:  { id: installmentId },
    include: { sale: { select: { invoice_number: true } } },
  });

  // Mark the sale COMPLETED iff NO unpaid installment remains — the
  // condition lives IN the updateMany's where clause, so it is decided
  // atomically by the database at update time. This removes a second
  // read-then-write race that existed between two CONCURRENT payments
  // of DIFFERENT installments of the same sale: the old code computed
  // `remaining` then updated, and two racing payments could interleave
  // so the sale ended ACTIVE despite every installment being paid.
  const completed = await prisma.sale.updateMany({
    where: {
      id:           installment.sale.id,
      installments: { none: { is_paid: false } },
    },
    data: { status: 'COMPLETED', next_due_date: null },
  });

  if (completed.count === 0) {
    // ── Still-unpaid installments remain → refresh next-due + status ──
    const nextInst = await prisma.installment.findFirst({
      where:   { sale_id: installment.sale.id, is_paid: false },
      orderBy: { due_date: 'asc' },
    });

    // Matrix Audit (Phase 2): SaleStatus.OVERDUE is SET by
    // notification.service.js's runOverdueInstallmentScan() the first
    // time an installment crosses into overdue. This is the matching
    // reversal half — re-checked every time a payment is recorded
    // (not just when the sale becomes fully paid above), because
    // paying off the ONE overdue installment while others remain
    // (not yet due) should clear the OVERDUE flag, not leave it stuck
    // forever until the whole sale completes.
    //
    // Phase C.1 (1B): payments on CANCELLED sales are rejected before
    // this point (see payInstallment's guard above), so a CANCELLED
    // sale can never reach the status-correction path — the branch
    // below is retained as defense in depth.
    if (installment.sale.status !== 'CANCELLED') {
      const stillOverdue = await prisma.installment.count({
        where: {
          sale_id:  installment.sale.id,
          is_paid:  false,
          due_date: { lt: new Date() },
        },
      });

      await prisma.sale.update({
        where: { id: installment.sale.id },
        data: {
          next_due_date: nextInst?.due_date || null,
          status:        stillOverdue > 0 ? 'OVERDUE' : 'ACTIVE',
        },
      });
    } else if (nextInst) {
      await prisma.sale.update({
        where: { id: installment.sale.id },
        data:  { next_due_date: nextInst.due_date },
      });
    }
  }

  // Phase C.2 (AUD-1): installment-payment notification. This is the
  // CUSTOMER-payment flavour — deliberately NOT the supplier-flavoured
  // notifyPaymentReceived helper (which has no callers and would say
  // "للمورد" for a customer installment). Fired only after the payment
  // transaction AND the status-correction above have fully succeeded.
  // createNotification swallows its own errors internally; the
  // try/catch below is belt-and-suspenders so a notification hiccup
  // can never surface as a failed payment (same fire-and-forget
  // treatment as cancelSale's notifySaleCancelled).
  try {
    await notificationService.notifyInstallmentPayment(showroomId, {
      invoiceNumber: installment.sale.invoice_number,
      amount:        paid.amount,
      customerName:  installment.sale.customer?.name,
    });
  } catch (err) {
    logger.error('notifyInstallmentPayment failed (payment already recorded):', err);
  }

  return paid;
};

// ─────────────────────────────────────────
// OVERDUE INSTALLMENTS
// ─────────────────────────────────────────
const getOverdueInstallments = async ({ showroomId, query }) => {
  const { page, limit, skip } = getPagination(query);

  // Phase C.2 (OVD-1): a sale whose installments are overdue is flipped
  // to OVERDUE by runOverdueInstallmentScan (notification.service.js) —
  // filtering on status 'ACTIVE' alone silently DROPPED those overdue
  // installments from this list once the cron had run. OVERDUE must
  // stay visible (the money is still collectible); CANCELLED and
  // COMPLETED never appear here.
  const filter = {
    is_paid:  false,
    due_date: { lt: new Date() },
    sale:     { showroom_id: showroomId, status: { in: ['ACTIVE', 'OVERDUE'] } },
  };

  // Phase C.6 (P1): total_amount — the SUM of the matching overdue
  // installments (not the row count), aggregated by the database over
  // the same tenant-scoped `filter` as the rows. The installments page
  // previously summed ONLY the current page's rows client-side, so the
  // displayed overdue total silently shrank as the page flipped — same
  // defect class as C.4 EXP-2 (expenses), same server-aggregate fix.
  const [items, total, amountAgg] = await Promise.all([
    prisma.installment.findMany({
      where:   filter,
      skip,
      take:    limit,
      orderBy: { due_date: 'asc' },
      include: {
        sale: {
          select: {
            id:             true,
            invoice_number: true,
            customer:       { select: { name: true, phone: true } },
          },
        },
      },
    }),
    prisma.installment.count({ where: filter }),
    prisma.installment.aggregate({ where: filter, _sum: { amount: true } }),
  ]);

  const totalAmount = parseFloat(amountAgg._sum.amount?.toString() || '0');

  return {
    items,
    pagination: { ...buildPaginationMeta(total, page, limit), total_amount: totalAmount },
  };
};

// ─────────────────────────────────────────
// UPCOMING INSTALLMENTS
// ─────────────────────────────────────────
const getUpcomingInstallments = async ({ showroomId, days = 30 }) => {
  const until = new Date();
  until.setDate(until.getDate() + parseInt(days, 10));

  // Phase C.2 (OVD-1): same OVERDUE-inclusion rationale as
  // getOverdueInstallments — a parent sale being OVERDUE must not hide
  // its still-unpaid FUTURE installments from the upcoming list. Only
  // future due_dates are selected here, so nothing past-due can leak
  // into "upcoming" merely because the parent sale is OVERDUE.
  return prisma.installment.findMany({
    where: {
      is_paid:  false,
      due_date: { gte: new Date(), lte: until },
      sale:     { showroom_id: showroomId, status: { in: ['ACTIVE', 'OVERDUE'] } },
    },
    orderBy: { due_date: 'asc' },
    take:    50,
    include: {
      sale: {
        select: {
          id:             true,
          invoice_number: true,
          monthly_amount: true,
          customer:       { select: { name: true, phone: true } },
        },
      },
    },
  });
};

// ─────────────────────────────────────────
// SALES SUMMARY
//
// FIX: financial aggregates (_sum.total, _sum.profit, _sum.discount,
// _avg.total) and by_type's sums now explicitly exclude CANCELLED
// sales — matching the same `status: { not: 'CANCELLED' }` pattern
// used consistently throughout analytics.service.js. Previously this
// method had NO status filter at all, meaning a cancelled invoice's
// money was still being counted in total_revenue/total_profit even
// though cancelSale() never zeroes out those fields on the row (it
// only flips status) — so the leak was silent, not a crash.
//
// by_status intentionally keeps its OWN unfiltered where (no date
// range, no status exclusion) — its entire purpose is to show the
// count of cancelled sales too (this is what page.tsx's
// cancelledCount is derived from). Excluding CANCELLED there would
// make it impossible to ever see how many sales were cancelled.
// ─────────────────────────────────────────
const getSalesSummary = async ({ showroomId, query }) => {
  const dateRange = getDateRange(query);

  // Used for every financial aggregate — excludes cancelled sales,
  // exactly like analytics.service.js does everywhere else.
  const financialWhere = {
    showroom_id: showroomId,
    sold_at:     dateRange,
    status:      { not: 'CANCELLED' },
  };

  const [aggregate, byType, byStatus] = await Promise.all([
    prisma.sale.aggregate({
      where:  financialWhere,
      _sum:   { total: true, profit: true, discount: true },
      _count: true,
      _avg:   { total: true },
    }),
    prisma.sale.groupBy({
      by:     ['sale_type'],
      where:  financialWhere,
      _count: true,
      _sum:   { total: true, profit: true },
    }),
    prisma.sale.groupBy({
      by:     ['status'],
      where:  { showroom_id: showroomId },
      _count: true,
    }),
  ]);

  return {
    period:         query.range || 'month',
    total_sales:    aggregate._count,
    total_revenue:  aggregate._sum.total    || 0,
    total_profit:   aggregate._sum.profit   || 0,
    total_discount: aggregate._sum.discount || 0,
    avg_sale:       aggregate._avg.total    || 0,
    by_type:        byType,
    by_status:      byStatus,
  };
};

module.exports = {
  listSales,
  getSale,
  createSale,
  cancelSale,
  payInstallment,
  getOverdueInstallments,
  getUpcomingInstallments,
  getSalesSummary,
};
