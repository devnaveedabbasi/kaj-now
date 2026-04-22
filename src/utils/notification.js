import Notification from '../models/notification.model.js';
import admin from '../config/firebase/firebase.js';
import User from '../models/User.model.js';
export const sendPushNotification = async (token, { title, message, data = {} }) => {
  if (!token) return;

  try {
    const safeData = {};

    Object.keys(data || {}).forEach((key) => {
      if (data[key] !== undefined && data[key] !== null) {
        safeData[key] = String(data[key]);
      }
    });

    const response = await admin.messaging().send({
      token,
      notification: {
        title,
        body: message,
      },
      data: safeData,
    });

    console.log("FCM sent:", response);
    return response;

  } catch (error) {
    console.error("FCM push error:", error);
  }
};
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

    const user = await User.findById(userId).select('fcmToken');

    console.log("USER FCM:", user?.fcmToken);

    if (user?.fcmToken) {
      await sendPushNotification(user.fcmToken, {
        title,
        message,
        data: { type, referenceId }
      });
    } else {
      console.log("No FCM token found");
    }

    return notification;

  } catch (error) {
    console.error("Error creating notification:", error);
    return null;
  }
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