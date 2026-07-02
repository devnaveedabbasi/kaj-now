import express from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as provider from '../../controllers/provider/service.controller.js';
import { uploadServiceRequestImages } from '../../middleware/upload.js';

const router = express.Router();


router.get('/my', asyncHandler(provider.getMyServices));
router.get('/all-categories', asyncHandler(provider.getAllCategories));
router.get('/by-category/:categoryId', asyncHandler(provider.getServicesByCategory));
// Multer here only kicks in for multipart requests (the UK flow, which may
// include images) — BD's existing JSON requests pass through untouched.
router.post('/request', uploadServiceRequestImages, asyncHandler(provider.requestService));
router.get('/:serviceId', asyncHandler(provider.getServiceById));
router.delete('/:serviceId', asyncHandler(provider.deleteService));
export default router;
