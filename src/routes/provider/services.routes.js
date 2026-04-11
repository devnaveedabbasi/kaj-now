import express from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as jobs from '../../controllers/admin/jobManagement.controller.js';

const router = express.Router();


router.get('/all-categories', asyncHandler(jobs.getAllCategories));
router.get('/by-category/:categoryId', asyncHandler(jobs.getServicesByCategory));
router.post('/request', asyncHandler(jobs.requestService));
router.get('/my-requests', asyncHandler(jobs.getMyServiceRequests));
router.get('/approved', asyncHandler(jobs.getMyAssignedServices));

export default router;
