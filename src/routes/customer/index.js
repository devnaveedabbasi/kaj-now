import { Router } from 'express';
import { authMiddleware as authenticateToken } from '../../middleware/auth.js';

import customerAuthRoute from '../customer/auth.routes.js';
const router = Router();

router.use('/auth', customerAuthRoute);
router.use(authenticateToken); 

export default router;
