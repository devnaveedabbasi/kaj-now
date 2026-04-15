import { Router } from 'express';
import  { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

import customerAuthRoute from './auth.routes.js';
import customerRoute from './customer.routes.js';
import jobRoutes from './job.routes.js';
const router = Router();

router.use('/auth', customerAuthRoute);
router.use(authenticateToken,requireRole('customer')); 
router.use('/', customerRoute);
router.use('/job', jobRoutes);

export default router;
