import { Router } from 'express';
import { authMiddleware as authenticateToken } from '../../middleware/auth.js';

import customerAuthRoute from '../customer/auth.routes.js';
import customerRoute from '../customer/customer.routes.js';
import jobRoutes from '../job.routes.js';
const router = Router();

router.use('/auth', customerAuthRoute);
router.use(authenticateToken); 
router.use('/', customerRoute);
router.use('/job', jobRoutes);

export default router;
