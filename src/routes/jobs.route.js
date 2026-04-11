import express from 'express';
import { asyncHandler } from '../utils/asyncHandler.js';
import * as jobs from '../controllers/admin/jobManagement.controller.js';

const router = express.Router();

// Provider - Service Requests & Browsing
router.post('/services/request', asyncHandler(jobs.requestService));
router.get('/services/my-requests', asyncHandler(jobs.getMyServiceRequests));
router.get('/services/assigned', asyncHandler(jobs.getMyAssignedServices));

// Customer - Service Browsing
router.get('/services/category/:categoryId', asyncHandler(jobs.getServicesForCategory));
router.get('/services/:serviceId/providers', asyncHandler(jobs.getProvidersForService));

// Job Management
router.post('/jobs/apply', asyncHandler(jobs.applyForService));
router.get('/jobs/my-jobs', asyncHandler(jobs.getMyJobs));
router.get('/jobs/provider-jobs', asyncHandler(jobs.getProvidersJobs));
router.get('/jobs/:jobId/details', asyncHandler(jobs.getJobDetails));

// Job Actions
router.patch('/jobs/:jobId/accept', asyncHandler(jobs.acceptJob));
router.patch('/jobs/:jobId/complete', asyncHandler(jobs.completeJob));
router.patch('/jobs/:jobId/cancel', asyncHandler(jobs.cancelJob));

export default router;
