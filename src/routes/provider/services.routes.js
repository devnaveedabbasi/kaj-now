import express from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as provider from '../../controllers/provider/provider.controller.js';

const router = express.Router();


router.get('/all-categories', asyncHandler(provider.getAllCategories));
router.get('/by-category/:categoryId', asyncHandler(provider.getServicesByCategory));
router.post('/request', asyncHandler(provider.requestService));
router.get('/my-requests', asyncHandler(provider.getMyServiceRequests));

router.get('/my', asyncHandler(provider.getMyApprovedServices));

export default router;
