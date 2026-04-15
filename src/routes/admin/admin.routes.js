import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as service from '../../controllers/provider/service.controller.js'

const router = Router();

router.get('/all-categories', asyncHandler(service.getAllCategories));
router.get('/by-category/:categoryId', asyncHandler(service.getServicesByCategory));

export default router;
