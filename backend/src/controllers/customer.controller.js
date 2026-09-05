// ============================================================
// YS-MATRIX ERP — Customer Controller (Phase 2 Stage 2)
// Now THIN — all business logic in customer.service.js
// ============================================================

'use strict';

const customerService = require('../services/customer.service');
const response        = require('../utils/response');
const logger          = require('../config/logger');
const { auditLog }    = require('../middleware/audit.middleware');

const handleServiceError = (res, err) => {
  if (err.code === 'NOT_FOUND')        return response.notFound(res, err.message);
  if (err.code === 'VALIDATION_ERROR') return response.validationError(res, null, err.message);
  if (err.code === 'CONFLICT')         return response.conflict(res, err.message);
  logger.error('Customer service error:', err);
  return response.serverError(res, 'حدث خطأ في معالجة الطلب.');
};

// ─────────────────────────────────────────
const getAllCustomers = async (req, res) => {
  try {
    const { customers, pagination } = await customerService.listCustomers({
      showroomId: req.showroomId,
      query:      req.query,
      role:       req.user.role,
    });
    return response.paginated(res, customers, pagination);
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const getCustomer = async (req, res) => {
  try {
    const customer = await customerService.getCustomer({
      showroomId: req.showroomId,
      id:         req.params.id,
      role:       req.user.role,
    });
    if (!customer) return response.notFound(res, 'العميل غير موجود.');
    return response.success(res, customer);
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const createCustomer = async (req, res) => {
  try {
    const customer = await customerService.createCustomer({
      showroomId: req.showroomId,
      data:       req.body,
    });
    auditLog({
      showroomId: req.showroomId, userId: req.user.id,
      action: 'CREATE', entity: 'customer',
      entityId: customer.id, newData: customer, ipAddress: req.ip,
    });
    return response.created(res, customer, 'تم إضافة العميل بنجاح.');
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const updateCustomer = async (req, res) => {
  try {
    const { existing, updated } = await customerService.updateCustomer({
      showroomId: req.showroomId,
      id:         req.params.id,
      data:       req.body,
    });
    auditLog({
      showroomId: req.showroomId, userId: req.user.id,
      action: 'UPDATE', entity: 'customer',
      entityId: updated.id, oldData: existing, newData: updated, ipAddress: req.ip,
    });
    return response.success(res, updated, 'تم تحديث بيانات العميل.');
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const deleteCustomer = async (req, res) => {
  try {
    const deactivated = await customerService.deleteCustomer({
      showroomId: req.showroomId,
      id:         req.params.id,
    });
    auditLog({
      showroomId: req.showroomId, userId: req.user.id,
      action: 'SOFT_DELETE', entity: 'customer',
      entityId: req.params.id,
      oldData: { is_active: true }, newData: { is_active: false }, ipAddress: req.ip,
    });
    return response.success(res, { id: deactivated.id, is_active: false },
      'تم تعطيل العميل — السجلات التاريخية محفوظة.');
  } catch (err) { return handleServiceError(res, err); }
};

// ─────────────────────────────────────────
const reactivateCustomer = async (req, res) => {
  try {
    const reactivated = await customerService.reactivateCustomer({
      showroomId: req.showroomId,
      id:         req.params.id,
    });
    auditLog({
      showroomId: req.showroomId, userId: req.user.id,
      action: 'REACTIVATE', entity: 'customer',
      entityId: req.params.id, newData: { is_active: true }, ipAddress: req.ip,
    });
    return response.success(res, reactivated, 'تم تفعيل العميل.');
  } catch (err) { return handleServiceError(res, err); }
};

module.exports = {
  getAllCustomers, getCustomer, createCustomer,
  updateCustomer, deleteCustomer, reactivateCustomer,
};
