import { Router } from 'express';
import { getDashboard } from '../../controllers/provider/providerDashboard.controller.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

router.use(authenticateToken, requireRole('provider'));
router.get('/', getDashboard);

export default router;
