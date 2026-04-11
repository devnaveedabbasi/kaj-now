import { Router } from 'express';
import  { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

import adminAuthRoutes from './auth.routes.js';
import categoryRoutes from './category.route.js';
import subcategoriesRoutes from './subCategory.route.js';
import adminRoutes from './admin.routes.js'
const router = Router();

router.use('/auth', adminAuthRoutes);
router.use(authenticateToken, requireRole('admin'));
router.use('/', adminRoutes);
router.use('/categories', categoryRoutes);
router.use('/subcategories', subcategoriesRoutes);
export default router;
