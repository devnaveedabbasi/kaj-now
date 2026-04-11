import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as provider from '../../controllers/provider/provider.controller.js'

const router = Router();

router.get('/all-categories', asyncHandler(provider.getAllCategories));
router.get('/subcat-by-cat/:categoryId', asyncHandler(provider.getSubCategoriesByCategory));

export default router;
