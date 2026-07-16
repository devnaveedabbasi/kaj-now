import { Router } from 'express';
import  { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

import adminAuthRoutes from './auth.routes.js';
import categoryRoutes from './category.route.js';
import servicesRoutes from './service.routes.js';
import serviceRequestRoutes from './serviceRequest.route.js';
import adminRoutes from './admin.routes.js'
import walletRoutes from './wallet.routes.js';
import withdrawalsRoutes from './withdrawal.routes.js';
import jobRoutes from './job.routes.js';
import bannerRoutes from './banner.routes.js';
import paymentTrackingRoutes from '../payment.tracking.routes.js';
import featuredServiceRoutes from './featuredService.routes.js';
import contractRoutes from './contract.routes.js';
import notesRoutes from './note.routes.js';
const router = Router();

router.use('/auth', adminAuthRoutes);
router.use(authenticateToken, requireRole('admin'));
router.use('/', adminRoutes);
router.use('/categories', categoryRoutes);
router.use('/services', servicesRoutes);
router.use('/service-requests', serviceRequestRoutes);
router.use('/wallet', walletRoutes);
router.use('/withdrawals', withdrawalsRoutes);
router.use('/jobs', jobRoutes);
router.use('/banners', bannerRoutes);
router.use('/payment-tracking', paymentTrackingRoutes);
router.use('/featured-services', featuredServiceRoutes);
router.use('/contracts', contractRoutes);
router.use('/notes', notesRoutes);
export default router;
