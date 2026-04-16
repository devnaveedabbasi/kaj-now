import { Router } from 'express';
import * as jobController from '../../controllers/job.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

// ── Provider Job Actions ──────────────────────────────────────────────────────


// ── Withdrawals ───────────────────────────────────────────────────────────────
router.post('/withdrawals/request', asyncHandler(jobController.requestWithdrawal));
router.get('/withdrawals/my', asyncHandler(jobController.getMyWithdrawals));

export default router;