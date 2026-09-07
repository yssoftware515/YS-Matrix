// ============================================================
// YS-MATRIX ERP — Sales Controller (Phase 2 Stage 2)
// Now THIN — all business logic moved to sales.service.js
// ============================================================

'use strict';

const salesService = require('../services/sales.service');
const response     = require('../utils/response');
const { auditLog } = require('../middleware/audit.middleware');
const { handleServiceError } = require('../utils/errorHandler');

// ─────────────────────────────────────────
const getAllSales = async (req, res) => {
  try {
    const { sales, pagination } = await salesService.listSales({
      showroomId: req.showroomId,
      query:      req.query,
    });
    return response.paginated(res, sales, pagination);
  } catch (err) {
    return handleServiceError(res, err);
  }
};

// ─────────────────────────────────────────
const getSale = async (req, res) => {
  try {
    const sale = await salesService.getSale({
      showroomId: req.showroomId,
      id:         req.params.id,
    });
    if (!sale) return response.notFound(res, 'الفاتورة غير موجودة.');
    return response.success(res, sale);
  } catch (err) {
    return handleServiceError(res, err);
  }
};

// ─────────────────────────────────────────
const createSale = async (req, res) => {
  try {
    const { sale, invoiceNumber } = await salesService.createSale({
      showroomId: req.showroomId,
      userId:     req.user.id,
      data:       req.body,
    });
    auditLog({
      showroomId: req.showroomId,
      userId:     req.user.id,
      action:     'CREATE_SALE',
      entity:     'sale',
      entityId:   sale.id,
      newData:    { invoice_number: invoiceNumber, total: sale.total, sale_type: sale.sale_type },
      ipAddress:  req.ip,
    });
    return response.created(res, sale, `تم إنشاء الفاتورة ${invoiceNumber} بنجاح.`);
  } catch (err) {
    return handleServiceError(res, err);
  }
};

// ─────────────────────────────────────────
const cancelSale = async (req, res) => {
  try {
    const sale = await salesService.cancelSale({
      showroomId: req.showroomId,
      id:         req.params.id,
    });
    auditLog({
      showroomId: req.showroomId,
      userId:     req.user.id,
      action:     'CANCEL_SALE',
      entity:     'sale',
      entityId:   sale.id,
      oldData:    { status: sale.status },
      newData:    { status: 'CANCELLED' },
      ipAddress:  req.ip,
    });
    return response.success(res, null, 'تم إلغاء الفاتورة واسترداد المخزون.');
  } catch (err) {
    return handleServiceError(res, err);
  }
};

// ─────────────────────────────────────────
const payInstallment = async (req, res) => {
  try {
    const paid = await salesService.payInstallment({
      showroomId:     req.showroomId,
      installmentId:  req.params.installment_id,
      note:           req.body?.note,
    });

    // Phase C.2 (AUD-1): installment payments were cash movements with
    // no audit trail — every other money-adjacent action (createSale,
    // cancelSale) records one. Fire-and-forget, same as the others.
    auditLog({
      showroomId: req.showroomId,
      userId:     req.user.id,
      action:     'PAY_INSTALLMENT',
      entity:     'installment',
      entityId:   paid.id,
      oldData:    { is_paid: false, paid_at: null },
      newData:    {
        is_paid:        true,
        amount:         paid.amount,
        invoice_number: paid.sale?.invoice_number || null,
        note:           paid.note || null,
      },
      ipAddress: req.ip,
    });

    return response.success(res, paid, 'تم تسجيل الدفعة بنجاح.');
  } catch (err) {
    return handleServiceError(res, err);
  }
};

// ─────────────────────────────────────────
const getOverdueInstallments = async (req, res) => {
  try {
    const { items, pagination } = await salesService.getOverdueInstallments({
      showroomId: req.showroomId,
      query:      req.query,
    });
    return response.paginated(res, items, pagination);
  } catch (err) {
    return handleServiceError(res, err);
  }
};

// ─────────────────────────────────────────
const getUpcomingInstallments = async (req, res) => {
  try {
    const items = await salesService.getUpcomingInstallments({
      showroomId: req.showroomId,
      days:       req.query.days,
    });
    return response.success(res, items);
  } catch (err) {
    return handleServiceError(res, err);
  }
};

// ─────────────────────────────────────────
const getSalesSummary = async (req, res) => {
  try {
    const summary = await salesService.getSalesSummary({
      showroomId: req.showroomId,
      query:      req.query,
    });
    return response.success(res, summary);
  } catch (err) {
    return handleServiceError(res, err);
  }
};

module.exports = {
  getAllSales,
  getSale,
  createSale,
  cancelSale,
  payInstallment,
  getOverdueInstallments,
  getUpcomingInstallments,
  getSalesSummary,
};
