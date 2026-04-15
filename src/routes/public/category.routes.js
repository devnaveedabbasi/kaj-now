import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as serviceController from '../../controllers/provider/service.controller.js'

const router = Router();

router.get('/all', asyncHandler(serviceController.getAllCategories));
router.get('/services/:categoryId', asyncHandler(serviceController.getServicesByCategory));

export default router;
