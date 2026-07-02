import { Router } from 'express';
import { authMiddleware, authorize } from '../middleware/auth.js';
import {
  submitNote,
  getMyNotes,
  getAllNotes,
  getNoteById,
  replyToNote,
} from '../controllers/note.controller.js';

const router = Router();

router.use(authMiddleware);

// Customer routes
router.post('/',    authorize('customer'), submitNote);
router.get('/',     authorize('customer'), getMyNotes);

// Admin routes
router.get('/all',        authorize('admin'), getAllNotes);
router.get('/:id',        authorize('admin'), getNoteById);
router.post('/:id/reply', authorize('admin'), replyToNote);

export default router;
