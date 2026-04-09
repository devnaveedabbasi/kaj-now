// models/User.model.js
import mongoose from 'mongoose';

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true, unique: true },
  password: { type: String, required: true, select: false },
  role: {
    type: String,
    enum: ['customer', 'provider', 'admin'],
    required: true
  },
  status: {
    type: String,
    enum: ["pending", "approved", "blocked", "suspended"],
    default: "pending"
  },

  isEmailVerified: { type: Boolean, default: false },
  emailOTP: { type: String },
  otpExpiry: { type: Date },
  otpAttempts: { type: Number, default: 0 },

  resetOTP: String,          // forgot password
  resetOtpExpiry: Date,
  resetOtpAttempts: { type: Number, default: 0 },
  resetPasswordVerified: { type: Boolean, default: false },

  
  lastOTPSent: { type: Date },
  profileLastUpdated: { type: Date },
  fcmToken: {
    type: String,
    default: null
  },

}, {
  timestamps: true,
  toJSON: { virtuals: true }
});


userSchema.virtual('customerProfile', {
  ref: 'Customer',
  localField: '_id',
  foreignField: 'userId',
  justOne: true
});

userSchema.virtual('providerProfile', {
  ref: 'Provider',
  localField: '_id',
  foreignField: 'userId',
  justOne: true
});

userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });



const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;