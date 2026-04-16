import { Router } from 'express';
import * as withdrawalController from '../../controllers/admin/withdrawals.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { uploadWithdrawalReceipt } from '../../middleware/upload.js';

const router = Router();


router.get('/', asyncHandler(withdrawalController.getAllWithdrawals));
router.patch('/:withdrawalId/approve', uploadWithdrawalReceipt, asyncHandler(withdrawalController.approveWithdrawal));
router.patch('/:withdrawalId/reject', asyncHandler(withdrawalController.rejectWithdrawal));
router.get('/:withdrawalId/receipt', asyncHandler(withdrawalController.getWithdrawalReceipt));

export default router;