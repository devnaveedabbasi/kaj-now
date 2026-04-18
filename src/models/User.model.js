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
  profilePicture: { type: String, default: null },
  isEmailVerified: { type: Boolean, default: false },
  emailOTP: { type: String },
  otpExpiry: { type: Date },
  otpAttempts: { type: Number, default: 0 },
  token: { type: String, default: null },
  resetOTP: String,          // forgot password
  resetOtpExpiry: Date,
  resetOtpAttempts: { type: Number, default: 0 },
  resetPasswordVerified: { type: Boolean, default: false },
 location: {
  type: {
    type: String,
    enum: ['Point'],
    default: 'Point',      
  },
  coordinates: {
    type: [Number],
    default: [0, 0],       
  },
  locationName: { type: String, trim: true, default: '' },
},

  lastOTPSent: { type: Date },
  profileLastUpdated: { type: Date },


}, {
  timestamps: true,
  toJSON: { virtuals: true }
});

userSchema.index({ location: '2dsphere' }, { sparse: true });

function attachLatLng(ret) {
  if (ret.location?.coordinates?.length === 2) {
    const [lng, lat] = ret.location.coordinates;
    ret.location = {
      type: 'Point',
      lat,
      lng,
      coordinates: [lng, lat],
    };
  }
  return ret;
}


userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

userSchema.add({
  pendingNewEmail: { type: String, default: null },
  emailUpdateOTP: { type: String, default: null },
  emailUpdateOtpExpiry: { type: Date, default: null },
  emailUpdateOtpAttempts: { type: Number, default: 0 },
  isEmailChanged: { type: Boolean, default: false }
});

const User = mongoose.models.User || mongoose.model('User', userSchema);
export default User;