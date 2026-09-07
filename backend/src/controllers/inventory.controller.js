// ============================================================
// YS-MATRIX ERP — Inventory Controller (Phase 2 Stage 2)
// Now THIN — all business logic moved to inventory.service.js
// Controller only: parse request → call service → send response
// ============================================================

'use strict';

const inventoryService = require('../services/inventory.service');
const response         = require('../utils/response');
const { auditLog }     = require('../middleware/audit.middleware');
const { handleServiceError } = require('../utils/errorHandler');

// ─────────────────────────────────────────
const getAllInventory = async (req, res) => {
  try {
    const { items, pagination } = await inventoryService.listInventory({
      showroomId: req.showroomId,
      query:      req.query,
    });
    return response.paginated(res, items, pagination);
  } catch (err) {
    return handleServiceError(res, err);
  }
};

// ─────────────────────────────────────────
const getInventoryItem = async (req, res) => {
  try {
    const item = await inventoryService.getInventoryItem({
      showroomId: req.showroomId,
      id:         req.params.id,
    });
    if (!item) return response.notFound(res, 'المنتج غير موجود.');
    return response.success(res, item);
  } catch (err) {
    return handleServiceError(res, err);
  }
};

// ─────────────────────────────────────────
const createInventoryItem = async (req, res) => {
  try {
    const item = await inventoryService.createItem({
      showroomId: req.showroomId,
      data:       req.body,
    });
    auditLog({
      showroomId: req.showroomId,
      userId:     req.user.id,
      action:     'CREATE',
      entity:     'inventory',
      entityId:   item.id,
      newData:    item,
      ipAddress:  req.ip,
      userAgent:  req.headers["user-agent"],
    });
    return response.created(res, item, 'تمت إضافة المنتج بنجاح.');
  } catch (err) {
    return handleServiceError(res, err);
  }
};

// ─────────────────────────────────────────
const bulkCreateInventory = async (req, res) => {
  try {
    const result = await inventoryService.bulkCreateItems({
      showroomId: req.showroomId,
      items:      req.body.items,
    });
    auditLog({
      showroomId: req.showroomId,
      userId:     req.user.id,
      action:     'BULK_CREATE',
      entity:     'inventory',
      newData:    { count: result.count },
      ipAddress:  req.ip,
      userAgent:  req.headers["user-agent"],
    });
    return response.created(res, result, `تمت إضافة ${result.count} منتج بنجاح.`);
  } catch (err) {
    return handleServiceError(res, err);
  }
};

// ─────────────────────────────────────────
const updateInventoryItem = async (req, res) => {
  try {
    const { existing, updated } = await inventoryService.updateItem({
      showroomId: req.showroomId,
      id:         req.params.id,
      data:       req.body,
    });
    auditLog({
      showroomId: req.showroomId,
      userId:     req.user.id,
      action:     'UPDATE',
      entity:     'inventory',
      entityId:   updated.id,
      oldData:    existing,
      newData:    updated,
      ipAddress:  req.ip,
      userAgent:  req.headers["user-agent"],
    });
    return response.success(res, updated, 'تم تحديث المنتج بنجاح.');
  } catch (err) {
    return handleServiceError(res, err);
  }
};

// ─────────────────────────────────────────
const deleteInventoryItem = async (req, res) => {
  try {
    const deleted = await inventoryService.deleteItem({
      showroomId: req.showroomId,
      id:         req.params.id,
    });
    auditLog({
      showroomId: req.showroomId,
      userId:     req.user.id,
      action:     'DELETE',
      entity:     'inventory',
      entityId:   req.params.id,
      oldData:    deleted,
      ipAddress:  req.ip,
      userAgent:  req.headers["user-agent"],
    });
    return response.success(res, null, 'تم أرشفة المنتج بنجاح.');
  } catch (err) {
    return handleServiceError(res, err);
  }
};

// ─────────────────────────────────────────
const reactivateInventoryItem = async (req, res) => {
  try {
    const reactivated = await inventoryService.reactivateItem({
      showroomId: req.showroomId,
      id:         req.params.id,
    });
    auditLog({
      showroomId: req.showroomId,
      userId:     req.user.id,
      action:     'REACTIVATE',
      entity:     'inventory',
      entityId:   reactivated.id,
      newData:    reactivated,
      ipAddress:  req.ip,
      userAgent:  req.headers["user-agent"],
    });
    return response.success(res, reactivated, 'تم إعادة تفعيل المنتج بنجاح.');
  } catch (err) {
    return handleServiceError(res, err);
  }
};

// ─────────────────────────────────────────
const getInventoryStats = async (req, res) => {
  try {
    const stats = await inventoryService.getStats({ showroomId: req.showroomId });
    return response.success(res, stats);
  } catch (err) {
    return handleServiceError(res, err);
  }
};

// ─────────────────────────────────────────
const getLowStockAlerts = async (req, res) => {
  try {
    const items = await inventoryService.getLowStock({
      showroomId: req.showroomId,
      threshold:  req.query.threshold,
    });
    return response.success(res, items);
  } catch (err) {
    return handleServiceError(res, err);
  }
};

module.exports = {
  getAllInventory,
  getInventoryItem,
  createInventoryItem,
  bulkCreateInventory,
  updateInventoryItem,
  deleteInventoryItem,
  reactivateInventoryItem,
  getInventoryStats,
  getLowStockAlerts,
};
