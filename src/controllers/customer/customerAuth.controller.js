import bcrypt from 'bcryptjs';
import User from '../../models/User.model.js';
import { sendOtpEmail } from '../../utils/emailService.js';
import { signToken } from '../../utils/jwt.js';
import { generateNumericOtp } from '../../utils/otp.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { updateUserLocation } from '../../utils/updateUserLocation.js';
import { deleteFile } from '../../utils/deleteFiles.js';
import fs from 'fs';
import path from 'path';
const SALT_ROUNDS = 10;
const OTP_TTL_MS = 10 * 60 * 1000;
// const OTP_TTL_MS = 1 * 60 * 1000; // 1 minute

const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^(\+880|880|0)?1[3-9][0-9]{8}$/;

function publicUserDoc(user) {
  const u = user.toObject ? user.toObject() : { ...user };
  delete u.password;
  delete u.emailOTP;
  return u;
}

async function setEmailOtp(user, otpPlain) {
  user.emailOTP = otpPlain;
  user.otpExpiry = new Date(Date.now() + OTP_TTL_MS);
  user.lastOTPSent = new Date();
  user.otpAttempts = 0;
  await user.save();
}



export async function register(req, res) {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');

  if (!name || !email || !phone || !password) {
    throw new ApiError(400, 'Name, email, phone, and password are required.');
  }

  if (!emailRegex.test(email)) {
    throw new ApiError(400, 'Invalid email address.');
  }
  if (password.length < 8) {
    throw new ApiError(400, 'Password must be at least 8 characters.');
  }

  if (!phoneRegex.test(phone)) {
    throw new ApiError(400, 'Only Bangladesh phone numbers is allowed.');
  }

  const existing = await User.findOne({
    $or: [{ email }, { phone }],
  }).select('_id email phone isEmailVerified');

  if (existing) {
    if (existing.email === email) {
      if (!existing.isEmailVerified) {
        throw new ApiError(
          409,
          'This email is already registered but not verified. Use resend OTP or verify your email.'
        );
      }
      throw new ApiError(408, 'Email already registered.');
    }
    throw new ApiError(408, 'Phone number already registered.');
  }

  const hashed = await bcrypt.hash(password, SALT_ROUNDS);
  const otp = generateNumericOtp(4);

  const user = await User.create({
    name,
    email,
    phone,
    password: hashed,
    role: 'customer',
    status: 'pending',
    isEmailVerified: false,
    emailOTP: otp,
    otpExpiry: new Date(Date.now() + OTP_TTL_MS),
    otpAttempts: 0,
    lastOTPSent: new Date(),
  });


  await sendOtpEmail(email, otp);

  res.status(201).json(
    new ApiResponse(
      201,
      {
        userId: user._id,
        email: user.email,
        expiresInMinutes: Math.round(OTP_TTL_MS / 60000),
      },
      'Account created. Enter the OTP sent to your email.'
    )
  );
}

export async function verifyEmail(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const otp = String(req.body.otp || '').trim();

  if (!email || !otp) {
    throw new ApiError(400, 'Email and OTP are required.');
  }

  const user = await User.findOne({ email, role: 'customer' });

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }
  if (user.isEmailVerified) {
    throw new ApiError(407, 'Email is already verified.');
  }

  if (user.otpAttempts >= MAX_OTP_ATTEMPTS) {
    throw new ApiError(429, 'Too many failed attempts. Request a new OTP.');
  }

  if (!user.emailOTP || !user.otpExpiry || user.otpExpiry < new Date()) {
    user.otpAttempts += 1;
    await user.save();
    throw new ApiError(410, 'OTP expired or invalid. Request a new OTP.');
  }

  if (user.emailOTP !== otp) {
    user.otpAttempts += 1;
    await user.save();
    throw new ApiError(401, 'Invalid OTP.');
  }

  user.isEmailVerified = true;
  user.emailOTP = undefined;
  user.otpExpiry = undefined;
  user.otpAttempts = 0;
  user.status = 'approved';
  await user.save();

  const token = signToken(user._id, user.role);

  const fresh = await User.findById(user._id);
  res.status(200).json(
    new ApiResponse(
      200,
      {
        token,
        user: publicUserDoc(fresh),
      },
      'Email verified successfully.'
    )
  );
}

