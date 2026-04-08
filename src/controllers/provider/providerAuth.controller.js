import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import User from '../../models/User.model.js';
import { Provider } from '../../models/Provider.model.js';
import { ServiceCategory } from '../../models/ServiceCategory.model.js';
import { ServiceSubcategory } from '../../models/ServiceSubcategory.model.js';
import { sendOtpEmail } from '../../utils/emailService.js';
import { signToken } from '../../utils/jwt.js';
import { generateNumericOtp } from '../../utils/otp.js';
import { absoluteUrlForWebPath, webPathFromMulterFile } from '../../utils/publicFileUrl.js';

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

function geoPointFromLatLng(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return {
    type: 'Point',
    coordinates: [ln, la],
  };
}

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function documentsPresent(p) {
  return (
    isNonEmptyString(p.facePhoto) &&
    isNonEmptyString(p.idCardFront) &&
    isNonEmptyString(p.idCardBack) &&
    Array.isArray(p.certificates) &&
    p.certificates.length > 0
  );
}

/** Apply multipart files from multer (field names: facePhoto, idCardFront, idCardBack, certificates). */
function applyProviderUploadedFiles(req, provider) {
  const files = req.files;
  if (!files) return;
  if (files.facePhoto?.[0]) {
    provider.facePhoto = absoluteUrlForWebPath(req, webPathFromMulterFile(files.facePhoto[0]));
  }
  if (files.idCardFront?.[0]) {
    provider.idCardFront = absoluteUrlForWebPath(req, webPathFromMulterFile(files.idCardFront[0]));
  }
  if (files.idCardBack?.[0]) {
    provider.idCardBack = absoluteUrlForWebPath(req, webPathFromMulterFile(files.idCardBack[0]));
  }
  if (files.certificates?.length) {
    const urls = files.certificates.map((f) => absoluteUrlForWebPath(req, webPathFromMulterFile(f)));
    provider.certificates = [...new Set([...provider.certificates.map(String), ...urls])].filter(Boolean);
  }
}

function profileCompleteFields(p) {
  const locOk = p.location?.coordinates?.length === 2;
  const genderOk = p.gender && p.gender !== '';
  const dobOk = p.dob instanceof Date && !Number.isNaN(p.dob.getTime());
  // const catOk = !!p.serviceCategory;
  // const subsOk = Array.isArray(p.serviceSubcategories) && p.serviceSubcategories.length > 0;
  return (
    isNonEmptyString(p.fullName) &&
    isNonEmptyString(p.permanentAddress) &&
    isNonEmptyString(p.city) &&
    isNonEmptyString(p.state) &&
    isNonEmptyString(p.country) &&
    locOk &&
    genderOk &&
    dobOk 
    // catOk &&
    // subsOk
  );
}

async function assertSubcategoriesBelongToCategory(categoryId, subIds) {
  if (!subIds?.length) {
    return 'At least one service subcategory is required when updating categories.';
  }
  const unique = [...new Set(subIds.map((id) => String(id)))];
  const oids = unique.map((id) => new mongoose.Types.ObjectId(id));
  const found = await ServiceSubcategory.find({
    _id: { $in: oids },
    serviceCategory: categoryId,
    isActive: true,
  }).select('_id');
  if (found.length !== unique.length) {
    return 'One or more subcategories are invalid, inactive, or do not belong to the selected category.';
  }
  return null;
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
      role: 'provider',
      status: 'pending',
      isEmailVerified: false,
      emailOTP: otp,
      otpExpiry: new Date(Date.now() + OTP_TTL_MS),
      otpAttempts: 0,
      lastOTPSent: new Date(),
    });

    await Provider.create({ userId: user._id });
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
    // user.status = 'approved';
    await user.save();

    const token = signToken(user._id, user.role);
    const fresh = await User.findById(user._id).populate({
      path: 'providerProfile',
      populate: [
        { path: 'serviceCategory', select: 'name slug icon isActive' },
        { path: 'serviceSubcategories', select: 'name icon isActive serviceCategory' },
      ],
    });

    return res.json({
      success: true,
      message: 'Email verified successfully.',
      data: {
        token,
        user: publicUserDoc(fresh),
      },
    });
  } catch (err) {
    console.error('provider verify email:', err);
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
    console.error('provider resend otp:', err);
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

    const user = await User.findOne({ email, role: 'provider' }).select('+password').populate({
      path: 'providerProfile',
      populate: [
        { path: 'serviceCategory', select: 'name slug icon isActive' },
        { path: 'serviceSubcategories', select: 'name icon isActive serviceCategory' },
      ],
    });

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
    console.error('provider login:', err);
    return res.status(500).json({ success: false, message: err.message || 'Login failed.' });
  }
}

export async function me(req, res) {
  try {
    const user = await User.findById(req.user._id).populate({
      path: 'providerProfile',
      populate: [
        { path: 'serviceCategory', select: 'name slug icon isActive' },
        { path: 'serviceSubcategories', select: 'name icon isActive serviceCategory' },
      ],
    });
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    return res.json({ success: true, data: { user: publicUserDoc(user) } });
  } catch (err) {
    console.error('provider me:', err);
    return res.status(500).json({ success: false, message: err.message || 'Request failed.' });
  }
}

/**
 * Update provider profile (auth). Optional: name (User).
 * Body: fullName, permanentAddress, city, state, country, lat, lng, gender, dob,
 *       serviceCategory, serviceSubcategories (each sub must belong to the selected category),
 *       isDocumentCompleted,
 *       facePhoto, idCardFront, idCardBack, certificates (array of URLs), and/or the same names as multipart files (saved on server under /uploads/providers/<userId>/).
 */
