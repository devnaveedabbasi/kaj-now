import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
  getAllComplaints,
  getComplaintById,
  replyToComplaint,
  updateComplaintStatus,
  getComplaintTypes,
  addComplaintType,
  deleteComplaintType,
  editComplaintType,
  reorderComplaintTypes,
} from '../../controllers/admin/complaint.controller.js';

const router = Router();

router.get('/types', asyncHandler(getComplaintTypes));
router.post('/types', asyncHandler(addComplaintType));
router.put('/types/reorder', asyncHandler(reorderComplaintTypes));
router.put('/types/:id', asyncHandler(editComplaintType));
router.delete('/types/:id', asyncHandler(deleteComplaintType));

router.get('/', asyncHandler(getAllComplaints));
router.get('/:id', asyncHandler(getComplaintById));
router.post('/:id/reply', asyncHandler(replyToComplaint));
router.patch('/:id/status', asyncHandler(updateComplaintStatus));

export default router;
