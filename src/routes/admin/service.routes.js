import express from 'express';
import { 
  createService, 
  getAllServices, 
  getServiceById, 
  updateService,  
  toggleServiceActive,
  softDeleteService,
  hardDeleteService,
  getServicesByCategory
} from '../../controllers/admin/service.controller.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { uploadServiceImage } from '../../middleware/upload.js';

const router = express.Router();

router.post('/', uploadServiceImage.single('icon'), asyncHandler(createService));
router.get('/', asyncHandler(getAllServices));
router.get('/by-category/:categoryId', asyncHandler(getServicesByCategory));
router.get('/:id', asyncHandler(getServiceById));
router.put('/:id', uploadServiceImage.single('icon'), asyncHandler(updateService));

// New routes for toggle and delete
router.patch('/:id/toggle', asyncHandler(toggleServiceActive));
router.delete('/:id/soft', asyncHandler(softDeleteService));
router.delete('/:id/hard', asyncHandler(hardDeleteService));

export default router;