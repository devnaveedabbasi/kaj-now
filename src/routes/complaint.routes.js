import { Router } from 'express';
import { authMiddleware, authorize } from '../middleware/auth.js';
import {
  submitComplaint,
  getMyComplaints,
  getAllComplaints,
  getComplaintById,
  replyToComplaint,
  updateComplaintStatus,
} from '../controllers/complaint.controller.js';

const router = Router();

router.use(authMiddleware);

// ── Customer routes ───────────────────────────────────────────
// POST /api/complaint          — complaint submit karo
router.post('/', authorize('customer', 'provider'), submitComplaint);

// GET  /api/complaint          — apni complaints dekho
router.get('/', authorize('customer', 'provider'), getMyComplaints);

// ── Admin routes ──────────────────────────────────────────────
// GET  /api/complaint/all               — sab complaints
// GET  /api/complaint/all?status=pending
// GET  /api/complaint/all?type=technical_issue
router.get('/all', authorize('admin'), getAllComplaints);

// GET  /api/complaint/:id               — single complaint detail
router.get('/:id', authorize('admin'), getComplaintById);

// POST /api/complaint/:id/reply         — reply + email
router.post('/:id/reply', authorize('admin'), replyToComplaint);

// PATCH /api/complaint/:id/status       — status update
router.patch('/:id/status', authorize('admin'), updateComplaintStatus);

export default router;
