import { Router } from 'express';
import {
  getMyJobs,
  updateJobStatus,
  acceptJob,
  getWallet,
  requestWithdrawal,
  getMyWithdrawals,
  getJobDetails,
} from '../../controllers/provider/providerJob.controller.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

router.use(authenticateToken, requireRole('provider'));

// Get detailed job information
router.get('/jobs/:jobId', getJobDetails);

// Get provider's jobs
router.get('/jobs', getMyJobs);

// Get detailed job information
router.get('/jobs/:jobId', getJobDetails);

// Accept job booking from pending state
router.patch('/jobs/:jobId/accept', acceptJob);

// Start job (change from accepted to in_progress)
router.patch('/jobs/:jobId/status', updateJobStatus);

// Wallet routes
router.get('/wallet', getWallet);

// Withdrawal routes
router.post('/withdrawals', requestWithdrawal);
router.get('/withdrawals', getMyWithdrawals);

export default router;