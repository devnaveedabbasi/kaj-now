import express from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as provider from '../../controllers/provider/service.controller.js';

const router = express.Router();


router.get('/all-categories', asyncHandler(provider.getAllCategories));
router.get('/by-category/:categoryId', asyncHandler(provider.getServicesByCategory));
router.post('/request', asyncHandler(provider.requestService));

router.get('/my', asyncHandler(provider.getMyServices));
router.get('/:serviceId', asyncHandler(provider.getServiceById));
export default router;
