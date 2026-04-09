import express from 'express';
import { 
  createCategory, 
  getAllCategories, 
  getCategoryById, 
  updateCategory, 
  deleteCategory 
} from '../../controllers/admin/category.controller.js';
import { uploadCategoryImage } from '../../middleware/upload.js';

const router = express.Router();


router.post('/', uploadCategoryImage.single('icon'), createCategory);
router.get('/', getAllCategories);
router.get('/:id', getCategoryById);
router.put('/:id', uploadCategoryImage.single('icon'), updateCategory);
router.delete('/:id', deleteCategory);

export default router;