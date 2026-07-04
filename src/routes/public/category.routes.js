import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as serviceController from '../../controllers/provider/service.controller.js'
import {authMiddleware} from '../../middleware/auth.js';

const router = Router();

router.use(authMiddleware); // Apply auth middleware to all routes in this router
router.get('/all', asyncHandler(serviceController.getAllCategories));
router.get('/services/:categoryId', asyncHandler(serviceController.getServicesByCategory));

export default router;
