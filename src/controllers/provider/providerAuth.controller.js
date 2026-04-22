import bcrypt from 'bcryptjs';
import User from '../../models/User.model.js';
import Provider  from '../../models/provider/Provider.model.js';
import { sendOtpEmail } from '../../service/emailService.js';
import { signToken } from '../../utils/jwt.js';
import { generateNumericOtp } from '../../utils/otp.js';
import Category from '../../models/admin/category.model.js';
import Service from '../../models/admin/service.model.js';
import path from 'path';
import fs from 'fs';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import ServiceRequest from '../../models/admin/serviceRequest.model.js';
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
  user.token=token;
await user.save();
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
  user.token=token;
await user.save();
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
    serviceIds,
    latitude,
    longitude,
    locationName,
    permanentAddress,
  } = req.body;

  const files = req.files || {};

  // REQUIRED VALIDATION
  if (!gender) throw new ApiError(400, "Gender is required");
  if (!dob) throw new ApiError(400, "Date of birth is required");
  if (!serviceCategoryId) throw new ApiError(400, "Service category is required");
  if (!serviceIds) throw new ApiError(400, "Services are required");
  if (!latitude || !longitude) throw new ApiError(400, "Location coordinates are required");

  // GENDER VALIDATION
  const allowedGenders = ["male", "female", "other", "prefer_not_say"];
  if (!allowedGenders.includes(gender)) {
    throw new ApiError(400, "Invalid gender value");
  }

  // DOB VALIDATION (accurate age check)
  const parsedDob = new Date(dob);
  if (isNaN(parsedDob.getTime())) {
    throw new ApiError(400, "Invalid date of birth");
  }

  const today = new Date();
  let age = today.getFullYear() - parsedDob.getFullYear();
  const m = today.getMonth() - parsedDob.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < parsedDob.getDate())) {
    age--;
  }

  if (age < 18) {
    throw new ApiError(400, "You must be at least 18 years old");
  }

  // LOCATION VALIDATION
  const lat = parseFloat(latitude);
  const lng = parseFloat(longitude);

  if (isNaN(lat) || lat < -90 || lat > 90) {
    throw new ApiError(400, "Invalid latitude");
  }

  if (isNaN(lng) || lng < -180 || lng > 180) {
    throw new ApiError(400, "Invalid longitude");
  }

  // FILE VALIDATION
  const requiredFiles = ["facePhoto", "idCardFront", "idCardBack"];

  for (let field of requiredFiles) {
    if (!files[field] || !files[field][0]) {
      throw new ApiError(400, `${field} is required`);
    }
  }

  // FIND USER & PROVIDER
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, "User not found");

  const provider = await Provider.findOne({ userId });
  if (!provider) throw new ApiError(404, "Provider not found");

  // CATEGORY VALIDATION
  const category = await Category.findById(serviceCategoryId);
  if (!category) throw new ApiError(404, "Invalid category");

  // SERVICES VALIDATION
  let serviceIdArray = Array.isArray(serviceIds) ? serviceIds : [serviceIds];

  const services = await Service.find({
    _id: { $in: serviceIdArray },
    categoryId: serviceCategoryId,
  });

  if (services.length !== serviceIdArray.length) {
    throw new ApiError(400, "Invalid services for selected category");
  }

  // OPTIONAL: check duplicates request
  const existingRequests = await ServiceRequest.find({
    providerId: provider._id,
    serviceId: { $in: serviceIdArray },
    status: { $in: ["pending", "approved"] },
  });

  if (existingRequests.length > 0) {
    throw new ApiError(400, "Service request already exists");
  }

  // CREATE SERVICE REQUEST (ONLY ONCE VALIDATION PASSED)
  await ServiceRequest.create({
    providerId: provider._id,
    serviceId: serviceIdArray,
    categoryId: serviceCategoryId,
  });

  // UPDATE PROVIDER
  const uploadPath = "/uploads/provider/";

  provider.gender = gender;
  provider.dob = parsedDob;
  provider.Category = serviceCategoryId;
  provider.services = serviceIdArray;

  if (permanentAddress) {
    provider.permanentAddress = permanentAddress;
  }

  provider.location = {
    type: "Point",
    coordinates: [lng, lat],
    locationName: locationName || "",
  };

  provider.facePhoto = `${uploadPath}${files.facePhoto[0].filename}`;
  provider.idCardFront = `${uploadPath}${files.idCardFront[0].filename}`;
  provider.idCardBack = `${uploadPath}${files.idCardBack[0].filename}`;

  if (files.certificates?.length > 0) {
    provider.certificates = files.certificates.map(
      (f) => `${uploadPath}${f.filename}`
    );
  }

  provider.isKycCompleted = true;
  provider.kycStatus = "pending";

  await provider.save();

  // UPDATE USER
  user.location = {
    type: "Point",
    coordinates: [lng, lat],
    locationName: locationName || "",
  };

  user.profileLastUpdated = new Date();

  await user.save();

  await provider.populate("Category", "name icon");
  await provider.populate("services", "name icon price");

  res.status(200).json(
    new ApiResponse(
      200,
      {
        provider,
        user,
      },
      "Profile completed successfully"
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
        profilePicture:user.profilePicture,
        status: user.status,
        providerId: provider._id,
        dob: provider.dob,
        gender: provider.gender,
        isKycCompleted: provider.isKycCompleted,
        kycStatus: provider.kycStatus,
        location: provider.location,
      },
      'User profile retrieved successfully.'
    )
  );
}


