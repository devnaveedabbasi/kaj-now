import { Router } from 'express';
import * as walletController from '../../controllers/wallet.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.get('/me', asyncHandler(walletController.getMyWallet));

router.get('/transactions', asyncHandler(walletController.getWalletTransactionHistory));

// Get earnings summary (Provider)
router.get('/earnings-summary',  asyncHandler(walletController.getEarningsSummary));


export default router;
