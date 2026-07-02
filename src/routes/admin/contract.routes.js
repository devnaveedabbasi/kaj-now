import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { getSignedContracts, getContractDetail, approveContract, uploadContractTemplate } from '../../controllers/admin/contract.controller.js';
import { uploadContractPdf } from '../../middleware/upload.js';

const router = Router();

router.post('/upload-template', uploadContractPdf, asyncHandler(uploadContractTemplate));
router.get('/', asyncHandler(getSignedContracts));
router.get('/:providerId', asyncHandler(getContractDetail));
router.post('/:providerId/approve', asyncHandler(approveContract));

export default router;
