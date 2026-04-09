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
const SALT_ROUNDS = 10;
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^(\+92|0)?3[0-9]{9}$|^(\+880|0)?1[3-9][0-9]{8}$/;

function badRequest(res, message) {
  return res.status(400).json({ success: false, message });
}
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
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const phone = String(req.body.phone || '').trim();
    const password = String(req.body.password || '');
    const permanentAddress = String(req.body.permanentAddress || '').trim();

    if (!name || !email || !phone || !password) {
      return badRequest(res, 'Name, email, phone, and password are required.');
    }

    if (!emailRegex.test(email)) {
      return badRequest(res, 'Invalid email address.');
    }
    if (password.length < 8) {
      return badRequest(res, 'Password must be at least 8 characters.');
    }

    if (!phoneRegex.test(phone)) {
      return badRequest(res, 'Only Pakistan and Bangladesh phone numbers are allowed.');
    }

    const existing = await User.findOne({
      $or: [{ email }, { phone }],
    }).select('_id email phone isEmailVerified');

    if (existing) {
      if (existing.email === email) {
        if (!existing.isEmailVerified) {
          return res.status(409).json({
            success: false,
            message:
              'This email is already registered but not verified. Use resend OTP or verify your email.',
            code: 'EMAIL_UNVERIFIED',
          });
        }
        return res.status(409).json({
          success: false,
          message: 'Email already registered.',
        });
      }
      return res.status(409).json({
        success: false,
        message: 'Phone number already registered.',
      });
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

    return res.status(201).json({
      success: true,
      message: 'Account created. Enter the OTP sent to your email.',
      data: {
        userId: user._id,
        email: user.email,
        expiresInMinutes: OTP_TTL_MS / 60000,
      },
    });
  } catch (err) {
    console.error('provider register:', err);
    return res.status(500).json({ success: false, message: err.message || 'Registration failed.' });
  }
}

export async function verifyEmail(req, res) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const otp = String(req.body.otp || '').trim();

    if (!email || !otp) {
      return badRequest(res, 'Email and OTP are required.');
    }

    const user = await User.findOne({ email, role: 'provider' });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    if (user.isEmailVerified) {
      return res.status(400).json({ success: false, message: 'Email is already verified.' });
    }

    if (user.otpAttempts >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        message: 'Too many failed attempts. Request a new OTP.',
      });
    }

    if (!user.emailOTP || !user.otpExpiry || user.otpExpiry < new Date()) {
      user.otpAttempts += 1;
      await user.save();
      return res.status(400).json({
        success: false,
        message: 'OTP expired or invalid. Request a new OTP.',
      });
    }

    if (user.emailOTP !== otp) {
      user.otpAttempts += 1;
      await user.save();
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    user.isEmailVerified = true;
    user.emailOTP = undefined;
    user.otpExpiry = undefined;
    user.otpAttempts = 0;
    user.status = 'approved';
    await user.save();

    const token = signToken(user._id, user.role);

    const fresh = await User.findById(user._id);
    return res.json({
      success: true,
      message: 'Email verified successfully.',
      data: {
        token,
        user: publicUserDoc(fresh),
      },
    });
  } catch (err) {
    console.error('verify email:', err);
    return res.status(500).json({ success: false, message: err.message || 'Verification failed.' });
  }
}

export async function resendOtp(req, res) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!email) {
      return badRequest(res, 'Email is required.');
    }

    const user = await User.findOne({ email, role: 'provider' });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    if (user.isEmailVerified) {
      return res.status(400).json({ success: false, message: 'Email is already verified.' });
    }

    if (user.lastOTPSent && Date.now() - user.lastOTPSent.getTime() < RESEND_COOLDOWN_MS) {
      const waitSec = Math.ceil(
        (RESEND_COOLDOWN_MS - (Date.now() - user.lastOTPSent.getTime())) / 1000
      );
      return res.status(429).json({
        success: false,
        message: `Please wait ${waitSec} seconds before requesting another OTP.`,
      });
    }

    const otp = generateNumericOtp(4);
    await setEmailOtp(user, otp);
    await sendOtpEmail(email, otp);

    return res.json({
      success: true,
      message: 'A new OTP has been sent to your email.',
      data: { expiresInMinutes: OTP_TTL_MS / 60000 },
    });
  } catch (err) {
    console.error('resend otp:', err);
    return res.status(500).json({ success: false, message: err.message || 'Could not resend OTP.' });
  }
}

