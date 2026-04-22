import express from 'express';
import  { authMiddleware as authenticateToken, authorize as requireRole } from '../middleware/auth.js';
import * as notification from '../controllers/notification.controller.js';

const router = express.Router();

router.use(authenticateToken);

router.get('/', notification.getUserNotifications);
router.get('/badge', notification.getNotificationBadge);
router.post('/fcm-token', notification.saveFcmToken)
router.post('/test-notification', requireRole('admin'), notification.sendTestNotification);
export default router;