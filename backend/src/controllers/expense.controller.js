// ============================================================
// YS-MATRIX ERP - Expense Controller
// Author: Yahya Al-Sulami 🦅
// ============================================================

const prisma = require('../config/database');
const response = require('../utils/response');
const logger = require('../config/logger');
const { getPagination, buildPaginationMeta } = require('../utils/pagination');
const { withTenant } = require('../middleware/tenant.middleware');
const { auditLog } = require('../middleware/audit.middleware');
const { getDateRange } = require('../utils/dateRange');

// ─────────────────────────────────────────
// Phase C.3 (C3-1) — server-authoritative financial validation.
// An expense amount must be a finite number strictly greater than zero:
// NaN ('abc'), negatives and zero can never reach the ledger. Arabic
// messages match the product convention used across the rest of the app.
// ─────────────────────────────────────────
const parseExpenseAmount = (value) => {
  if (value === undefined || value === null || value === '') {
    return { error: 'مبلغ المصروف مطلوب.' };
  }
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) return { error: 'مبلغ المصروف قيمة غير صالحة.' };
  if (num <= 0) return { error: 'مبلغ المصروف يجب أن يكون أكبر من صفر.' };
  return { value: num };
};

const parseExpenseCategory = (value) => {
  const category = typeof value === 'string' ? value.trim() : '';
  if (!category) return { error: 'تصنيف المصروف مطلوب.' };
  return { value: category };
};

const getAllExpenses = async (req, res) => {
  try {
    const { page, limit, skip } = getPagination(req.query);
    const { category, range } = req.query;
    const dateRange = getDateRange({ range });

    const where = { ...withTenant(req), expense_date: dateRange };
    if (category) where.category = category;

    // Phase C.4 (EXP-2): total_amount — the SUM of the matching
    // expenses (not the row count), aggregated by the database with
    // exact decimal math. The expenses page previously summed the
    // CURRENT PAGE's rows client-side, so the displayed total silently
    // shrank as the page flipped. The aggregate is computed over the
    // same `where` as the rows, so the number always matches the
    // filtered set the user is looking at.
    const [expenses, total, amountAgg] = await Promise.all([
      prisma.expense.findMany({
        where, skip, take: limit,
        orderBy: { expense_date: 'desc' },
      }),
      prisma.expense.count({ where }),
      prisma.expense.aggregate({ where, _sum: { amount: true } }),
    ]);

    const totalAmount = parseFloat(amountAgg._sum.amount?.toString() || '0');

    return response.paginated(res, expenses, {
      ...buildPaginationMeta(total, page, limit),
      total_amount: totalAmount,
    });
  } catch (err) {
    logger.error('Get expenses error:', err);
    return response.error(res, 'تعذر جلب المصروفات.');
  }
};

const createExpense = async (req, res) => {
  try {
    const { category, description, amount, expense_date } = req.body;

    const categoryResult = parseExpenseCategory(category);
    if (categoryResult.error) return response.validationError(res, null, categoryResult.error);
    const amountResult = parseExpenseAmount(amount);
    if (amountResult.error) return response.validationError(res, null, amountResult.error);

    const expense = await prisma.expense.create({
      data: {
        showroom_id: req.showroomId,
        category:    categoryResult.value,
        description: description || null,
        amount:      amountResult.value,
        expense_date: expense_date ? new Date(expense_date) : new Date(),
      },
    });

    await auditLog({
      showroomId: req.showroomId,
      userId: req.user.id,
      action: 'CREATE',
      entity: 'expense',
      entityId: expense.id,
      newData: expense,
      ipAddress: req.ip,
    });

    return response.created(res, expense, 'تم تسجيل المصروف.');
  } catch (err) {
    logger.error('Create expense error:', err);
    return response.error(res, 'تعذر تسجيل المصروف.');
  }
};

const updateExpense = async (req, res) => {
  try {
    const existing = await prisma.expense.findFirst({
      where: { id: req.params.id, ...withTenant(req) },
    });
    if (!existing) return response.notFound(res, 'المصروف غير موجود.');

    const { category, description, amount, expense_date } = req.body;

    let categoryUpdate = {};
    if (category !== undefined) {
      const categoryResult = parseExpenseCategory(category);
      if (categoryResult.error) return response.validationError(res, null, categoryResult.error);
      categoryUpdate = { category: categoryResult.value };
    }

    let amountUpdate = {};
    if (amount !== undefined && amount !== null) {
      const amountResult = parseExpenseAmount(amount);
      if (amountResult.error) return response.validationError(res, null, amountResult.error);
      amountUpdate = { amount: amountResult.value };
    }

    const updated = await prisma.expense.update({
      where: { id: req.params.id },
      data: {
        ...categoryUpdate,
        ...(description !== undefined && { description }),
        ...amountUpdate,
        ...(expense_date && { expense_date: new Date(expense_date) }),
      },
    });

    // Phase C.3 (C3-1): expense mutations are auditable — update now
    // writes the before/after snapshots (create already did).
    await auditLog({
      showroomId: req.showroomId,
      userId: req.user.id,
      action: 'UPDATE',
      entity: 'expense',
      entityId: updated.id,
      oldData: existing,
      newData: updated,
      ipAddress: req.ip,
    });

    return response.success(res, updated, 'تم تحديث المصروف.');
  } catch (err) {
    logger.error('Update expense error:', err);
    return response.error(res, 'تعذر تحديث المصروف.');
  }
};

const deleteExpense = async (req, res) => {
  try {
    const existing = await prisma.expense.findFirst({
      where: { id: req.params.id, ...withTenant(req) },
    });
    if (!existing) return response.notFound(res, 'المصروف غير موجود.');

    await prisma.expense.delete({ where: { id: req.params.id } });

    // Phase C.3 (C3-1): deletions are auditable too — snapshot of the
    // removed record, preserving the full ledger trail.
    await auditLog({
      showroomId: req.showroomId,
      userId: req.user.id,
      action: 'DELETE',
      entity: 'expense',
      entityId: req.params.id,
      oldData: existing,
      newData: null,
      ipAddress: req.ip,
    });

    return response.success(res, null, 'تم حذف المصروف.');
  } catch (err) {
    logger.error('Delete expense error:', err);
    return response.error(res, 'تعذر حذف المصروف.');
  }
};

module.exports = { getAllExpenses, createExpense, updateExpense, deleteExpense };
