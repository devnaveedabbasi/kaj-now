import { Router } from 'express';
import * as paymentController from '../../controllers/provider/paymentController.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();


router.get('/', asyncHandler(paymentController.paymentHistory));
router.post('/pay-to-admin', asyncHandler(paymentController.payToAdmin));

export default router;