import { Router } from 'express';

import customerRoutes from './customer/index.js';

import adminRoutes from './admin/index.js';

import providerRoutes from './provider/index.js';

const router = Router();

router.use('/customer', customerRoutes);
router.use('/admin', adminRoutes);
router.use('/provider', providerRoutes);


export default router;
