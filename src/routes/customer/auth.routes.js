import { Router } from 'express';
import * as customerAuth from '../../controllers/customer/customerAuth.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

router.post('/register', asyncHandler(customerAuth.register));
router.post('/verify-email', asyncHandler(customerAuth.verifyEmail));
router.post('/resend-otp', asyncHandler(customerAuth.resendOtp));
router.post('/login', asyncHandler(customerAuth.login));
router.post('/forgot-password', asyncHandler(customerAuth.forgotPassword));
router.post('/verify-reset-otp', asyncHandler(customerAuth.verifyResetOtp));
router.post('/set-new-password', asyncHandler(customerAuth.setNewPassword));
router.post('/change-password', authenticateToken, requireRole('customer'), asyncHandler(customerAuth.changePassword));

router.get('/me', authenticateToken, requireRole('customer'), asyncHandler(customerAuth.me));

export default router;
