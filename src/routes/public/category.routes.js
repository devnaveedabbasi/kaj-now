import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as provider from '../../controllers/provider/provider.controller.js'

const router = Router();

router.get('/all', asyncHandler(provider.getAllCategories));
router.get('/services/:categoryId', asyncHandler(provider.getServicesByCategory));

export default router;
