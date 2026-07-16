import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  getAllComplaints,
  getComplaintById,
  replyToComplaint,
  updateComplaintStatus,
} from '../../controllers/admin/complaint.controller.js';

const router = Router();

router.get('/', asyncHandler(getAllComplaints));
router.get('/:id', asyncHandler(getComplaintById));
router.post('/:id/reply', asyncHandler(replyToComplaint));
router.patch('/:id/status', asyncHandler(updateComplaintStatus));

export default router;
