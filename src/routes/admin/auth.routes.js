import { Router } from 'express';
import * as adminAuth from '../../controllers/admin/adminAuth.controller.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

router.post('/register', adminAuth.register);
router.post('/verify-email', adminAuth.verifyEmail);
router.post('/resend-otp', adminAuth.resendOtp);
router.post('/login', adminAuth.login);
router.get('/me', authenticateToken, requireRole('admin'), adminAuth.me);

export default router;
