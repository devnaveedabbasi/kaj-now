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
import { uploadServiceFiles } from '../../middleware/upload.js';

const router = express.Router();

router.post('/', 
  uploadServiceFiles.fields([
    { name: 'icon', maxCount: 1 },
    { name: 'image', maxCount: 1 }
  ]), 
  asyncHandler(createService)
);
router.get('/', asyncHandler(getAllServices));
router.get('/by-category/:categoryId', asyncHandler(getServicesByCategory));
router.get('/:id', asyncHandler(getServiceById));
router.put('/:id', uploadServiceFiles.fields([
    { name: 'icon', maxCount: 1 },
    { name: 'image', maxCount: 1 }
]), asyncHandler(updateService));

// New routes for toggle and delete
router.patch('/:id/toggle', asyncHandler(toggleServiceActive));
router.delete('/:id/soft', asyncHandler(softDeleteService));
router.delete('/:id/hard', asyncHandler(hardDeleteService));

export default router;