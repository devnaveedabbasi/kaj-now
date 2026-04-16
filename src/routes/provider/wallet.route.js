import { Router } from 'express';
import * as walletController from '../../controllers/provider/wallet.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.get('/', asyncHandler(walletController.getProviderWallet));
router.get('/transactions', asyncHandler(walletController.getWalletTransactions));


router.get('/bank-details', asyncHandler(walletController.getBankDetails));
router.put('/bank-details', asyncHandler(walletController.updateBankDetails));

export default router;
