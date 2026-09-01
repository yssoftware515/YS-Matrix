// ============================================================
// YS-MATRIX ERP — Supplier Controller (Phase 2 Stage 2)
// Now THIN — all business logic in supplier.service.js
// ============================================================

'use strict';

const supplierService = require('../services/supplier.service');
const response        = require('../utils/response');
const logger          = require('../config/logger');
const { auditLog }    = require('../middleware/audit.middleware');

const handleServiceError = (res, err) => {
  if (err.code === 'NOT_FOUND')        return response.notFound(res, err.message);
  if (err.code === 'VALIDATION_ERROR') return response.validationError(res, null, err.message);
  if (err.code === 'CONFLICT')         return response.conflict(res, err.message);
  if (err.code === 'FORBIDDEN')        return response.forbidden(res, err.message);
  logger.error('Supplier service error:', err);
  return response.serverError(res, 'حدث خطأ في معالجة الطلب.');
};

// ─────────────────────────────────────────
const getAllSuppliers = async (req, res) => {
  try {
    const { suppliers, pagination } = await supplierService.listSuppliers({
      showroomId: req.showroomId,
      query:      req.query,
    });
    return response.paginated(res, suppliers, pagination);
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const getSupplier = async (req, res) => {
  try {
    const supplier = await supplierService.getSupplier({
      showroomId: req.showroomId,
      id:         req.params.id,
    });
    if (!supplier) return response.notFound(res, 'المورد غير موجود.');
    return response.success(res, supplier);
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const createSupplier = async (req, res) => {
  try {
    const supplier = await supplierService.createSupplier({
      showroomId: req.showroomId,
      data:       req.body,
    });
    auditLog({
      showroomId: req.showroomId, userId: req.user.id,
      action: 'CREATE', entity: 'supplier',
      entityId: supplier.id, newData: supplier, ipAddress: req.ip,
    });
    return response.created(res, supplier, 'تم إضافة المورد بنجاح.');
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const updateSupplier = async (req, res) => {
  try {
    const { existing, updated } = await supplierService.updateSupplier({
      showroomId: req.showroomId,
      id:         req.params.id,
      data:       req.body,
    });
    auditLog({
      showroomId: req.showroomId, userId: req.user.id,
      action: 'UPDATE', entity: 'supplier',
      entityId: updated.id, oldData: existing, newData: updated, ipAddress: req.ip,
    });
    return response.success(res, updated, 'تم تحديث بيانات المورد.');
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const deleteSupplier = async (req, res) => {
  try {
    const deactivated = await supplierService.deleteSupplier({
      showroomId: req.showroomId,
      id:         req.params.id,
    });
    auditLog({
      showroomId: req.showroomId, userId: req.user.id,
      action: 'SOFT_DELETE', entity: 'supplier',
      entityId: req.params.id,
      oldData: { is_active: true }, newData: { is_active: false }, ipAddress: req.ip,
    });
    return response.success(res, { id: deactivated.id, is_active: false },
      'تم تعطيل المورد — البيانات التاريخية محفوظة.');
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const reactivateSupplier = async (req, res) => {
  try {
    const reactivated = await supplierService.reactivateSupplier({
      showroomId: req.showroomId,
      id:         req.params.id,
    });
    auditLog({
      showroomId: req.showroomId, userId: req.user.id,
      action: 'REACTIVATE', entity: 'supplier',
      entityId: req.params.id, newData: { is_active: true }, ipAddress: req.ip,
    });
    return response.success(res, reactivated, 'تم تفعيل المورد.');
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const addPayment = async (req, res) => {
  try {
    const payment = await supplierService.addPayment({
      showroomId:  req.showroomId,
      supplierId:  req.params.id,
      data:        req.body,
    });
    auditLog({
      showroomId: req.showroomId, userId: req.user.id,
      action: 'ADD_PAYMENT', entity: 'supplier',
      entityId: req.params.id,
      newData: { amount: req.body.amount, payment_type: req.body.payment_type },
      ipAddress: req.ip,
    });
    return response.created(res, payment, 'تم تسجيل الدفعة بنجاح.');
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const getPaymentHistory = async (req, res) => {
  try {
    const { payments, pagination } = await supplierService.getPaymentHistory({
      showroomId:  req.showroomId,
      supplierId:  req.params.id,
      query:       req.query,
    });
    return response.paginated(res, payments, pagination);
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const getSupplierStats = async (req, res) => {
  try {
    const stats = await supplierService.getSupplierStats({ showroomId: req.showroomId });
    return response.success(res, stats);
  } catch (err) { return handleServiceError(res, err); }
};

module.exports = {
  getAllSuppliers, getSupplier, createSupplier, updateSupplier,
  deleteSupplier, reactivateSupplier, addPayment, getPaymentHistory, getSupplierStats,
};
