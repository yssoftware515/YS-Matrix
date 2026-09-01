// ============================================================
// YS-MATRIX ERP — Notification Routes (Phase 2 Stage 3)
// ============================================================

'use strict';

const express                = require('express');
const router                 = express.Router();
const notificationController = require('../controllers/notification.controller');
const { authenticate }       = require('../middleware/auth.middleware');
const { checkLicense }       = require('../middleware/license.middleware');
const { tenantGuard }        = require('../middleware/tenant.middleware');
const { ownerOnly }          = require('../middleware/roles.middleware');

// All notification routes require auth + license + tenant
router.use(authenticate, checkLicense, tenantGuard);

// GET  /api/v1/notifications          — paginated list
router.get('/',        notificationController.getNotifications);

// GET  /api/v1/notifications/unread   — badge count only
router.get('/unread',  notificationController.getUnreadCount);

// PATCH /api/v1/notifications/read-all — mark all as read
router.patch('/read-all', notificationController.markAllAsRead);

// PATCH /api/v1/notifications/:id/read — mark one as read
router.patch('/:id/read', notificationController.markAsRead);

// DELETE /api/v1/notifications/old — cleanup (owner only)
router.delete('/old', ownerOnly, notificationController.deleteOld);

module.exports = router;
