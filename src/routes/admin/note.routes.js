import { Router } from 'express';
import { authMiddleware, authorize } from '../../middleware/auth.js';
import {
  getAllUserNotes,
  getUserNoteById,
  replyToUserNote,
} from '../../controllers/admin/note.controller.js';

const router = Router();

router.use(authMiddleware);

// Admin routes
router.get('/all',        authorize('admin'), getAllUserNotes);
router.get('/:id',        authorize('admin'), getUserNoteById);
router.post('/:id/reply', authorize('admin'), replyToUserNote);

export default router;
