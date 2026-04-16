import { Router } from 'express';
import * as jobController from '../../controllers/provider/job.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();
router.get('/my', asyncHandler(jobController.getProviderJobs));
router.get('/:jobId/details', asyncHandler(jobController.getJobDetails));

router.patch('/:jobId/accept', asyncHandler(jobController.acceptJob));
router.patch('/:jobId/reject', asyncHandler(jobController.rejectJob));
router.patch('/:jobId/start', asyncHandler(jobController.startJob));
router.patch('/:jobId/mark-completed', asyncHandler(jobController.markCompletedByProvider));

export default router;
