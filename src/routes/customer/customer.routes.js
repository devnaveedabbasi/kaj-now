import { Router } from 'express';
import { asyncHandler } from '../../utils/asyncHandler.js';
import * as Customer from '../../controllers/customer/customer.controller.js'

const router = Router();

router.get('/all-categories', asyncHandler(Customer.getAllCategories));
router.get('/services-by-cat/:categoryId', asyncHandler(Customer.getServicesByCategory));

export default router;
