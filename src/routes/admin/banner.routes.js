import { Router } from 'express';
import {
  createBanner,
  getBanners,
  updateBanner,
  deleteBanner,
  toggleBannerStatus,
} from '../../controllers/admin/banner.controller.js';
import { uploadBanner } from '../../middleware/upload.js';

const router = Router();

router.post('/', uploadBanner, createBanner);

router.get('/', getBanners);

router.put('/:id', uploadBanner, updateBanner);

router.delete('/:id', deleteBanner);

router.patch('/:id/toggle', toggleBannerStatus);

export default router;
