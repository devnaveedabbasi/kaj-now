import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as jobController from '../../controllers/admin/job.controller.js';

const router = Router();

router.get('/', asyncHandler(jobController.getAllJobs));
router.get('/:jobId', asyncHandler(jobController.getJobById));
router.patch('/:jobId/status', asyncHandler(jobController.updateJobStatus));

export default router;
