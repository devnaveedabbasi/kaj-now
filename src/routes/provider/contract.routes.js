import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { getMyContract, submitSignedContract } from '../../controllers/provider/contract.controller.js';

const router = Router();

router.get('/', asyncHandler(getMyContract));
router.post('/sign', asyncHandler(submitSignedContract));

export default router;
