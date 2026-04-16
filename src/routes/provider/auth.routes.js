import { Router } from 'express';
import * as providerAuth from '../../controllers/provider/providerAuth.controller.js'
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';
import { uploadProviderDocuments, uploadProviderProfilePicture } from '../../middleware/upload.js';

const router = Router();

router.post('/register', asyncHandler(providerAuth.register));
router.post('/verify-email', asyncHandler(providerAuth.verifyEmail));
router.post('/resend-otp', asyncHandler(providerAuth.resendOtp));
router.post('/login', asyncHandler(providerAuth.login));
router.post('/forgot-password', asyncHandler(providerAuth.forgotPassword));
router.post('/verify-reset-otp', asyncHandler(providerAuth.verifyResetOtp));
router.post('/set-new-password', asyncHandler(providerAuth.setNewPassword));

router.put('/complete-profile', authenticateToken, uploadProviderDocuments, asyncHandler(providerAuth.completeProfile));

router.post('/change-password', authenticateToken, requireRole('provider'), asyncHandler(providerAuth.changePassword));
router.get('/me', authenticateToken, requireRole('provider'), asyncHandler(providerAuth.me));

router.patch('/update-profile', authenticateToken, requireRole('provider'), uploadProviderProfilePicture, asyncHandler(providerAuth.updateProfile));
router.post('/verify-email-update',asyncHandler(providerAuth.verifyEmailUpdate));
export default router;
