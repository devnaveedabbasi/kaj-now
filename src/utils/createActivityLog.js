import ActivityLog from '../models/activityLog.model.js';

/**
 * Creates an activity log entry
 * @param {Object} params - The log parameters
 * @param {string} params.userId - ID of the user performing the action
 * @param {string} params.action - Action name (e.g., JOB_ACCEPTED)
 * @param {string} params.entityType - Type of entity affected
 * @param {string} params.entityId - ID of the entity affected
 * @param {Object} [params.details] - Additional details about the action
 * @param {Object} [params.req] - Express request object for IP and User-Agent
 */
export const createActivityLog = async ({ userId, action, entityType, entityId, details = {}, req = null }) => {
  try {
    const logData = {
      userId,
      action,
      entityType,
      entityId,
      details,
    };

    if (req) {
      logData.ipAddress = req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      logData.userAgent = req.headers['user-agent'];
    }

    await ActivityLog.create(logData);
  } catch (error) {
    console.error('Error creating activity log:', error);
    // We don't want to throw error here as it might break the main flow
  }
};
