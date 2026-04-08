import { Router } from 'express';
import * as sc from '../../controllers/admin/serviceCategory.controller.js';

/** Public catalog — GET /service-categories */
const router = Router();
router.get('/', sc.listActiveCategories);

export default router;
