import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
    getSignedContracts,
    getContractDetail,
    approveContract,
    rejectContract,
    uploadContractTemplate,
    getContractTemplateStatus,
    deleteContractTemplate
} from '../../controllers/admin/contract.controller.js';
import { uploadContractPdf } from '../../middleware/upload.js';

const router = Router();

router.post('/upload-template', uploadContractPdf, asyncHandler(uploadContractTemplate));
router.get('/template', asyncHandler(getContractTemplateStatus));
router.delete('/template', asyncHandler(deleteContractTemplate));
router.get('/', asyncHandler(getSignedContracts));
router.get('/:providerId', asyncHandler(getContractDetail));
router.post('/:providerId/approve', asyncHandler(approveContract));
router.post('/:providerId/reject', asyncHandler(rejectContract));

export default router;
