import { Router } from 'express';
import { authMiddleware, authorize } from '../middleware/auth.js';
import {
  getMySupportHistory,
  deleteMySupportChat,
  getMySupportUnread,
  getAllConversations,
  getConversationHistory,
  deleteConversation,
  getAdminUnread,
} from '../controllers/support.controller.js';

const router = Router();

router.use(authMiddleware);

// ── Customer & Provider routes ────────────────────────────────
// GET  /api/support/history         — apni support chat history
router.get('/history', authorize('customer', 'provider'), getMySupportHistory);

// DELETE /api/support/history       — apni side se delete
router.delete('/history', authorize('customer', 'provider'), deleteMySupportChat);

// GET  /api/support/unread          — apna unread count
router.get('/unread', authorize('customer', 'provider'), getMySupportUnread);

// ── Admin routes ──────────────────────────────────────────────
// GET  /api/support/conversations          — sab users ki list
// GET  /api/support/conversations?role=customer  — filter by role
router.get('/conversations', authorize('admin'), getAllConversations);

// GET  /api/support/history/:userId        — specific user ki history
router.get('/history/:userId', authorize('admin'), getConversationHistory);

// DELETE /api/support/history/:userId      — admin apni side se delete
router.delete('/history/:userId', authorize('admin'), deleteConversation);

// GET  /api/support/admin-unread           — admin ka total unread
router.get('/admin-unread', authorize('admin'), getAdminUnread);

export default router;
