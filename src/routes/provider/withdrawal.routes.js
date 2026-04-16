import { Router } from 'express';
import * as withdrawalController from '../../controllers/provider/Withdrawal.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();


router.post('/request', asyncHandler(withdrawalController.requestWithdrawal));
router.get('/my', asyncHandler(withdrawalController.getMyWithdrawals));
router.get('/:withdrawalId', asyncHandler(withdrawalController.getWithdrawalById));
router.get('/:withdrawalId/receipt', asyncHandler(withdrawalController.getWithdrawalReceipt));
export default router;