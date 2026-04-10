import express from 'express';
import { 
  createCategory, 
  getAllCategories, 
  getCategoryById, 
  updateCategory, 
  toggleCategoryActive,
  softDeleteCategory,
  hardDeleteCategory,
} from '../../controllers/admin/category.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { uploadCategoryImage } from '../../middleware/upload.js';

const router = express.Router();

router.post('/', uploadCategoryImage.single('icon'), asyncHandler(createCategory));
router.get('/', asyncHandler(getAllCategories));
router.get('/:id', asyncHandler(getCategoryById));
router.put('/:id', uploadCategoryImage.single('icon'), asyncHandler(updateCategory));

router.patch('/:id/toggle', asyncHandler(toggleCategoryActive));
router.delete('/:id/soft', asyncHandler(softDeleteCategory));
router.delete('/:id/hard', asyncHandler(hardDeleteCategory));

export default router;