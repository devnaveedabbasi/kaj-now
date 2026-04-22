import Notification from '../models/notification.model.js';

// Create notification
export const createNotification = async ({
  userId,
  title,
  message,
  type = 'system',
  referenceId = null,
  metadata = {}
}) => {
  try {
    const notification = await Notification.create({
      userId,
      title,
      message,
      type,
      referenceId,
      metadata
    });
    return notification;
  } catch (error) {
    console.error('Error creating notification:', error);
    return null;
  }
};

// Create multiple notifications
export const createBulkNotifications = async (notifications) => {
  try {
    const results = await Notification.insertMany(notifications);
    return results;
  } catch (error) {
    console.error('Error creating bulk notifications:', error);
    return [];
  }
};

// Mark as read
export const markAsRead = async (notificationId, userId) => {
  return await Notification.findOneAndUpdate(
    { _id: notificationId, userId },
    { isRead: true, readAt: new Date() },
    { new: true }
  );
};

// Mark all as read
export const markAllAsRead = async (userId) => {
  return await Notification.updateMany(
    { userId, isRead: false },
    { isRead: true, readAt: new Date() }
  );
};

// Get unread count
export const getUnreadCount = async (userId) => {
  return await Notification.countDocuments({ userId, isRead: false });
};

// Delete old notifications
export const deleteOldNotifications = async (days = 30) => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return await Notification.deleteMany({ createdAt: { $lt: date }, isRead: true });
};