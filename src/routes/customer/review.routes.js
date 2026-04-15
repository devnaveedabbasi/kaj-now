import express from 'express';
 import * as review from '../../controllers/customer/review.controller.js';
 import { asyncHandler } from '../../utils/asyncHandler.js';

const router = express.Router();

// Review CRUD operations
router.post('/:serviceId', asyncHandler(review.createReview));          
router.put('/:reviewId', asyncHandler(review.updateReview));                     
// Get reviews
router.get('/:serviceId', asyncHandler(review.getServiceReviews));     


export default router;