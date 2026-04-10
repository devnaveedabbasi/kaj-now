import bcrypt from 'bcryptjs';
import User from '../../models/User.model.js';
import Provider  from '../../models/provider/Provider.model.js';
import { sendOtpEmail } from '../../utils/emailService.js';
import { signToken } from '../../utils/jwt.js';
import { generateNumericOtp } from '../../utils/otp.js';
import Category from '../../models/admin/category.model.js';
import SubCategory from '../../models/admin/subCategory.model.js';
import path from 'path';
import fs from 'fs';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';

const SALT_ROUNDS = 10;
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^(\+880|880|0)?1[3-9][0-9]{8}$/;

const deleteFile = (filePath) => {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.error('Error deleting file:', error);
  }
};

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
  const permanentAddress = String(req.body.permanentAddress || '').trim();

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
    role: 'provider',
    status: 'pending',
    isEmailVerified: false,
    emailOTP: otp,
    otpExpiry: new Date(Date.now() + OTP_TTL_MS),
    otpAttempts: 0,
    lastOTPSent: new Date(),
  });

  await Provider.create({ userId: user._id });
  await Provider.updateOne({ userId: user._id }, { permanentAddress });

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

  const user = await User.findOne({ email, role: 'provider' });

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }
  if (user.isEmailVerified) {
    throw new ApiError(400, 'Email is already verified.');
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
    throw new ApiError(400, 'Invalid OTP.');
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

  const user = await User.findOne({ email, role: 'provider' });

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }
  if (user.isEmailVerified) {
    throw new ApiError(400, 'Email is already verified.');
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

  const user = await User.findOne({ email, role: 'provider' }).select('+password');

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

  const provider = await Provider.findOne({ userId: user._id });
  if (!provider) {
    throw new ApiError(404, 'Provider profile not found. Please complete registration.');
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
          isKycCompleted: provider.isKycCompleted,
          kycStatus: provider.kycStatus,
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


export const completeProfile = async (req, res) => {
  const userId = req.user.id || req.user._id;
  const {
    gender,
    dob,
    serviceCategoryId,
    serviceSubcategoryId,
    latitude,
    longitude,
    locationName,
  } = req.body;

  // Find existing provider
  let provider = await Provider.findOne({ userId });

  if (!provider) {
    if (req.files) {
      const allFiles = [
        ...(req.files.facePhoto || []),
        ...(req.files.idCardFront || []),
        ...(req.files.idCardBack || []),
        ...(req.files.certificates || []),
      ];
      allFiles.forEach(file => {
        if (file && file.path) deleteFile(file.path);
      });
    }
    throw new ApiError(404, 'Provider not found. Please complete registration first.');
  }

  // Update location (coordinates and name)
  if (latitude && longitude) {
    provider.location = {
      type: 'Point',
      coordinates: [parseFloat(longitude), parseFloat(latitude)],
      locationName: locationName || '',
    };
  } else if (locationName && provider.location) {
    provider.location.locationName = locationName;
  }

  // Update gender
  if (gender && ['male', 'female', 'other', 'prefer_not_say'].includes(gender)) {
    provider.gender = gender;
  }

  // Update date of birth
  if (dob) {
    provider.dob = new Date(dob);
  }

  if (serviceCategoryId) {
    const category = await Category.findById(serviceCategoryId);
    if (!category) {
      if (req.files) {
        const allFiles = [
          ...(req.files.facePhoto || []),
          ...(req.files.idCardFront || []),
          ...(req.files.idCardBack || []),
          ...(req.files.certificates || []),
        ];
        allFiles.forEach(file => {
          if (file && file.path) deleteFile(file.path);
        });
      }
      throw new ApiError(404, 'Service category not found');
    }
    provider.serviceCategory = serviceCategoryId;
  }

  // Update service subcategories
  if (serviceSubcategoryId) {
    let subCategoryIds = [];

    // Handle both single ID and array of IDs
    if (Array.isArray(serviceSubcategoryId)) {
      subCategoryIds = serviceSubcategoryId;
    } else if (typeof serviceSubcategoryId === 'string') {
      subCategoryIds = [serviceSubcategoryId];
    }

    if (subCategoryIds.length > 0 && provider.serviceCategory) {
      // Verify subcategories belong to the selected category
      const subcategories = await SubCategory.find({
        _id: { $in: subCategoryIds },
        categoryId: provider.serviceCategory,
      });

      if (subcategories.length !== subCategoryIds.length) {
        if (req.files) {
          const allFiles = [
            ...(req.files.facePhoto || []),
            ...(req.files.idCardFront || []),
            ...(req.files.idCardBack || []),
            ...(req.files.certificates || []),
          ];
          allFiles.forEach(file => {
            if (file && file.path) deleteFile(file.path);
          });
        }
        throw new ApiError(400, 'Some subcategories do not belong to the selected category');
      }
      provider.serviceSubcategories = subCategoryIds;
    }
  }

  // Handle file uploads
  const files = req.files || {};

  // Upload face photo
  if (files.facePhoto && files.facePhoto[0]) {
    // Delete old file if exists
    if (provider.facePhoto) {
      const oldPath = path.join('public', provider.facePhoto);
      deleteFile(oldPath);
    }
    provider.facePhoto = `/uploads/provider/${files.facePhoto[0].filename}`;
  }

  // Upload ID card front
  if (files.idCardFront && files.idCardFront[0]) {
    if (provider.idCardFront) {
      const oldPath = path.join('public', provider.idCardFront);
      deleteFile(oldPath);
    }
    provider.idCardFront = `/uploads/provider/${files.idCardFront[0].filename}`;
  }

  // Upload ID card back
  if (files.idCardBack && files.idCardBack[0]) {
    if (provider.idCardBack) {
      const oldPath = path.join('public', provider.idCardBack);
      deleteFile(oldPath);
    }
    provider.idCardBack = `/uploads/provider/${files.idCardBack[0].filename}`;
  }

  // Upload certificates (multiple files)
  if (files.certificates && files.certificates.length > 0) {
    // Delete old certificates if they exist
    if (provider.certificates && provider.certificates.length > 0) {
      provider.certificates.forEach(cert => {
        const oldPath = path.join('public', cert);
        deleteFile(oldPath);
      });
    }
    provider.certificates = files.certificates.map(f => `/uploads/provider/${f.filename}`);
  }

  provider.isKycCompleted = true;
  provider.kycStatus = 'pending';

  // Save all changes
  await provider.save();

  // Get updated provider with populated data
  const updatedProvider = await Provider.findOne({ userId })
    .populate('Category', 'name icon')
    .populate('SubCategory', 'name icon');

  // Get user info
  const user = await User.findById(userId).select('name email phone');

  res.status(200).json(
    new ApiResponse(
      200,
      {
        user: {
          name: user.name,
          email: user.email,
          phone: user.phone,
        },
        location: updatedProvider.location,
        gender: updatedProvider.gender,
        dateOfBirth: updatedProvider.dob,
        serviceCategory: updatedProvider.serviceCategory,
        serviceSubcategories: updatedProvider.serviceSubcategories,
        documents: {
          facePhoto: updatedProvider.facePhoto ? updatedProvider.facePhoto : null,
          idCardFront: updatedProvider.idCardFront ? updatedProvider.idCardFront : null,
          idCardBack: updatedProvider.idCardBack ? updatedProvider.idCardBack : null,
          certificates: updatedProvider.certificates?.map(c => c) || [],
        },
        kycStatus: updatedProvider.kycStatus,
        isKycCompleted: updatedProvider.isKycCompleted,
      },
      'Profile completed successfully'
    )
  );
};

export async function me(req, res) {
  const user = await User.findById(req.user._id);
  if (!user) {
    throw new ApiError(404, 'User not found.');
  }
  const provider = await Provider.findOne({ userId: user._id });
  if (!provider) {
    throw new ApiError(404, 'Provider profile not found.');
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
        isKycCompleted: provider.isKycCompleted,
        kycStatus: provider.kycStatus,
      },
      'User profile retrieved successfully.'
    )
  );
}
