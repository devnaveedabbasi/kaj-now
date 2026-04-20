import { Router } from 'express';
import * as jobController from '../../controllers/provider/job.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();


router.get('/', asyncHandler(jobController.getProviderJobs));
router.get('/:jobId', asyncHandler(jobController.getJobDetails));
router.patch('/:jobId/accept', asyncHandler(jobController.acceptJob));
router.patch('/:jobId/reject', asyncHandler(jobController.rejectJob));
router.patch('/:jobId/start', asyncHandler(jobController.startJob));
router.patch('/:jobId/complete', asyncHandler(jobController.markCompletedByProvider));

export default router;