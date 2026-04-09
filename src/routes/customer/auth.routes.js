import { Router } from 'express';
import * as customerAuth from '../../controllers/customer/customerAuth.controller.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

router.post('/register', customerAuth.register);
router.post('/verify-email', customerAuth.verifyEmail);
router.post('/resend-otp', customerAuth.resendOtp);
router.post('/login', customerAuth.login);
router.post('/forgot-password', customerAuth.forgotPassword);
router.post('/verify-reset-otp', customerAuth.verifyResetOtp);
router.post('/set-new-password', customerAuth.setNewPassword);
router.post('/change-password', authenticateToken, requireRole('customer'), customerAuth.changePassword);

router.get('/me', authenticateToken, requireRole('customer'), customerAuth.me);

export default router;
