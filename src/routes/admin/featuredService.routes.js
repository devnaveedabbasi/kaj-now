import express from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { 
    getFeaturedServiceRequests, 
    togglePopularRequest, 
    toggleRecommendedRequest,
    getAllEligibleRequests
} from '../../controllers/admin/featuredService.controller.js';

const router = express.Router();

router.get('/', asyncHandler(getFeaturedServiceRequests));
router.get('/eligible', asyncHandler(getAllEligibleRequests));
router.post('/popular/:id', asyncHandler(togglePopularRequest));
router.post('/recommended/:id', asyncHandler(toggleRecommendedRequest));

export default router;
