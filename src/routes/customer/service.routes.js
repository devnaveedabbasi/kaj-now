import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as Customer from '../../controllers/customer/service.controller.js'
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

// Browse services (public)
router.get('/', asyncHandler(Customer.getAllApprovedServices));
router.get('/all-categories', asyncHandler(Customer.getAllCategories));
router.get('/services-by-cat/:categoryId', asyncHandler(Customer.getServicesByCategory));
router.get('/:serviceId', asyncHandler(Customer.getApprovedServiceById));
export default router;
