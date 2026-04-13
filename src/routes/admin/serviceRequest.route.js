import express from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as serviceRequest from '../../controllers/admin/serviceRequest.controller.js';
const router = express.Router();

// Get all approved service assigns
router.get('/all-assigns', asyncHandler(serviceRequest.getAllServiceAssignments));


// Service Requests - Admin views
router.get('/', asyncHandler(serviceRequest.getAllServiceRequests));
router.get('/:id', asyncHandler(serviceRequest.getServiceRequestById));
router.patch('/:id/approve', asyncHandler(serviceRequest.approveServiceRequest));
router.patch('/:id/reject', asyncHandler(serviceRequest.rejectServiceRequest));



export default router;
