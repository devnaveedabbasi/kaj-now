import express from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as assignments from '../../controllers/admin/serviceAssignment.controller.js';

const router = express.Router();

// Service Requests - Admin views
router.get('/requests', asyncHandler(assignments.getAllServiceRequests));
router.get('/requests/:id', asyncHandler(assignments.getServiceRequestById));
router.patch('/requests/:id/approve', asyncHandler(assignments.approveServiceRequest));
router.patch('/requests/:id/reject', asyncHandler(assignments.rejectServiceRequest));

// Service Assignments
router.get('/assignments', asyncHandler(assignments.getAllServiceAssignments));

export default router;
