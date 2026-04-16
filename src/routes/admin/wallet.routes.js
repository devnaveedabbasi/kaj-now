import { Router } from 'express';
import * as walletController from '../../controllers/admin/wallet.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();


router.get('/', asyncHandler(walletController.getAdminWallet));
router.get('/transactions', asyncHandler(walletController.getAllTransactions));
router.get('/platform-fees', asyncHandler(walletController.getPlatformFeeStats));
router.get('/withdrawal-stats', asyncHandler(walletController.getWithdrawalStats));
router.get('/earnings-overview', asyncHandler(walletController.getAdminEarningsOverview));
export default router;