export async function updateProfile(req, res) {
  try {
    const provider = await Provider.findOne({ userId: req.user._id });
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider profile not found.' });
    }
    console.log(provider,req.user._id)

    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (req.body.name != null) {
      const n = String(req.body.name).trim();
      if (n) user.name = n;
    }

    if (req.body.fullName != null) provider.fullName = String(req.body.fullName).trim();
    if (req.body.permanentAddress != null) {
      provider.permanentAddress = String(req.body.permanentAddress).trim();
    }
    if (req.body.city != null) provider.city = String(req.body.city).trim();
    if (req.body.state != null) provider.state = String(req.body.state).trim();
    if (req.body.country != null) provider.country = String(req.body.country).trim();

    if (req.body.lat !== undefined || req.body.lng !== undefined) {
      const pt = geoPointFromLatLng(req.body.lat, req.body.lng);
      if (!pt) {
        return badRequest(res, 'Valid lat and lng are required for location (lat: -90..90, lng: -180..180).');
      }
      provider.location = pt;
    }

    if (req.body.gender !== undefined) {
      const g = String(req.body.gender).trim();
      const allowed = ['male', 'female', 'other', 'prefer_not_say'];
      if (g && !allowed.includes(g)) {
        return badRequest(res, `gender must be one of: ${allowed.join(', ')}`);
      }
      provider.gender = g || '';
    }

    if (req.body.dob !== undefined) {
      const d = new Date(req.body.dob);
      if (Number.isNaN(d.getTime())) {
        return badRequest(res, 'Invalid dob.');
      }
      provider.dob = d;
    }

    if (req.body.facePhoto !== undefined) {
      provider.facePhoto = String(req.body.facePhoto || '').trim();
    }
    if (req.body.idCardFront !== undefined) {
      provider.idCardFront = String(req.body.idCardFront || '').trim();
    }
    if (req.body.idCardBack !== undefined) {
      provider.idCardBack = String(req.body.idCardBack || '').trim();
    }
    if (req.body.certificates !== undefined) {
      const raw = Array.isArray(req.body.certificates) ? req.body.certificates : [];
      provider.certificates = raw.map((x) => String(x || '').trim()).filter(Boolean);
    }

    applyProviderUploadedFiles(req, provider);

    const f = req.files;
    const docTouched =
      req.body.facePhoto !== undefined ||
      req.body.idCardFront !== undefined ||
      req.body.idCardBack !== undefined ||
      req.body.certificates !== undefined ||
      Boolean(f?.facePhoto?.length) ||
      Boolean(f?.idCardFront?.length) ||
      Boolean(f?.idCardBack?.length) ||
      Boolean(f?.certificates?.length);

    if (req.body.isDocumentCompleted !== undefined) {
      if (req.body.isDocumentCompleted === true && !documentsPresent(provider)) {
        return badRequest(
          res,
          'Provide facePhoto, idCardFront, idCardBack, and at least one certificate (URL or uploaded file) before marking documents complete.',
        );
      }
      provider.isDocumentCompleted = Boolean(req.body.isDocumentCompleted);
    } else if (documentsPresent(provider)) {
      provider.isDocumentCompleted = true;
    } else if (docTouched) {
      provider.isDocumentCompleted = false;
    }

    const catInput =
      req.body.serviceCategory ?? req.body.serviceCategoryId ?? req.body.categoryId;
    const subsInput =
      req.body.serviceSubcategories ?? req.body.serviceSubcategoryIds ?? req.body.subcategoryIds;

    if (catInput !== undefined || subsInput !== undefined) {
      let categoryId = provider.serviceCategory ? String(provider.serviceCategory) : null;

      if (catInput !== undefined) {
        categoryId = String(catInput);
        if (!mongoose.Types.ObjectId.isValid(categoryId)) {
          return badRequest(res, 'Invalid serviceCategory id.');
        }
        const cat = await ServiceCategory.findOne({ _id: categoryId, isActive: true });
        if (!cat) {
          return badRequest(res, 'Service category not found or inactive.');
        }
        provider.serviceCategory = categoryId;
        if (subsInput === undefined) {
          provider.serviceSubcategories = [];
        }
      }

      if (subsInput !== undefined) {
        if (!categoryId || !mongoose.Types.ObjectId.isValid(categoryId)) {
          return badRequest(res, 'Set serviceCategory before serviceSubcategories.');
        }
        const subIds = Array.isArray(subsInput) ? subsInput : [];
        const errSub = await assertSubcategoriesBelongToCategory(categoryId, subIds);
        if (errSub) return badRequest(res, errSub);
        provider.serviceSubcategories = subIds.map((id) => new mongoose.Types.ObjectId(String(id)));
      }
    }

    user.profileLastUpdated = new Date();
    provider.isProfileComplete = profileCompleteFields(provider);

    await user.save();
    await provider.save();

    const populatedUser = await User.findById(req.user._id).populate({
      path: 'providerProfile',
      populate: [
        { path: 'serviceCategory', select: 'name slug icon isActive' },
        { path: 'serviceSubcategories', select: 'name icon isActive serviceCategory' },
      ],
    });

    return res.json({
      success: true,
      message: 'Profile updated.',
      data: { user: publicUserDoc(populatedUser) },
    });
  } catch (err) {
    console.error('provider updateProfile:', err);
    return res.status(500).json({ success: false, message: err.message || 'Update failed.' });
  }
}

