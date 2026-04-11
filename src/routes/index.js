import { Router } from 'express';
import { authMiddleware as authenticateToken } from '../middleware/auth.js';

import customerRoutes from './customer/index.js';
import adminRoutes from './admin/index.js';
import providerRoutes from './provider/index.js';
import jobsRoutes from './jobs.route.js';
import publicRoutes from './public/index.js';
const router = Router();

router.use('/customer', customerRoutes);
router.use('/admin', adminRoutes);
router.use('/provider', providerRoutes);
router.use('/public', publicRoutes); // Public routes for categories and services
// Jobs routes - requires authentication
router.use('/jobs', authenticateToken, jobsRoutes);

export default router;
