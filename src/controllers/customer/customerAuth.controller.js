import bcrypt from 'bcryptjs';
import User from '../../models/User.model.js';
import { Customer } from '../../models/Customer.model.js';
import { sendOtpEmail } from '../../utils/emailService.js';
import { signToken } from '../../utils/jwt.js';
import { generateNumericOtp } from '../../utils/otp.js';

const SALT_ROUNDS = 10;
const OTP_TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_OTP_ATTEMPTS = 5;

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function badRequest(res, message) {
  return res.status(400).json({ success: false, message });
}

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

    if (!name || !email || !phone || !password) {
      return badRequest(res, 'Name, email, phone, and password are required.');
    }
    
    if (!emailRegex.test(email)) {
      return badRequest(res, 'Invalid email address.');
    }
    if (password.length < 8) {
      return badRequest(res, 'Password must be at least 8 characters.');
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
      role: 'customer',
      status: 'pending',
      isEmailVerified: false,
      emailOTP: otp,
      otpExpiry: new Date(Date.now() + OTP_TTL_MS),
      otpAttempts: 0,
      lastOTPSent: new Date(),
    });

    await Customer.create({ userId: user._id });

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
    console.error('customer register:', err);
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

    const user = await User.findOne({ email, role: 'customer' });

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

    const user = await User.findOne({ email, role: 'customer' });

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

    const user = await User.findOne({ email, role: 'customer' }).select('+password');

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

    if (['blocked', 'suspended'].includes(user.status)) {
      return res.status(403).json({ success: false, message: 'Account is not active.' });
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
        user: publicUserDoc(user),
      },
    });
  } catch (err) {
    console.error('customer login:', err);
    return res.status(500).json({ success: false, message: err.message || 'Login failed.' });
  }
}

export async function me(req, res) {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.json({ success: true, data: { user: publicUserDoc(user) } });
  } catch (err) {
    console.error('customer me:', err);
    return res.status(500).json({ success: false, message: err.message || 'Request failed.' });
  }
}




