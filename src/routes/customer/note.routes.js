import { Router } from 'express';
import { authMiddleware, authorize } from '../../middleware/auth.js';
import {
  createUserNote,
  getMyUserNotes,
  getMyUserNoteById,
} from '../../controllers/customer/note.controller.js';

const router = Router();

router.use(authMiddleware);
router.use(authorize('customer', 'provider'));

router.post('/', createUserNote);
router.get('/', getMyUserNotes);
router.get('/:id', getMyUserNoteById);

export default router;
