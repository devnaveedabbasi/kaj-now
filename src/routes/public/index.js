import { Router } from 'express';
import categoryRoute from './category.routes.js';

const router = Router();

router.use('/categories', categoryRoute);

export default router;
