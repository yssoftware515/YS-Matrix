// ============================================================
// YS-MATRIX ERP — Tenant Users Controller (F4 — Staff Management)
//
// Thin HTTP adapter for the OWNER staff surface:
//   • GET   /api/v1/users        — list tenant users (OWNER)
//   • PATCH /api/v1/users/:id    — deactivate/reactivate STAFF (OWNER)
// POST /users is mounted directly on authController.register — the
// canonical staff-creation path (validateProfileAssignment +
// enforceUserLimit + email uniqueness + audit) is NEVER duplicated.
// ============================================================

'use strict';

const usersService = require('../services/users.service');
const response     = require('../utils/response');
const { auditLog } = require('../middleware/audit.middleware');
const { handleServiceError } = require('../utils/errorHandler');

// GET /api/v1/users — tenant users list (OWNER)
const listUsers = async (req, res) => {
  try {
    const data = await usersService.listUsers({
      showroomId: req.showroomId,
      query:      req.query,
    });
    return response.paginated(res, data.users, data.pagination);
  } catch (err) { return handleServiceError(res, err); }
};

// PATCH /api/v1/users/:id — deactivate / reactivate a STAFF member
const toggleUser = async (req, res) => {
  try {
    const result = await usersService.setUserActive({
      showroomId: req.showroomId,
      userId:     req.params.id,
      isActive:   req.body.is_active,
      actorId:    req.user.id,
    });

    if (!result.unchanged) {
      auditLog({
        showroomId: req.showroomId,
        userId:     req.user.id,
        action:     result.user.is_active ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
        entity:     'user',
        entityId:   result.user.id,
        newData:    { name: result.user.name, email: result.user.email },
        ipAddress:  req.ip,
      });
    }

    return response.success(res, result.user, result.user.is_active ? 'تم تفعيل المستخدم.' : 'تم تعطيل المستخدم.');
  } catch (err) { return handleServiceError(res, err); }
};

module.exports = { listUsers, toggleUser };