import express from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import {
    createUkPriceRange,
    getUkPriceRange,
    updateUkPriceRange,
    deleteUkPriceRange,
} from '../../controllers/admin/ukPriceRange.controller.js';

const router = express.Router();

router.post('/', asyncHandler(createUkPriceRange));
router.get('/', asyncHandler(getUkPriceRange));
router.put('/', asyncHandler(updateUkPriceRange));
router.delete('/', asyncHandler(deleteUkPriceRange));

export default router;