export async function resendOtp(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();

  if (!email) {
    throw new ApiError(400, 'Email is required.');
  }

  const user = await User.findOne({ email, role: 'customer' });

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }
  if (user.isEmailVerified) {
    throw new ApiError(407, 'Email is already verified.');
  }

  if (user.lastOTPSent && Date.now() - user.lastOTPSent.getTime() < RESEND_COOLDOWN_MS) {
    const waitSec = Math.ceil(
      (RESEND_COOLDOWN_MS - (Date.now() - user.lastOTPSent.getTime())) / 1000
    );
    throw new ApiError(429, `Please wait ${waitSec} seconds before requesting another OTP.`);
  }

  const otp = generateNumericOtp(4);
  await setEmailOtp(user, otp);
  await sendOtpEmail(email, otp);

  res.status(200).json(
    new ApiResponse(
      200,
      { expiresInMinutes: Math.round(OTP_TTL_MS / 60000) },
      'A new OTP has been sent to your email.'
    )
  );
}

export async function login(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!email || !password) {
    throw new ApiError(400, 'Email and password are required.');
  }

  const user = await User.findOne({ email, role: 'customer' }).select('+password');

  if (!user) {
    throw new ApiError(401, 'Invalid email or password.');
  }

  if (!user.isEmailVerified) {
    throw new ApiError(403, 'Please verify your email before logging in.');
  }

  const allowedStatuses = ['approved'];
  if (!allowedStatuses.includes(user.status)) {
    throw new ApiError(403, `Account not authorized. Current status: ${user.status}`);
  }

  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    throw new ApiError(401, 'Invalid email or password.');
  }

  const token = signToken(user._id, user.role);

  res.status(200).json(
    new ApiResponse(
      200,
      {
        token,
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          status: user.status,
        },
      },
      'Login successful.'
    )
  );
}

export async function forgotPassword(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();

  if (!email) {
    throw new ApiError(400, 'Email is required.');
  }

  const user = await User.findOne({ email });

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  const otp = generateNumericOtp(4);

  user.resetOTP = otp;
  user.resetOtpExpiry = new Date(Date.now() + OTP_TTL_MS);
  user.resetOtpAttempts = 0;
  user.lastOTPSent = new Date();

  await user.save();
  await sendOtpEmail(email, otp);

  res.status(200).json(
    new ApiResponse(
      200,
      { expiresInMinutes: Math.round(OTP_TTL_MS / 60000) },
      'Reset OTP sent to your email.'
    )
  );
}

export async function verifyResetOtp(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const otp = String(req.body.otp || '').trim();

  if (!email || !otp) {
    throw new ApiError(400, 'Email and OTP are required.');
  }

  const user = await User.findOne({ email });

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  if (user.resetOtpAttempts >= MAX_OTP_ATTEMPTS) {
    throw new ApiError(429, 'Too many attempts. Request new OTP.');
  }

  if (!user.resetOTP || !user.resetOtpExpiry || user.resetOtpExpiry < new Date()) {
    user.resetOtpAttempts += 1;
    await user.save();
    throw new ApiError(410, 'OTP expired or invalid.');
  }

  if (user.resetOTP !== otp) {
    user.resetOtpAttempts += 1;
    await user.save();
    throw new ApiError(400, 'Invalid OTP.');
  }

  user.resetOTP = undefined;
  user.resetOtpExpiry = undefined;
  user.resetOtpAttempts = 0;
  user.resetPasswordVerified = true;

  await user.save();

  res.status(200).json(
    new ApiResponse(200, {}, 'OTP verified successfully.')
  );
}

export async function setNewPassword(req, res) {
  const email = String(req.body.email || '').trim().toLowerCase();
  const newPassword = String(req.body.newPassword || '');

  if (!email || !newPassword) {
    throw new ApiError(400, 'Email and new password are required.');
  }

  if (newPassword.length < 8) {
    throw new ApiError(400, 'Password must be at least 8 characters.');
  }

  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  if (!user.resetPasswordVerified) {
    throw new ApiError(403, 'Please verify OTP before resetting password.');
  }

  const isSamePassword = await bcrypt.compare(newPassword, user.password);
  if (isSamePassword) {
    throw new ApiError(400, 'New password cannot be the same as your current password.');
  }

  const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);

  user.password = hashed;
  user.resetPasswordVerified = false;

  await user.save();

  res.status(200).json(
    new ApiResponse(200, {}, 'Password reset successfully.')
  );
}

export async function changePassword(req, res) {
  const userId = req.user._id;
  const currentPassword = String(req.body.currentPassword || '');
  const newPassword = String(req.body.newPassword || '');

  if (!currentPassword || !newPassword) {
    throw new ApiError(400, 'Current and new password are required.');
  }

  if (newPassword.length < 8) {
    throw new ApiError(400, 'New password must be at least 8 characters.');
  }

  const user = await User.findById(userId).select('+password');

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  const match = await bcrypt.compare(currentPassword, user.password);
  if (!match) {
    throw new ApiError(400, 'Current password is incorrect.');
  }

  const isSamePassword = await bcrypt.compare(newPassword, user.password);
  if (isSamePassword) {
    throw new ApiError(400, 'New password cannot be the same as your current password.');
  }

  const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);

  user.password = hashed;
  await user.save();

  res.status(200).json(
    new ApiResponse(200, {}, 'Password changed successfully.')
  );
}

