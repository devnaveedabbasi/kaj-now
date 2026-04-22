import { Router } from 'express';
import * as statsController from '../../controllers/provider/stats.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.get('/stats', asyncHandler(statsController.getProviderDashboardStats));
router.get('/earnings', asyncHandler(statsController.getProviderEarningsChart));

export default router;