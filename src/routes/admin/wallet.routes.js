import { Router } from 'express';
import * as adminWithdrawalController from '../../controllers/admin/withdrawal.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authenticateUser, authenticateAdmin } from '../../middlewares/auth.middleware.js';

const router = Router();

router.use(authenticateUser, authenticateAdmin);

// Withdrawal management
router.get('/withdrawals', asyncHandler(adminWithdrawalController.getAllWithdrawals));
router.put('/withdrawals/:withdrawalId/approve', asyncHandler(adminWithdrawalController.approveWithdrawal));
router.put('/withdrawals/:withdrawalId/reject', asyncHandler(adminWithdrawalController.rejectWithdrawal));

export default router;