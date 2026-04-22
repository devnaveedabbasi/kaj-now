import express from 'express';
import  { authMiddleware as authenticateToken, authorize as requireRole } from '../middleware/auth.js';
import * as notification from '../controllers/notification.controller.js';

const router = express.Router();

router.use(authenticateToken, requireRole(['customer', 'provider', 'admin']));

router.get('/', notification.getUserNotifications);
router.get('/badge', notification.getNotificationBadge);
router.put('/:notificationId/read', notification.markNotificationAsRead);
router.put('/read-all', notification.markAllNotificationsAsRead);
router.delete('/:notificationId', notification.deleteNotification);

export default router;