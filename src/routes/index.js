import { Router } from 'express';
import { authMiddleware as authenticateToken } from '../middleware/auth.js';

import customerRoutes from './customer/index.js';
import adminRoutes from './admin/index.js';
import providerRoutes from './provider/index.js';
import publicRoutes from './public/index.js';
const router = Router();

router.use('/customer', customerRoutes);
router.use('/admin', adminRoutes);
router.use('/provider', providerRoutes);
router.use('/public', publicRoutes);

export default router;
