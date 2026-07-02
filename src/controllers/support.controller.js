import SupportMessage from '../models/support.model.js';
import User from '../models/User.model.js';
import { ApiError } from '../utils/errorHandler.js';
import { ApiResponse } from '../utils/apiResponse.js';

// ─────────────────────────────────────────────────────────────
// GET /api/support/history
// Customer / Provider apni support history dekhta hai
// ─────────────────────────────────────────────────────────────
export async function getMySupportHistory(req, res) {
  try {
    const userId = req.user._id;

    const messages = await SupportMessage.find({
      roomId: userId,
      deletedFor: { $ne: userId },
    })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();

    const myId = userId.toString();
    messages.forEach(m => {
      m.isMine = m.senderId.toString() === myId;
    });

    // Incoming messages read mark karo
    await SupportMessage.updateMany(
      { roomId: userId, receiverId: userId, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    return res.status(200).json(
      new ApiResponse(200, messages, 'Support history fetched')
    );
  } catch (error) {
    throw new ApiError(500, 'Failed to fetch support history');
  }
}

// ─────────────────────────────────────────────────────────────
// DELETE /api/support/history
// Customer / Provider apni side se chat delete karta hai
// ─────────────────────────────────────────────────────────────
export async function deleteMySupportChat(req, res) {
  try {
    const userId = req.user._id;

    await SupportMessage.updateMany(
      { roomId: userId, deletedFor: { $ne: userId } },
      { $push: { deletedFor: userId } }
    );

    return res.status(200).json(
      new ApiResponse(200, null, 'Support chat deleted for you')
    );
  } catch (error) {
    throw new ApiError(500, 'Failed to delete support chat');
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/support/unread
// Customer / Provider ka unread count
// ─────────────────────────────────────────────────────────────
export async function getMySupportUnread(req, res) {
  try {
    const userId = req.user._id;

    const count = await SupportMessage.countDocuments({
      roomId: userId,
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
// ADMIN: GET /api/support/conversations
// Sab users ki list jinhon ne support message kiya
// ?role=customer  ya  ?role=provider  se filter ho sakta hai
// ─────────────────────────────────────────────────────────────
export async function getAllConversations(req, res) {
  try {
    const adminId = req.user._id;
    const { role } = req.query; // optional filter

    // Distinct roomIds with last message info
    const pipeline = [
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: '$roomId',
          lastMessage: { $first: '$message' },
          lastMessageAt: { $first: '$createdAt' },
          unreadCount: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ['$isRead', false] },
                    { $ne: ['$senderRole', 'admin'] },
                  ],
                },
                1,
                0,
              ],
            },
          },
        },
      },
      { $sort: { lastMessageAt: -1 } },
    ];

    const grouped = await SupportMessage.aggregate(pipeline);

    // Populate user info
    const userIds = grouped.map(g => g._id);
    const userQuery = { _id: { $in: userIds } };
    if (role) userQuery.role = role; // filter by role

    const users = await User.find(userQuery).select('name email role profilePicture phone');
    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });

    const result = grouped
      .filter(g => userMap[g._id.toString()]) // role filter lagao
      .map(g => ({
        roomId: g._id,
        user: userMap[g._id.toString()],
        lastMessage: g.lastMessage,
        lastMessageAt: g.lastMessageAt,
        unreadCount: g.unreadCount,
      }));

    return res.status(200).json(
      new ApiResponse(200, result, 'Conversations fetched')
    );
  } catch (error) {
    throw new ApiError(500, 'Failed to fetch conversations');
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN: GET /api/support/history/:userId
// Specific user ke sath admin ki full chat history
// ─────────────────────────────────────────────────────────────
export async function getConversationHistory(req, res) {
  try {
    const adminId = req.user._id;
    const { userId } = req.params;

    const messages = await SupportMessage.find({
      roomId: userId,
      deletedFor: { $ne: adminId },
    })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();

    const myId = adminId.toString();
    messages.forEach(m => {
      m.isMine = m.senderId.toString() === myId;
    });

    // Admin ke liye incoming messages read mark karo
    await SupportMessage.updateMany(
      { roomId: userId, receiverId: adminId, isRead: false },
      { isRead: true, readAt: new Date() }
    );

    return res.status(200).json(
      new ApiResponse(200, messages, 'Conversation history fetched')
    );
  } catch (error) {
    throw new ApiError(500, 'Failed to fetch conversation history');
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN: DELETE /api/support/history/:userId
// Admin apni side se specific user ki chat delete karta hai
// ─────────────────────────────────────────────────────────────
export async function deleteConversation(req, res) {
  try {
    const adminId = req.user._id;
    const { userId } = req.params;

    await SupportMessage.updateMany(
      { roomId: userId, deletedFor: { $ne: adminId } },
      { $push: { deletedFor: adminId } }
    );

    return res.status(200).json(
      new ApiResponse(200, null, 'Conversation deleted for you')
    );
  } catch (error) {
    throw new ApiError(500, 'Failed to delete conversation');
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN: GET /api/support/unread
// Admin ka total unread count (sab users se)
// ─────────────────────────────────────────────────────────────
export async function getAdminUnread(req, res) {
  try {
    const adminId = req.user._id;

    const count = await SupportMessage.countDocuments({
      receiverId: adminId,
      isRead: false,
      deletedFor: { $ne: adminId },
    });

    return res.status(200).json(
      new ApiResponse(200, { unreadCount: count }, 'Admin unread count fetched')
    );
  } catch (error) {
    throw new ApiError(500, 'Failed to fetch admin unread count');
  }
}
