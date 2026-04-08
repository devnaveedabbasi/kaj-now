import { Router } from 'express';
import {
  getSubcategories,
  getServicesBySubcategory,
  getServiceDetails,
  createJob,
  getMyJobs,
  completeJob,
} from '../../controllers/customer/customerService.controller.js';
import { authMiddleware as authenticateToken } from '../../middleware/auth.js';

const router = Router();

// Get subcategories for a category
router.get('/categories/:categoryId/subcategories', getSubcategories);

// Get services for a subcategory
router.get('/subcategories/:subcategoryId/services', getServicesBySubcategory);

// Get service details
router.get('/services/:serviceId', getServiceDetails);

// Job management routes (require authentication)
router.use(authenticateToken);

// Create job for a service
router.post('/:serviceId/create-job', createJob);

// Get customer's jobs
router.get('/jobs', getMyJobs);

// Mark job as completed
router.patch('/jobs/:jobId/complete', completeJob);

export default router;