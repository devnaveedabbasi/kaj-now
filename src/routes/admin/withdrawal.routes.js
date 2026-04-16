import { Router } from 'express';
import * as jobController from '../../controllers/job.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const adminRouter = Router();

adminRouter.use(authenticateToken, requireRole('admin'));

adminRouter.get('/withdrawals', asyncHandler(jobController.getAllWithdrawals));
adminRouter.patch('/withdrawals/:withdrawalId/process', asyncHandler(jobController.processWithdrawal));
adminRouter.patch('/withdrawals/:withdrawalId/reject', asyncHandler(jobController.rejectWithdrawal));

export { adminRouter };