import express from 'express';
import { 
  createCategory, 
  getAllCategories, 
  getCategoryById, 
  updateCategory, 
  deleteCategory 
} from '../../controllers/admin/category.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { uploadCategoryImage } from '../../middleware/upload.js';

const router = express.Router();

router.post('/', uploadCategoryImage.single('icon'), asyncHandler(createCategory));
router.get('/', asyncHandler(getAllCategories));
router.get('/:id', asyncHandler(getCategoryById));
router.put('/:id', uploadCategoryImage.single('icon'), asyncHandler(updateCategory));
router.delete('/:id', asyncHandler(deleteCategory));

export default router;