export const updateProfile = async (req, res) => {
  try {
    const userId = req.user._id;
    const { name, email, phone, permanentAddress, dob, gender, location } = req.body;
    const files = req.files || {};

    // Find user and provider
    const user = await User.findById(userId);
    if (!user) {
      throw new ApiError(404, 'User not found');
    }

    const provider = await Provider.findOne({ userId });
    if (!provider) {
      throw new ApiError(404, 'Provider not found');
    }

    // Update User fields (jo bhi aayega update karo)
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
      await provider.save();
      
      return res.status(202).json(
        new ApiResponse(202, {
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
      user.profilePicture = `/uploads/provider/${files.profilePicture[0].filename}`;
    }

    // Update Provider fields
    if (gender) {
      const allowedGenders = ['male', 'female', 'other', 'prefer_not_say'];
      if (!allowedGenders.includes(gender)) {
        throw new ApiError(400, 'Invalid gender');
      }
      provider.gender = gender;
    }

    if (dob) {
      const parsedDob = new Date(dob);
      if (isNaN(parsedDob.getTime())) {
        throw new ApiError(400, 'Invalid date');
      }
      if(dob==!provider.dob){
      provider.dob = parsedDob;
    }}

    if (permanentAddress) {
      provider.permanentAddress = permanentAddress;
    }

    if (location) {
      // location should be JSON string
      const parsedLocation = typeof location === 'string' ? JSON.parse(location) : location;
      provider.location = parsedLocation;
      user.location = parsedLocation;
    }

    await user.save();
    await provider.save();

    res.status(200).json(
      new ApiResponse(200, {
        user: {
          _id: user._id,
          name: user.name,
          email: user.email,
          phone: user.phone,
          profilePicture: user.profilePicture
        },
        provider: {
          gender: provider.gender,
          dob: provider.dob,
          permanentAddress: provider.permanentAddress,
          location: provider.location
        }
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


export const logout = async (req, res) => {
  try {
    const userId = req.user._id;

    const user = await User.findById(userId);

    if (!user) {
      throw new ApiError(404, "User not found");
    }

    user.token = null;
    await user.save();

    return res.status(200).json(
      new ApiResponse(200, null, "Logged out successfully")
    );
  } catch (error) {
    return res.status(500).json(
      new ApiResponse(500, null, error.message)
    );
  }
};