export async function me(req, res) {
  const user = await User.findById(req.user._id);
  if (!user) {
    throw new ApiError(404, 'User not found.');
  }

  res.status(200).json(
    new ApiResponse(
      200,
      {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone,
        status: user.status,
        location: user.location,
      },
      'User profile retrieved successfully.'
    )
  );
}
export const updateMyLocation = async (req, res) => {
  const userId = req.user.id || req.user._id;
  console.log('Updating location for user ID:', userId);
  const { latitude, longitude, locationName } = req.body;

  if (!latitude || !longitude) {
    throw new ApiError(400, 'Latitude and longitude are required');
  }

  const user = await updateUserLocation(userId, latitude, longitude, locationName);

  res.status(200).json(
    new ApiResponse(200, {
      location: user.location
    }, 'Location updated successfully')
  );
};




export const updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { name, email, phone } = req.body;
    const files = req.files || {};

    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    if (name) user.name = name.trim();
    
    // Handle email update with OTP
    if (email && email !== user.email) {
      const existingUser = await User.findOne({ email, _id: { $ne: userId } });
      if (existingUser) {
        throw new ApiError(409, 'Email already registered');
      }
      
      const otp = generateNumericOtp(4);
      console.log('Generated OTP for email update:', otp); // Debug log
      user.pendingNewEmail = email.toLowerCase();
      user.emailUpdateOTP = otp;
      user.emailUpdateOtpExpiry = new Date(Date.now() + OTP_TTL_MS);
      user.emailUpdateOtpAttempts = 0;
      user.isEmailChanged = false;
      
      await sendOtpEmail(email, otp);
      
      await user.save();
      
      return res.status(200).json(
        new ApiResponse(200, {
          message: `OTP sent to ${email}. Please verify to complete email update.`,
          pendingEmail: email,
          requiresOtpVerification: true
        }, 'OTP sent for email verification')
      );
    }


    if (phone) {
      if (!phoneRegex.test(phone)) {
        throw new ApiError(400, 'Invalid phone number');
      }
      const existingUser = await User.findOne({ phone, _id: { $ne: userId } });
      if (existingUser) {
        throw new ApiError(409, 'Phone number already registered');
      }
      user.phone = phone;
    }

    // Update profile picture
    if (files.profilePicture && files.profilePicture[0]) {
      if (user.profilePicture) {
        const oldPath = path.join(process.cwd(), 'public', user.profilePicture.replace(process.env.BASE_URL, ''));
        deleteFile(oldPath);
      }
      user.profilePicture = `/uploads/users/${files.profilePicture[0].filename}`;
    }

    await user.save();

    res.status(200).json(
      new ApiResponse(200, {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          profilePicture: user.profilePicture
        },
      }, 'Profile updated successfully')
    );
  } catch (error) {
    // Clean up uploaded file on error
    if (req.files?.profilePicture) {
      deleteFile(req.files.profilePicture[0].path);
    }
    
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
    }
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};

export const verifyEmailUpdate = async (req, res) => {
  try {
    const userId = req.user._id;
    const { otp } = req.body;

    if (!otp) {
      throw new ApiError(400, 'OTP is required');
    }

    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    if (!user.pendingNewEmail) {
      throw new ApiError(400, 'No pending email update');
    }

    if (user.emailUpdateOtpAttempts >= MAX_OTP_ATTEMPTS) {
      throw new ApiError(429, 'Too many failed attempts. Request new OTP');
    }

    if (!user.emailUpdateOTP || !user.emailUpdateOtpExpiry || user.emailUpdateOtpExpiry < new Date()) {
      user.emailUpdateOtpAttempts += 1;
      await user.save();
      throw new ApiError(410, 'OTP expired. Please request new OTP');
    }

    if (user.emailUpdateOTP !== otp) {
      user.emailUpdateOtpAttempts += 1;
      await user.save();
      throw new ApiError(400, 'Invalid OTP');
    }

    // Update email
    user.email = user.pendingNewEmail;
    user.pendingNewEmail = null;
    user.emailUpdateOTP = null;
    user.emailUpdateOtpExpiry = null;
    user.emailUpdateOtpAttempts = 0;
    user.isEmailVerified = true;
    user.isEmailChanged = true;
    await user.save();

    res.status(200).json(
      new ApiResponse(200, {
        email: user.email,
        isEmailVerified: user.isEmailVerified
      }, 'Email updated successfully')
    );
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
    }
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};

