import { Router } from 'express';
import {
  getAllWithdrawals,
  processWithdrawal,
  completeWithdrawal,
  rejectWithdrawal,
} from '../../controllers/admin/withdrawal.controller.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

router.use(authenticateToken, requireRole('admin'));

// Get all withdrawal requests
router.get('/withdrawals', getAllWithdrawals);

// Process withdrawal (mark as processing)
router.patch('/withdrawals/:withdrawalId/process', processWithdrawal);

// Complete withdrawal
router.patch('/withdrawals/:withdrawalId/complete', completeWithdrawal);

// Reject withdrawal
router.patch('/withdrawals/:withdrawalId/reject', rejectWithdrawal);

export default router;