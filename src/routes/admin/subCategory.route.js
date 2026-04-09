import express from 'express';
import { 
  createSubCategory, 
  getAllSubCategories, 
  getSubCategoryById, 
  updateSubCategory, 
  deleteSubCategory,
  getSubCategoriesByCategory
} from '../../controllers/admin/subCategory.controller.js';
import { uploadSubCategoryImage } from '../../middleware/upload.js';

const router = express.Router();


router.post('/', uploadSubCategoryImage.single('icon'), createSubCategory);
router.get('/', getAllSubCategories);
router.get('/by-category/:categoryId', getSubCategoriesByCategory);
router.get('/:id', getSubCategoryById);
router.put('/:id', uploadSubCategoryImage.single('icon'), updateSubCategory);
router.delete('/:id', deleteSubCategory);

export default router;