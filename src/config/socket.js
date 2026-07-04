import jwt from 'jsonwebtoken';
import User from '../models/User.model.js';
import Provider from '../models/provider/Provider.model.js';
import Job from '../models/job.model.js';
import Message from '../models/chat.model.js';
import SupportMessage from '../models/support.model.js';
import { sendPushNotification } from '../utils/notification.js';

// ─────────────────────────────────────────────────────────────
// Ye map track karega: userId → Set of socketIds
// Ek user ke multiple devices ho sakte hain
// ─────────────────────────────────────────────────────────────
const onlineUsers = new Map();

function addOnlineUser(userId, socketId) {
  if (!onlineUsers.has(userId)) {
    onlineUsers.set(userId, new Set());
  }
  onlineUsers.get(userId).add(socketId);
}

function removeOnlineUser(userId, socketId) {
  if (onlineUsers.has(userId)) {
    onlineUsers.get(userId).delete(socketId);
    if (onlineUsers.get(userId).size === 0) {
      onlineUsers.delete(userId);
    }
  }
}

function isUserOnline(userId) {
  return onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
}

// ─────────────────────────────────────────────────────────────
// Main socket setup function — app.js mein call hogi
// ─────────────────────────────────────────────────────────────
export function initSocket(io) {

  // ── JWT Auth Middleware for Socket ────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Unauthorized: No token'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      if (!decoded.userId) return next(new Error('Unauthorized: Invalid token'));

      const user = await User.findById(decoded.userId).select('-password');
      if (!user || user.status !== 'approved') {
        return next(new Error('Unauthorized: User not found or not approved'));
      }

      // Provider extra info
      if (user.role === 'provider') {
        const provider = await Provider.findOne({ userId: user._id });
        if (!provider) return next(new Error('Unauthorized: Provider profile not found'));
        socket.provider = provider;
      }

      socket.user = user;
      next();
    } catch (err) {
      next(new Error('Unauthorized: ' + err.message));
    }
  });

  // ── On Connection ─────────────────────────────────────────
  io.on('connection', (socket) => {
    const userId = socket.user._id.toString();
    addOnlineUser(userId, socket.id);

    console.log(`[Socket] Connected: ${socket.user.name} (${socket.user.role}) - ${socket.id}`);

    // Broadcast online status to everyone in this user's job rooms
    socket.broadcast.emit('user_online', { userId });

    // Admin sockets auto-join a shared room so every admin session gets
    // realtime sidebar updates (new message / unread count) for ALL support
    // conversations, not just the one currently open.
    if (socket.user.role === 'admin') {
      socket.join('admin_support_room');
    }

    // ── Join Chat Room ──────────────────────────────────────
    // Client sends jobId, we make both parties join same room
    socket.on('join_chat', async ({ jobId }) => {
      try {
        // Verify this user belongs to this job
        let job;
        if (socket.user.role === 'customer') {
          job = await Job.findOne({ _id: jobId, customer: socket.user._id })
            .populate('provider', 'userId');
        } else if (socket.user.role === 'provider') {
          job = await Job.findOne({ _id: jobId, provider: socket.provider._id });
        }

        if (!job) {
          socket.emit('chat_error', { message: 'Job not found or access denied' });
          return;
        }

        const room = `chat_${jobId}`;
        socket.join(room);
        socket.currentJobId = jobId;

        console.log(`[Socket] ${socket.user.name} joined room: ${room}`);

        // Auto mark messages as read when joining
        await Message.updateMany(
          { jobId, receiverId: socket.user._id, isRead: false },
          { isRead: true, readAt: new Date() }
        );

        // Tell the other party that messages are now read (blue ticks)
        socket.to(room).emit('messages_read', {
          jobId,
          readBy: userId,
        });

        socket.emit('joined_chat', { jobId, message: 'Joined chat room' });

        // Room mein baaki logon ko batao ke ye user join hua
        socket.to(room).emit('user_joined_chat', { userId });

        // Dusrey ki "in chat" status emit karo (sirf agar wo bhi is room mein ho)
        let otherUserId;
        if (socket.user.role === 'customer') {
          otherUserId = job.provider?.userId?.toString();
        } else {
          otherUserId = job.customer?.toString();
        }
        if (otherUserId) {
          const otherInRoom = await isUserInRoom(io, room, otherUserId);
          socket.emit('online_status', {
            userId: otherUserId,
            isOnline: otherInRoom,
          });
        }

      } catch (err) {
        console.error('[Socket] join_chat error:', err);
        socket.emit('chat_error', { message: 'Failed to join chat' });
      }
    });

    // ── Send Message ────────────────────────────────────────
    socket.on('send_message', async ({ jobId, message }) => {
      try {
        if (!jobId || !message?.trim()) {
          socket.emit('chat_error', { message: 'jobId and message are required' });
          return;
        }

        // Verify job access and resolve the correct receiver User._id
        let job;
        let resolvedReceiverId;

        if (socket.user.role === 'customer') {
          job = await Job.findOne({ _id: jobId, customer: socket.user._id }).populate('provider', 'userId');
          if (job) resolvedReceiverId = job.provider?.userId; // Provider.userId = User._id
        } else if (socket.user.role === 'provider') {
          job = await Job.findOne({ _id: jobId, provider: socket.provider._id });
          if (job) resolvedReceiverId = job.customer; // customer is already User._id
        }

        if (!job || !resolvedReceiverId) {
          socket.emit('chat_error', { message: 'Job not found or access denied' });
          return;
        }

        const receiverId = resolvedReceiverId;

        // Save to DB
        const newMsg = await Message.create({
          jobId,
          senderId: socket.user._id,
          senderRole: socket.user.role,
          receiverId,
          message: message.trim(),
          // If receiver is currently online in this room → auto mark as delivered
          isRead: false,
        });

        const msgPayload = {
          _id: newMsg._id,
          jobId,
          senderId: userId,
          senderRole: socket.user.role,
          receiverId,
          message: newMsg.message,
          isRead: false,
          createdAt: newMsg.createdAt,
        };

        const room = `chat_${jobId}`;

        // ── Sender ko confirm karo (temp replace karega) ────
        socket.emit('message_sent', { ...msgPayload, isMine: true });

        // ── Receiver ko new message bhejo ───────────────────
        socket.to(room).emit('receive_message', { ...msgPayload, isMine: false });

        // ── Single tick → sent ──────────────────────────────
        // Double tick → if receiver is online in this room
        const receiverOnline = isUserOnline(receiverId.toString());
        if (receiverOnline) {
          // Check if receiver is in this chat room
          const receiverInRoom = await isUserInRoom(io, room, receiverId.toString());
          if (receiverInRoom) {
            // Mark as read immediately + blue ticks
            await Message.findByIdAndUpdate(newMsg._id, { isRead: true, readAt: new Date() });
            io.to(room).emit('messages_read', { jobId, readBy: receiverId.toString() });
          } else {
            // Receiver online but in different screen → delivered (double tick)
            io.to(room).emit('message_delivered', { messageId: newMsg._id.toString(), jobId });
          }
        }

        // ── Push Notification + Badge (only if receiver NOT in this room) ──
        const receiverInRoom = await isUserInRoom(io, room, receiverId.toString());
        if (!receiverInRoom) {
          // Real-time badge update — receiver ke saare active sockets ko direct notify karo
          const receiverSocketIds = onlineUsers.get(receiverId.toString());
          if (receiverSocketIds) {
            receiverSocketIds.forEach(sid => {
              io.to(sid).emit('new_message_notification', { jobId });
            });
          }

          const receiver = await User.findById(receiverId).select('fcmToken fcmTokens').lean();
          const tokens = [
            ...(receiver?.fcmTokens || []),
            ...(receiver?.fcmToken ? [receiver.fcmToken] : []),
          ].filter((t, i, a) => t && a.indexOf(t) === i);

          if (tokens.length > 0) {
            await sendPushNotification(tokens, {
              title: `New message from ${socket.user.name}`,
              message: message.trim().length > 50
                ? message.trim().substring(0, 50) + '...'
                : message.trim(),
              data: { type: 'job', screen: 'Chat', jobId: jobId.toString(), senderId: userId },
            }, receiverId);
          }
        }

      } catch (err) {
        console.error('[Socket] send_message error:', err);
        socket.emit('chat_error', { message: 'Failed to send message' });
      }
    });

    // ── Typing Indicator ────────────────────────────────────
    socket.on('typing_start', ({ jobId }) => {
      const room = `chat_${jobId}`;
      socket.to(room).emit('user_typing', {
        jobId,
        userId,
        name: socket.user.name,
      });
    });

    socket.on('typing_stop', ({ jobId }) => {
      const room = `chat_${jobId}`;
      socket.to(room).emit('user_stopped_typing', { jobId, userId });
    });

    // ── Mark Read (when user opens chat) ───────────────────
    socket.on('mark_read', async ({ jobId }) => {
      try {
        await Message.updateMany(
          { jobId, receiverId: socket.user._id, isRead: false },
          { isRead: true, readAt: new Date() }
        );

        const room = `chat_${jobId}`;
        io.to(room).emit('messages_read', { jobId, readBy: userId });
      } catch (err) {
        console.error('[Socket] mark_read error:', err);
      }
    });

    // ── Check Online Status ─────────────────────────────────
    socket.on('check_online', ({ userId: checkId }) => {
      socket.emit('online_status', {
        userId: checkId,
        isOnline: isUserOnline(checkId),
      });
    });

    // ── Leave Chat Room ─────────────────────────────────────
    socket.on('leave_chat', ({ jobId }) => {
      const room = `chat_${jobId}`;
      socket.leave(room);
      if (socket.currentJobId === jobId) socket.currentJobId = null;
      socket.to(room).emit('user_left_chat', { userId });
      console.log(`[Socket] ${socket.user.name} left room: ${room}`);
    });

    // ════════════════════════════════════════════════════════
    // SUPPORT CHAT (Customer/Provider ↔ Admin)
    // Room = support_${userId}  where userId = customer/provider _id
    // ════════════════════════════════════════════════════════

    // ── Join Support Room ───────────────────────────────────
    socket.on('join_support', async ({ roomUserId } = {}) => {
      try {
        // customer/provider: apna room join karo
        // admin: specific user ka room join karo (roomUserId pass karo)
        const roomId = socket.user.role === 'admin'
          ? roomUserId
          : socket.user._id.toString();

        if (!roomId) {
          socket.emit('support_error', { message: 'roomUserId required for admin' });
          return;
        }

        const room = `support_${roomId}`;
        socket.join(room);
        socket.currentSupportRoom = roomId;

        console.log(`[Support] ${socket.user.name} (${socket.user.role}) joined: ${room}`);

        // Mark incoming messages as read
        await SupportMessage.updateMany(
          { roomId, receiverId: socket.user._id, isRead: false },
          { isRead: true, readAt: new Date() }
        );

        socket.to(room).emit('support_messages_read', { roomId, readBy: userId });

        // Admin ne is room ko open/read kiya → sidebar mein unread badge clear karo (sab admin sessions)
        if (socket.user.role === 'admin') {
          io.to('admin_support_room').emit('support_conversation_updated', {
            roomId,
            unreadCount: 0,
          });
        }

        // Admin ka online status bhi bhejo (customer/provider ke liye)
        let adminId = null;
        let adminOnline = false;
        if (socket.user.role !== 'admin') {
          const admin = await User.findOne({ role: 'admin' }).select('_id').lean();
          if (admin) {
            adminId = admin._id.toString();
            adminOnline = isUserOnline(adminId);
          }
        }

        socket.emit('support_joined', { roomId, adminId, adminOnline });

      } catch (err) {
        console.error('[Support] join_support error:', err);
        socket.emit('support_error', { message: 'Failed to join support room' });
      }
    });

    // ── Send Support Message ────────────────────────────────
    socket.on('send_support_message', async ({ roomUserId, message }) => {
      try {
        if (!message?.trim()) {
          socket.emit('support_error', { message: 'Message is required' });
          return;
        }

        let roomId;
        let receiverId;

        if (socket.user.role === 'admin') {
          // Admin → specific user ko reply
          if (!roomUserId) {
            socket.emit('support_error', { message: 'roomUserId required' });
            return;
          }
          roomId = roomUserId;
          receiverId = roomUserId; // user ka User._id

        } else {
          // Customer / Provider → admin ko message
          roomId = socket.user._id.toString();
          const admin = await User.findOne({ role: 'admin' }).select('_id').lean();
          if (!admin) {
            socket.emit('support_error', { message: 'No admin available' });
            return;
          }
          receiverId = admin._id;
        }

        const newMsg = await SupportMessage.create({
          roomId,
          senderId: socket.user._id,
          senderRole: socket.user.role,
          receiverId,
          message: message.trim(),
          isRead: false,
        });

        const msgPayload = {
          _id: newMsg._id,
          roomId,
          senderId: userId,
          senderRole: socket.user.role,
          receiverId,
          message: newMsg.message,
          isRead: false,
          createdAt: newMsg.createdAt,
        };

        const room = `support_${roomId}`;

        // Sender ko confirm
        socket.emit('support_message_sent', { ...msgPayload, isMine: true });

        // Receiver ko deliver
        socket.to(room).emit('support_receive_message', { ...msgPayload, isMine: false });

        // Blue ticks agar receiver room mein hai
        const receiverOnline = isUserOnline(receiverId.toString());
        const receiverInRoom = await isUserInRoom(io, room, receiverId.toString());
        if (receiverInRoom) {
          await SupportMessage.findByIdAndUpdate(newMsg._id, { isRead: true, readAt: new Date() });
          io.to(room).emit('support_messages_read', { roomId, readBy: receiverId.toString() });
        } else {
          // Receiver online but different screen → delivered (double tick) for sender's UI
          if (receiverOnline) {
            io.to(room).emit('support_message_delivered', { messageId: newMsg._id.toString(), roomId });
          }

          // Push notification — save nahi hogi DB mein, sirf push
          const senderName = socket.user.role === 'admin' ? 'Support Team' : socket.user.name;
          const receiver = await User.findById(receiverId).select('fcmToken fcmTokens').lean();
          const tokens = [
            ...(receiver?.fcmTokens || []),
            ...(receiver?.fcmToken ? [receiver.fcmToken] : []),
          ].filter((t, i, a) => t && a.indexOf(t) === i);

          if (tokens.length > 0) {
            await sendPushNotification(tokens, {
              title: `New message from ${senderName}`,
              message: message.trim().length > 50
                ? message.trim().substring(0, 50) + '...'
                : message.trim(),
              data: { type: 'support', screen: 'SupportChat', roomId: roomId.toString(), senderId: userId },
            }, receiverId);
          }
        }

        // ── Sidebar sync for ALL admin sessions ──────────────────────────
        // adminId = jo bhi is conversation ka admin-side receiver/sender hai
        const adminObjectId = socket.user.role === 'admin' ? socket.user._id : receiverId;
        const unreadForAdmin = await SupportMessage.countDocuments({
          roomId,
          receiverId: adminObjectId,
          isRead: false,
        });

        io.to('admin_support_room').emit('support_conversation_updated', {
          roomId,
          lastMessage: newMsg.message,
          lastMessageAt: newMsg.createdAt,
          unreadCount: unreadForAdmin,
          senderRole: socket.user.role,
          // Naya conversation ho sakta hai — user snapshot bhej do taake
          // admin sidebar bina extra API call ke naya row daal sake
          user: socket.user.role === 'admin' ? undefined : {
            _id: socket.user._id,
            name: socket.user.name,
            email: socket.user.email,
            role: socket.user.role,
            profilePicture: socket.user.profilePicture,
            phone: socket.user.phone,
          },
        });

      } catch (err) {
        console.error('[Support] send_support_message error:', err);
        socket.emit('support_error', { message: 'Failed to send support message' });
      }
    });

    // ── Support Typing ──────────────────────────────────────
    socket.on('support_typing_start', ({ roomUserId } = {}) => {
      const roomId = socket.user.role === 'admin' ? roomUserId : userId;
      if (!roomId) return;
      socket.to(`support_${roomId}`).emit('support_user_typing', { userId, name: socket.user.name });
    });

    socket.on('support_typing_stop', ({ roomUserId } = {}) => {
      const roomId = socket.user.role === 'admin' ? roomUserId : userId;
      if (!roomId) return;
      socket.to(`support_${roomId}`).emit('support_user_stopped_typing', { userId });
    });

    // ── Mark Support Read ───────────────────────────────────
    socket.on('support_mark_read', async ({ roomUserId } = {}) => {
      try {
        const roomId = socket.user.role === 'admin' ? roomUserId : userId;
        if (!roomId) return;

        await SupportMessage.updateMany(
          { roomId, receiverId: socket.user._id, isRead: false },
          { isRead: true, readAt: new Date() }
        );

        io.to(`support_${roomId}`).emit('support_messages_read', { roomId, readBy: userId });

        if (socket.user.role === 'admin') {
          io.to('admin_support_room').emit('support_conversation_updated', { roomId, unreadCount: 0 });
        }
      } catch (err) {
        console.error('[Support] support_mark_read error:', err);
      }
    });

    // ── Leave Support Room ──────────────────────────────────
    // Admin switches conversations ya chat band karta hai — purana room
    // chhodo taake stale room membership ki wajah se galat "read" na ho jaye.
    socket.on('leave_support', ({ roomUserId } = {}) => {
      const roomId = socket.user.role === 'admin' ? roomUserId : userId;
      if (!roomId) return;
      socket.leave(`support_${roomId}`);
      if (socket.currentSupportRoom === roomId) {
        socket.currentSupportRoom = null;
      }
    });

    // ── Disconnect ──────────────────────────────────────────
    socket.on('disconnect', () => {
      removeOnlineUser(userId, socket.id);
      console.log(`[Socket] Disconnected: ${socket.user.name} - ${socket.id}`);

      // Broadcast offline status
      socket.broadcast.emit('user_offline', { userId });
    });
  });
}

// ─────────────────────────────────────────────────────────────
// Helper: check if a userId is in a specific room
// ─────────────────────────────────────────────────────────────
async function isUserInRoom(io, room, userId) {
  try {
    const sockets = await io.in(room).fetchSockets();
    return sockets.some(s => s.user?._id?.toString() === userId);
  } catch {
    return false;
  }
}

export { isUserOnline };