import { Router } from 'express';
import  { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';
import providerAuthRoute from './auth.routes.js';
import providerRoute from './provider.routes.js';

const router = Router();

router.use('/auth', providerAuthRoute);
router.use(authenticateToken, requireRole('provider'));
router.use('/', providerRoute);

export default router;
