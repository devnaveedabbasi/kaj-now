import User from '../models/User.model.js';
import { ApiError } from './errorHandler.js';
export const updateUserLocation = async (userId, latitude, longitude, locationName) => {
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);
  
  if (isNaN(lat) || lat < -90 || lat > 90) {
    throw new ApiError(400, 'Invalid latitude');
  }
  
  if (isNaN(lng) || lng < -180 || lng > 180) {
    throw new ApiError(400, 'Invalid longitude');
  }
  
  const user = await User.findById(userId);
  if (!user) {
    throw new ApiError(404, 'User not found');
  }
  
  user.location = {
    type: 'Point',
    coordinates: [lng, lat],
    locationName: locationName || '',
  };
  
  user.profileLastUpdated = new Date();
  await user.save();
  
  return user;
};