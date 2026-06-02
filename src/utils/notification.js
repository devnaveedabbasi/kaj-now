import Notification from '../models/notification.model.js';
import admin from '../config/firebase/firebase.js';
import User from '../models/User.model.js';
export const sendPushNotification = async (tokens, { title, message, data = {} }, userId = null) => {
  if (!tokens) return;

  const tokensArray = Array.isArray(tokens) 
    ? tokens.filter(t => typeof t === 'string' && t.trim() !== '')
    : [tokens].filter(t => typeof t === 'string' && t.trim() !== '');

  if (tokensArray.length === 0) return;

  try {
    const safeData = {};

    Object.keys(data || {}).forEach((key) => {
      if (data[key] !== undefined && data[key] !== null) {
        safeData[key] = String(data[key]);
      }
    });

    const response = await admin.messaging().sendEachForMulticast({
      tokens: tokensArray,
      notification: {
        title,
        body: message,
      },
      data: safeData,
    });

    const failedTokens = [];
    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const error = resp.error;
        if (error) {
          const errorCode = error.code;
          if (
            errorCode === 'messaging/invalid-registration-token' ||
            errorCode === 'messaging/registration-token-not-registered'
          ) {
            failedTokens.push(tokensArray[idx]);
          }
        }
      }
    });

    if (failedTokens.length > 0) {
      console.log("Removing invalid/expired FCM tokens:", failedTokens);
      if (userId) {
        await User.updateOne(
          { _id: userId },
          { $pull: { fcmTokens: { $in: failedTokens } } }
        );
        // Check and nullify legacy fcmToken if it was invalid
        const user = await User.findById(userId).select('fcmToken');
        if (user && failedTokens.includes(user.fcmToken)) {
          await User.updateOne({ _id: userId }, { $set: { fcmToken: null } });
        }
      } else {
        await User.updateMany(
          { fcmTokens: { $in: failedTokens } },
          { $pull: { fcmTokens: { $in: failedTokens } } }
        );
        await User.updateMany(
          { fcmToken: { $in: failedTokens } },
          { $set: { fcmToken: null } }
        );
      }
    }

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

    const user = await User.findById(userId).select('fcmToken fcmTokens');

    let tokens = [];
    if (user?.fcmTokens && Array.isArray(user.fcmTokens)) {
      tokens = [...user.fcmTokens];
    }

    // Support existing fcmToken field for backward compatibility & auto-migration
    if (user?.fcmToken && typeof user.fcmToken === 'string' && user.fcmToken.trim() !== '') {
      const singleToken = user.fcmToken.trim();
      if (!tokens.includes(singleToken)) {
        tokens.push(singleToken);
        // Automatically migrate legacy token to fcmTokens array
        await User.updateOne({ _id: userId }, { $addToSet: { fcmTokens: singleToken } });
      }
    }

    console.log("USER FCMs:", tokens);

    if (tokens.length > 0) {
      await sendPushNotification(tokens, {
        title,
        message,
        data: { type, referenceId }
      }, userId);
    } else {
      console.log("No FCM tokens found");
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