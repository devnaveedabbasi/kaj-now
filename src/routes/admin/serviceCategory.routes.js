import { Router } from 'express';
import * as sc from '../../controllers/admin/serviceCategory.controller.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

export const serviceCategoryAdminRouter = Router();
serviceCategoryAdminRouter.use(authenticateToken, requireRole('admin'));
serviceCategoryAdminRouter.get('/', sc.adminListCategories);
serviceCategoryAdminRouter.post('/', sc.adminCreateCategory);
serviceCategoryAdminRouter.patch('/:id', sc.adminUpdateCategory);
serviceCategoryAdminRouter.post('/:categoryId/subcategories', sc.adminCreateSubcategory);

export const serviceSubcategoryAdminRouter = Router();
serviceSubcategoryAdminRouter.use(authenticateToken, requireRole('admin'));
serviceSubcategoryAdminRouter.patch('/:id', sc.adminUpdateSubcategory);
