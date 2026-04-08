import { Router } from 'express';
import * as customerAuth from '../../controllers/customer/customerAuth.controller.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

router.post('/register', customerAuth.register);
router.post('/verify-email', customerAuth.verifyEmail);
router.post('/resend-otp', customerAuth.resendOtp);
router.post('/login', customerAuth.login);
router.get('/me', authenticateToken, requireRole('customer'), customerAuth.me);

export default router;
