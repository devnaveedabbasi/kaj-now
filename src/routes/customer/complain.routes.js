import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
    submitComplaint,
    getMyComplaints
} from '../../controllers/customer/complain.controller.js';

const router = Router();

router.post('/', asyncHandler(submitComplaint));
router.get('/', asyncHandler(getMyComplaints));

export default router;
