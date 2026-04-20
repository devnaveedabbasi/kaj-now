// middleware/auth.js
import jwt from 'jsonwebtoken';
import User from '../models/User.model.js';
import  Provider from '../models/provider/Provider.model.js';

const authMiddleware = async (req, res, next) => {
  try {
    // Check for JWT_SECRET
    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not defined');
      return res.status(500).json({
        success: false,
        message: 'Server configuration error'
      });
    }

    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access denied. No token provided.'
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Validate decoded has userId
    if (!decoded.userId) {
      return res.status(401).json({
        success: false,
        message: 'Invalid token structure'
      });
    }

    const user = await User.findById(decoded.userId).select('-password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    const allowedStatuses = ['approved'];
    if (!allowedStatuses.includes(user.status)) {
      return res.status(403).json({
        success: false,
        message: `Account not authorized. Current status: ${user.status}`
      });
    }

    //  YAHI PE PROVIDER KA KYC CHECK KAR DO 
    if (user.role === 'provider') {
      const provider = await Provider.findOne({ userId: user._id });
      console.log('Provider profile:', provider);
      if (!provider) {
        return res.status(403).json({
          success: false,
          message: 'Provider profile not found. Please complete your profile.'
        });
      }
      
      if (provider.kycStatus === 'suspended' || provider.kycStatus === 'blocked') {
        return res.status(403).json({
          success: false,
          message: 'Provider account has been suspended.'
        });
      }

      
      // Provider specific info attach kar do req mein
      req.provider = provider;
    }

    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token has expired. Please login again.'
      });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    
    console.error('Auth middleware error:', error);
    res.status(401).json({
      success: false,
      message: 'Authentication failed'
    });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }
    
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required roles: ${roles.join(', ')}`
      });
    }
    next();
  };
};

export { authMiddleware, authorize };