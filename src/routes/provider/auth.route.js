import { Router } from 'express';
import * as providerAuth from '../../controllers/provider/providerAuth.controller.js'
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';
import { uploadProviderDocuments } from '../../middleware/upload.js';

const router = Router();

router.post('/register', providerAuth.register);
router.post('/verify-email', providerAuth.verifyEmail);
router.post('/resend-otp', providerAuth.resendOtp);
router.post('/login', providerAuth.login);
router.post('/forgot-password', providerAuth.forgotPassword);
router.post('/verify-reset-otp', providerAuth.verifyResetOtp);
router.post('/set-new-password', providerAuth.setNewPassword);

router.put('/complete-profile', authenticateToken, uploadProviderDocuments, providerAuth.completeProfile);


router.post('/change-password', authenticateToken, requireRole('provider'), providerAuth.changePassword);
router.get('/me', authenticateToken, requireRole('provider'), providerAuth.me);




export default router;
