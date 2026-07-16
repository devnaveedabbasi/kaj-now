import { Router } from 'express';
import { authMiddleware as authenticateToken } from '../middleware/auth.js';

import customerRoutes from './customer/index.js';
import adminRoutes from './admin/index.js';
import providerRoutes from './provider/index.js';
import publicRoutes from './public/index.js';
import paymentRoutes from './payment.routes.js';
import notificationRoutes from './notification.routes.js';
import chatRoutes from './chat.routes.js';
import supportRoutes from './support.routes.js';
import noteRoutes from './admin/note.routes.js';

const router = Router();

router.use('/customer', customerRoutes);
router.use('/admin', adminRoutes);
router.use('/provider', providerRoutes);
router.use('/public', publicRoutes);
router.use('/payments', paymentRoutes);
router.use('/notifications', notificationRoutes);
router.use('/chat', chatRoutes);
router.use('/support', supportRoutes);
export default router;
