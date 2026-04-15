import { Router } from 'express';
import * as jobController from '../../controllers/job.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

router.post('/book',  asyncHandler(jobController.bookJob));

router.get('/my', asyncHandler(jobController.getCustomerJobs));

router.patch('/:jobId/confirm-completion', asyncHandler(jobController.confirmCompletionByCustomer));

router.patch('/:jobId/reject-completion',asyncHandler(jobController.rejectCompletion));

router.get('/:jobId/details',  asyncHandler(jobController.getJobDetails));

export default router;