export async function login(req, res) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    if (!email || !password) {
      return badRequest(res, 'Email and password are required.');
    }

    const user = await User.findOne({ email, role: 'provider' }).select('+password');

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (!user.isEmailVerified) {
      return res.status(403).json({
        success: false,
        message: 'Please verify your email before logging in.',
        code: 'EMAIL_NOT_VERIFIED',
      });
    }

    const allowedStatuses = ['approved'];
    if (!allowedStatuses.includes(user.status)) {
      return res.status(403).json({
        success: false,
        message: `Account not authorized. Current status: ${user.status}`
      });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    user.password = undefined;
    const token = signToken(user._id, user.role);

    return res.json({
      success: true,
      message: 'Login successful.',
      data: {
        token,
        user: {
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          status: user.status
        },
      },
    });
  } catch (err) {
    console.error('provider login:', err);
    return res.status(500).json({ success: false, message: err.message || 'Login failed.' });
  }
}



export async function forgotPassword(req, res) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!email) return badRequest(res, 'Email is required.');

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    const otp = generateNumericOtp(4);

    user.resetOTP = otp;
    user.resetOtpExpiry = new Date(Date.now() + OTP_TTL_MS);
    user.resetOtpAttempts = 0;
    user.lastOTPSent = new Date();

    await user.save();
    await sendOtpEmail(email, otp);

    return res.json({
      success: true,
      message: 'Reset OTP sent to email.',
    });
  } catch (err) {
    console.error('forgot password:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function verifyResetOtp(req, res) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const otp = String(req.body.otp || '').trim();

    if (!email || !otp) {
      return badRequest(res, 'Email and OTP are required.');
    }

    const user = await User.findOne({ email });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (user.resetOtpAttempts >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({
        success: false,
        message: 'Too many attempts. Request new OTP.',
      });
    }

    if (!user.resetOTP || !user.resetOtpExpiry || user.resetOtpExpiry < new Date()) {
      user.resetOtpAttempts += 1;
      await user.save();
      return badRequest(res, 'OTP expired or invalid.');
    }

    if (user.resetOTP !== otp) {
      user.resetOtpAttempts += 1;
      await user.save();
      return badRequest(res, 'Invalid OTP.');
    }

    //  OTP verified
    user.resetOTP = undefined;
    user.resetOtpExpiry = undefined;
    user.resetOtpAttempts = 0;

    // temp flag
    user.resetPasswordVerified = true;

    await user.save();

    return res.json({
      success: true,
      message: 'OTP verified successfully.',
    });
  } catch (err) {
    console.error('verify reset otp:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}



export async function setNewPassword(req, res) {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const newPassword = String(req.body.newPassword || '');

    if (!email || !newPassword) {
      return badRequest(res, 'Email and new password are required.');
    }

    if (newPassword.length < 8) {
      return badRequest(res, 'Password must be at least 8 characters.');
    }

    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (!user.resetPasswordVerified) {
      return res.status(403).json({
        success: false,
        message: 'OTP verification required.',
      });
    }

    // Check if new password is same as current password
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: 'New password cannot be the same as your current password.'
      });
    }

    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);

    user.password = hashed;
    user.resetPasswordVerified = false;

    await user.save();

    return res.json({
      success: true,
      message: 'Password reset successfully.',
    });
  } catch (err) {
    console.error('set new password:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}

export async function changePassword(req, res) {
  try {
    const userId = req.user._id;

    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');

    if (!currentPassword || !newPassword) {
      return badRequest(res, 'Current and new password are required.');
    }

    if (newPassword.length < 8) {
      return badRequest(res, 'New password must be at least 8 characters.');
    }

    const user = await User.findById(userId).select('+password');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Verify current password
    const match = await bcrypt.compare(currentPassword, user.password);
    if (!match) {
      return res.status(400).json({ success: false, message: 'Current password is incorrect.' });
    }

    // Check if new password is same as current password
    const isSamePassword = await bcrypt.compare(newPassword, user.password);
    if (isSamePassword) {
      return res.status(400).json({
        success: false,
        message: 'New password cannot be the same as your current password.'
      });
    }

    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);

    user.password = hashed;
    await user.save();

    return res.json({
      success: true,
      message: 'Password changed successfully.',
    });
  } catch (err) {
    console.error('change password:', err);
    return res.status(500).json({ success: false, message: err.message });
  }
}


export const completeProfile = async (req, res) => {
  try {
    const userId = req.user.id||req.user._id;
    console.log('Complete profile request body:', req.body);
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
      return res.status(404).json({ 
        success: false, 
        message: 'Provider not found. Please complete registration first.' 
      });
    }

    
   // Update location (coordinates and name)
    if (latitude && longitude) {
      provider.location = {
        type: 'Point',
        coordinates: [parseFloat(longitude), parseFloat(latitude)],
        locationName: locationName || ''  // Fix: Save locationName inside location object
      };
    } else if (locationName && provider.location) {
      // If only locationName is provided but coordinates exist
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
        // Delete uploaded files if category not found
        if (req.files) {
          const allFiles = [
            ...(req.files.facePhoto || []),
            ...(req.files.idCardFront || []),
            ...(req.files.idCardBack || []),
            ...(req.files.certificates || [])
          ];
          allFiles.forEach(file => {
            if (file && file.path) deleteFile(file.path);
          });
        }
        return res.status(404).json({ 
          success: false, 
          message: 'Service category not found' 
        });
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
          categoryId: provider.serviceCategory
        });
        
        if (subcategories.length !== subCategoryIds.length) {
          // Delete uploaded files if validation fails
          if (req.files) {
            const allFiles = [
              ...(req.files.facePhoto || []),
              ...(req.files.idCardFront || []),
              ...(req.files.idCardBack || []),
              ...(req.files.certificates || [])
            ];
            allFiles.forEach(file => {
              if (file && file.path) deleteFile(file.path);
            });
          }
          return res.status(400).json({ 
            success: false, 
            message: 'Some subcategories do not belong to the selected category' 
          });
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

    // Save all changes
    await provider.save();

    // Get updated provider with populated data
    const updatedProvider = await Provider.findOne({ userId })
      .populate('Category', 'name icon')
      .populate('SubCategory', 'name icon');

    // Get user info
    const user = await User.findById(userId).select('name email phone');

    return res.status(200).json({
      success: true,
      message: 'Profile completed successfully',
      data: {
        user: {
          name: user.name,
          email: user.email,
          phone: user.phone
        },
        location: updatedProvider.location,
        gender: updatedProvider.gender,
        dateOfBirth: updatedProvider.dob,
        serviceCategory: updatedProvider.serviceCategory,
        serviceSubcategories: updatedProvider.serviceSubcategories,
        documents: {
          facePhoto: updatedProvider.facePhoto ? `${updatedProvider.facePhoto}` : null,
          idCardFront: updatedProvider.idCardFront ? `${updatedProvider.idCardFront}` : null,
          idCardBack: updatedProvider.idCardBack ? `${updatedProvider.idCardBack}` : null,
          certificates: updatedProvider.certificates?.map(c => `${c}`) || []
        },
        kycStatus: updatedProvider.kycStatus,
        isKycCompleted: updatedProvider.isKycStatus
      }
    });
  } catch (error) {
    if (req.files) {
      const allFiles = [
        ...(req.files.facePhoto || []),
        ...(req.files.idCardFront || []),
        ...(req.files.idCardBack || []),
        ...(req.files.certificates || [])
      ];
      allFiles.forEach(file => {
        if (file && file.path) deleteFile(file.path);
      });
    }
    console.error('Complete profile error:', error);
    return res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
};





export async function me(req, res) {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }


    return res.json({
      success: true, data: {
        user: {
          name: user.name,
          email: user.email,
          role: user.role,
          phone: user.phone,
          status: user.status
        }
      }
    });
  } catch (err) {
    console.error('provider me:', err);
    return res.status(500).json({ success: false, message: err.message || 'Request failed.' });
  }
}
