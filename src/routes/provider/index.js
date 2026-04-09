import { Router } from 'express';
import { authMiddleware as authenticateToken } from '../../middleware/auth.js';
import providerAuthRoute from './auth.route.js';

const router = Router();

router.use('/auth', providerAuthRoute);
router.use(authenticateToken); 

export default router;
