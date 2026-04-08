import { Router } from 'express';
import { authMiddleware as authenticateToken } from '../middleware/auth.js';
import { attachGenericSingleUpload } from '../middleware/upload.js';
import * as uploadController from '../controllers/upload.controller.js';

const router = Router();

router.post('/', authenticateToken, attachGenericSingleUpload, uploadController.uploadSingleFile);

export default router;
