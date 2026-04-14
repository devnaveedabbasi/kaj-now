import { Router } from 'express';
import  { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';
import providerAuthRoute from './auth.routes.js';
import servicesRoute from './services.routes.js';
import jobRoutes from './job.routes.js';
import walletRoutes from './wallet.route.js';
const router = Router();

router.use('/auth', providerAuthRoute);
router.use(authenticateToken, requireRole('provider'));
router.use('/services', servicesRoute);
router.use('/job', jobRoutes);
router.use('/wallet', walletRoutes);
export default router;
