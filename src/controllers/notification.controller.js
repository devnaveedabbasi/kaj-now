import Notification from '../models/notification.model.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { ApiError } from '../utils/errorHandler.js';
import { markAsRead, markAllAsRead, getUnreadCount } from '../utils/notification.js';

// Get user notifications
export const getUserNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { type, isRead } = req.query;
    
    let query = { userId };
    if (type) query.type = type;
    if (isRead !== undefined) query.isRead = isRead === 'true';
    
    const [notifications, totalCount] = await Promise.all([
      Notification.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments(query)
    ]);
    
    const unreadCount = await getUnreadCount(userId);
    const totalPages = Math.ceil(totalCount / limit);
    
    res.status(200).json(
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
    res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
  }
};

// Mark notification as read
export const markNotificationAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user._id;
    
    const notification = await markAsRead(notificationId, userId);
    
    if (!notification) {
      throw new ApiError(404, 'Notification not found');
    }
    
    res.status(200).json(
      new ApiResponse(200, notification, 'Notification marked as read')
    );
  } catch (error) {
    if (error instanceof ApiError) {
      res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
    } else {
      res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
    }
  }
};

// Mark all notifications as read
export const markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user._id;
    await markAllAsRead(userId);
    
    res.status(200).json(
      new ApiResponse(200, null, 'All notifications marked as read')
    );
  } catch (error) {
    res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
  }
};

// Delete notification
export const deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user._id;
    
    const notification = await Notification.findOneAndDelete({ _id: notificationId, userId });
    
    if (!notification) {
      throw new ApiError(404, 'Notification not found');
    }
    
    res.status(200).json(
      new ApiResponse(200, null, 'Notification deleted successfully')
    );
  } catch (error) {
    if (error instanceof ApiError) {
      res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
    } else {
      res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
    }
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