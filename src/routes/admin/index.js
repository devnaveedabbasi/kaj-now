import { Router } from 'express';
import  { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

import adminAuthRoutes from './auth.routes.js';
import categoryRoutes from './category.route.js';
import servicesRoutes from './service.routes.js';
import serviceRequestRoutes from './serviceRequest.route.js';
import adminRoutes from './admin.routes.js'
const router = Router();

router.use('/auth', adminAuthRoutes);
router.use(authenticateToken, requireRole('admin'));
router.use('/', adminRoutes);
router.use('/categories', categoryRoutes);
router.use('/services', servicesRoutes);
router.use('/service-requests', serviceRequestRoutes);
export default router;
