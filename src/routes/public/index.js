import { Router } from 'express';
import categoryRoute from './category.routes.js';
import Banner from '../../models/admin/banner.model.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { asyncHandler } from '../../utils/asyncHandler.js';

const router = Router();

router.use('/categories', categoryRoute);
router.get('/banner', asyncHandler(async (req, res) => {
  const banners = await Banner.find({ isDeleted: false }).sort({
    createdAt: -1,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, banners, "Banners fetched"));
}));

export default router;
