import { Router } from 'express';
import { authMiddleware as authenticateToken } from '../../middleware/auth.js';

import adminAuthRoutes from './auth.routes.js';
import categoryRoutes from './category.route.js';
import subcategoriesRoutes from './subCategory.route.js';
const router = Router();

router.use('/auth', adminAuthRoutes);
router.use(authenticateToken); 
router.use('/categories', categoryRoutes);
router.use('/subcategories', subcategoriesRoutes);
export default router;
