import { Router } from 'express';
import categoryRoute from './category.routes.js';
import Banner from '../../models/admin/banner.model.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { authMiddleware as authenticateToken } from '../../middleware/auth.js';
const router = Router();

router.use('/categories', categoryRoute);
router.get('/banner', authenticateToken, asyncHandler(async (req, res) => {
  const userRegion = req.user?.region; // Get the region of the logged-in provider
  const query = { isActive: true, isDeleted: false };
  if (userRegion && ['UK', 'BD'].includes(userRegion)) {
    query.region = userRegion;
  }

  const banners = await Banner.find(query).sort({
    createdAt: -1,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, banners, "Banners fetched"));
}));

export default router;
