import { Router } from 'express';
import { authMiddleware as authenticateToken } from '../../middleware/auth.js';

import customerAuthRoute from '../customer/auth.routes.js';
import customerRoute from '../customer/customer.routes.js';
const router = Router();

router.use('/auth', customerAuthRoute);
router.use('/', customerRoute);
router.use(authenticateToken); 

export default router;
