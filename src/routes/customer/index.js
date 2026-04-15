import { Router } from 'express';
import  { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

import customerAuthRoute from './auth.routes.js';
import serviceRoute from './service.routes.js';
import jobRoutes from './job.routes.js';
import reviewsRoutes from './review.routes.js';
const router = Router();

router.use('/auth', customerAuthRoute);
router.use(authenticateToken,requireRole('customer')); 
router.use('/', serviceRoute);
router.use('/job', jobRoutes);
router.use('/job/review', reviewsRoutes);

export default router;
