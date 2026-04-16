import { Router } from 'express';
import * as jobController from '../../controllers/customer/job.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
const router = Router();


router.post('/book', asyncHandler(jobController.bookJob));
router.get('/my', asyncHandler(jobController.getCustomerJobs));
router.get('/:jobId/details', asyncHandler(jobController.getJobDetails));

// Job completion actions
router.patch('/:jobId/confirm-completion', asyncHandler(jobController.confirmCompletionByCustomer));
router.patch('/:jobId/dispute', asyncHandler(jobController.rejectCompletion));

export  default router;