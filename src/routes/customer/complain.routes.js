import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
    submitComplaint,
    getMyComplaints,
    getComplaintTypes
} from '../../controllers/customer/complain.controller.js';

const router = Router();

router.get('/types', asyncHandler(getComplaintTypes));
router.post('/', asyncHandler(submitComplaint));
router.get('/', asyncHandler(getMyComplaints));

export default router;
