import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as Provider from '../../controllers/provider/provider.controller.js'

const router = Router();

router.get('/all-categories', asyncHandler(Provider.getAllCategories));
router.get('/subcategories-by-category/:categoryId', asyncHandler(Provider.getSubCategoriesByCategory));

export default router;
