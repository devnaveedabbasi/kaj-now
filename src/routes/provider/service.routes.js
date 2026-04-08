import { Router } from 'express';
import * as providerService from '../../controllers/provider/providerService.controller.js';
import { authMiddleware as authenticateToken, authorize as requireRole } from '../../middleware/auth.js';

const router = Router();

router.use(authenticateToken, requireRole('provider'));

router.post('/', providerService.createService);
router.get('/', providerService.listMyServices);
router.get('/:id', providerService.getService);
router.patch('/:id', providerService.updateService);
router.delete('/:id', providerService.deleteService);

export default router;
