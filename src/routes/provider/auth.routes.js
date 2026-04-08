import { Router } from 'express';
import * as providerAuth from '../../controllers/provider/providerAuth.controller.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';
import { attachProviderDocumentsUpload } from '../../middleware/upload.js';

const router = Router();

router.post('/register', providerAuth.register);
router.post('/verify-email', providerAuth.verifyEmail);
router.post('/resend-otp', providerAuth.resendOtp);
router.post('/login', providerAuth.login);
router.get('/me', authenticateToken, requireRole('provider'), providerAuth.me);
router.patch(
  '/profile',
  authenticateToken,
  requireRole('provider'),
  attachProviderDocumentsUpload,
  providerAuth.updateProfile
);

export default router;
