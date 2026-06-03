import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as jobController from '../../controllers/admin/job.controller.js';

const router = Router();

router.get('/', asyncHandler(jobController.getAllJobs));
router.get('/available-providers/:jobId', asyncHandler(jobController.getAvailableProviders));
router.get('/:jobId', asyncHandler(jobController.getJobById));
router.patch('/:jobId/status', asyncHandler(jobController.updateJobStatus));
router.patch('/:jobId/cancel', asyncHandler(jobController.cancelJob));
router.patch('/:jobId/complete', asyncHandler(jobController.markJobAsCompleted));
router.post('/:jobId/assign-provider', asyncHandler(jobController.assignProvider));
    
export default router;
