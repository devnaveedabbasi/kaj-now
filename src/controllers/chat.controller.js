import Job from '../models/job.model.js';
import Message from '../models/chat.model.js';
import User from '../models/User.model.js';
import { ApiError } from '../utils/errorHandler.js';
import { ApiResponse } from '../utils/apiResponse.js';

// ─────────────────────────────────────────────────────────────
// GET /api/chat/history/:jobId
// Both customer & provider can call this
// ─────────────────────────────────────────────────────────────
export async function getChatHistory(req, res) {
  try {
    const { jobId } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role; // 'customer' or 'provider'

    // Verify this user is part of this job
    let job;
    if (userRole === 'customer') {
      job = await Job.findOne({ _id: jobId, customer: userId });
    } else if (userRole === 'provider') {
      job = await Job.findOne({ _id: jobId, provider: req.provider._id });
    }

    if (!job) {
      throw new ApiError(404, 'Job not found or access denied');
    }

    // Exclude messages deleted by this user
    const messages = await Message.find({ jobId, deletedFor: { $ne: userId } })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();

    const myId = userId.toString();
    messages.forEach(m => {
      m.isMine = m.senderId.toString() === myId;
    });
    console.log(`[Chat] jobId=${jobId} user=${myId} role=${userRole} msgs=${messages.length} first_isMine=${messages[0]?.isMine}`);

    // Mark incoming messages as read
    await Message.updateMany(
      { jobId, receiverId: userId, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    return res.status(200).json(
      new ApiResponse(200, messages, 'Chat history fetched')
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, 'Failed to fetch chat history');
  }
}

// ─────────────────────────────────────────────────────────────
// DELETE /api/chat/history/:jobId
// WhatsApp-style: sirf apni side se delete karo
// ─────────────────────────────────────────────────────────────
export async function deleteMyChat(req, res) {
  try {
    const { jobId } = req.params;
    const userId = req.user._id;
    const userRole = req.user.role;

    // Verify this user belongs to this job
    let job;
    if (userRole === 'customer') {
      job = await Job.findOne({ _id: jobId, customer: userId });
    } else if (userRole === 'provider') {
      job = await Job.findOne({ _id: jobId, provider: req.provider._id });
    }

    if (!job) {
      throw new ApiError(404, 'Job not found or access denied');
    }

    // Add userId to deletedFor array for ALL messages in this job
    await Message.updateMany(
      { jobId, deletedFor: { $ne: userId } },
      { $push: { deletedFor: userId } }
    );

    return res.status(200).json(
      new ApiResponse(200, null, 'Chat deleted for you')
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, 'Failed to delete chat');
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/chat/unread/:jobId
// Unread message count for badge on booking list
// ─────────────────────────────────────────────────────────────
export async function getUnreadCount(req, res) {
  try {
    const { jobId } = req.params;
    const userId = req.user._id;

    const count = await Message.countDocuments({
      jobId,
      receiverId: userId,
      isRead: false,
      deletedFor: { $ne: userId },
    });

    return res.status(200).json(
      new ApiResponse(200, { unreadCount: count }, 'Unread count fetched')
    );
  } catch (error) {
    throw new ApiError(500, 'Failed to fetch unread count');
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/chat/all-unread
// Total unread across ALL jobs (for global badge / notification dot)
// ─────────────────────────────────────────────────────────────
export async function getTotalUnread(req, res) {
  try {
    const userId = req.user._id;

    const count = await Message.countDocuments({
      receiverId: userId,
      isRead: false,
      deletedFor: { $ne: userId },
    });

    return res.status(200).json(
      new ApiResponse(200, { totalUnread: count }, 'Total unread fetched')
    );
  } catch (error) {
    throw new ApiError(500, 'Failed to fetch total unread');
  }
}
