import { Router } from 'express';
import * as adminAuth from '../../controllers/admin/adminAuth.controller.js'
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

router.post('/register', asyncHandler(adminAuth.register));
router.post('/verify-email', asyncHandler(adminAuth.verifyEmail));
router.post('/resend-otp', asyncHandler(adminAuth.resendOtp));
router.post('/login', asyncHandler(adminAuth.login));
router.post('/forgot-password', asyncHandler(adminAuth.forgotPassword));
router.post('/verify-reset-otp', asyncHandler(adminAuth.verifyResetOtp));
router.post('/set-new-password', asyncHandler(adminAuth.setNewPassword));
router.post('/change-password', authenticateToken, requireRole('admin'), asyncHandler(adminAuth.changePassword));

router.get('/me', authenticateToken, requireRole('admin'), asyncHandler(adminAuth.me));
router.post('/logout',authenticateToken,requireRole('admin'),asyncHandler(adminAuth.logout));

export default router;
