import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import {
  getChatHistory,
  deleteMyChat,
  getUnreadCount,
  getTotalUnread,
} from '../controllers/chat.controller.js';

const router = Router();

// All chat routes require authentication
router.use(authMiddleware);

// GET  /api/chat/history/:jobId   — full message history for a job
router.get('/history/:jobId', getChatHistory);

// DELETE /api/chat/history/:jobId — delete chat from my side only (WhatsApp-style)
router.delete('/history/:jobId', deleteMyChat);

// GET  /api/chat/unread/:jobId    — unread count for one job (badge)
router.get('/unread/:jobId', getUnreadCount);

// GET  /api/chat/all-unread       — total unread across all jobs
router.get('/all-unread', getTotalUnread);

export default router;
