import Notification from '../models/notification.model.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { ApiError } from '../utils/errorHandler.js';
import {  getUnreadCount } from '../utils/notification.js';
import admin from '../config/firebase/firebase.js';
import User from '../models/User.model.js';
export const getUserNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const query = { userId };

    const [notifications, totalCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments(query)
    ]);

    await Notification.updateMany(
      { userId, isRead: false },
      { 
        $set: { 
          isRead: true,
          readAt: new Date()
        }
      }
    );

    const unreadCount = await getUnreadCount(userId);
    const totalPages = Math.ceil(totalCount / limit);

    return res.status(200).json(
      new ApiResponse(200, {
        notifications,
        unreadCount,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: totalCount,
          itemsPerPage: limit
        }
      }, 'Notifications retrieved successfully')
    );

  } catch (error) {
    console.error('Error getting notifications:', error);
    return res.status(500).json(
      new ApiResponse(500, null, 'Internal server error')
    );
  }
};

// Get notification settings (unread count)
export const getNotificationBadge = async (req, res) => {
  try {
    const userId = req.user._id;
    const unreadCount = await getUnreadCount(userId);

    res.status(200).json(
      new ApiResponse(200, { unreadCount }, 'Notification badge retrieved')
    );
  } catch (error) {
    res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
  }
};


export const saveFcmToken = async (req, res) => {
  try {
    const userId = req.user._id;
    const { fcmToken } = req.body;

    if (!fcmToken || typeof fcmToken !== 'string') {
      throw new ApiError(400, 'FCM token is required');
    }

    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, 'User not found');

    user.fcmToken = fcmToken.trim(); // simple string save
    await user.save();

    return res.status(200).json(
      new ApiResponse(200, null, 'FCM token saved')
    );

  } catch (error) {
    return res.status(error.statusCode || 500).json(
      new ApiResponse(error.statusCode || 500, null, error.message)
    );
  }
};



export const sendTestNotification = async (req, res) => {
  try {
    const { userId, title, message } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // 1. Save DB notification
    const notification = await Notification.create({
      userId,
      title,
      message,
      type: 'system'
    });

  if (user?.fcmToken) {
  await admin.messaging().send({
    token: user.fcmToken,
    notification: {
      title,
      body: message
    },
    data: {
      type: 'test',
      notificationId: notification._id.toString()
    }
  });
}

    return res.status(200).json({
      success: true,
      message: 'Test notification sent',
      data: notification
    });

  } catch (error) {
    console.error(error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
};