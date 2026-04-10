import express from 'express';
import { 
  createSubCategory, 
  getAllSubCategories, 
  getSubCategoryById, 
  updateSubCategory, 
  toggleSubCategoryActive,
  softDeleteSubCategory,
  hardDeleteSubCategory,
  getSubCategoriesByCategory
} from '../../controllers/admin/subCategory.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { uploadSubCategoryImage } from '../../middleware/upload.js';

const router = express.Router();

router.post('/', uploadSubCategoryImage.single('icon'), asyncHandler(createSubCategory));
router.get('/', asyncHandler(getAllSubCategories));
router.get('/by-category/:categoryId', asyncHandler(getSubCategoriesByCategory));
router.get('/:id', asyncHandler(getSubCategoryById));
router.put('/:id', uploadSubCategoryImage.single('icon'), asyncHandler(updateSubCategory));

// New routes for toggle and delete
router.patch('/:id/toggle', asyncHandler(toggleSubCategoryActive));
router.delete('/:id/soft', asyncHandler(softDeleteSubCategory));
router.delete('/:id/hard', asyncHandler(hardDeleteSubCategory));

export default router;