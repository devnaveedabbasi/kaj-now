import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as serviceController from '../../controllers/customer/service.controller.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

// All routes require authentication
router.use(authenticateToken, requireRole('customer'));

router.get('/all-categories', asyncHandler(serviceController.getAllCategories));

router.get('/search', asyncHandler(serviceController.quickSearch))
router.get('/recommended', asyncHandler(serviceController.getRecommendedServices));
router.get('/top-rated', asyncHandler(serviceController.getTopRatedServices));
router.get('/services-by-cat/:categoryId', asyncHandler(serviceController.getServicesByCategory));
router.get('/', asyncHandler(serviceController.getAllApprovedServices));
router.get('/:serviceId', asyncHandler(serviceController.getApprovedServiceById));

export default router;