import mongoose from 'mongoose';

const providerSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    permanentAddress: { type: String, trim: true, default: '' },

    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
      },
      locationName: { type: String, trim: true, default: '' },
    },

    gender: {
      type: String,
      enum: ['male', 'female', 'other', 'prefer_not_say', ''],
      default: '',
    },
    dob: { type: Date },

    // Provider's general working availability — set during KYC, editable
    // later from update profile. One shared time range applied across the
    // selected days (e.g. Mon/Tue/Wed, 1pm to 9pm) rather than per-day hours.
    // Defaults to every day, standard business hours, so a provider who
    // never touches this still has a sensible, real value instead of a
    // blank one — they can narrow it down later from their profile.
    availability: {
      days: {
        type: [String],
        enum: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        default: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      },
      startTime: { type: String, trim: true, default: '09:00' },
      endTime: { type: String, trim: true, default: '18:00' },
    },

    Category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
    },
    services: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ServiceRequest',
      },
    ],
    approvedServices: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Service',
      },
    ],

    // Track service orders count
    serviceOrdersCount: {
      type: Map,
      of: Number,
      default: {},
    },

    totalOrdersCompleted: {
      type: Number,
      default: 0
    },

    // BD Fields
    facePhoto: { type: String, trim: true, default: '' },
    idCardFront: { type: String, trim: true, default: '' },
    idCardBack: { type: String, trim: true, default: '' },
    // UK Fileds
    addressProof: { type: String, trim: true, default: '' },
    rightToWork: { type: String, trim: true, default: '' },
    dbsCertificate: { type: String, trim: true, default: '' },
    // Company Fields
    companyName: { type: String, trim: true, default: '' },
    companyNumber: { type: String, trim: true, default: '' },
    companyAddressProof: { type: String, trim: true, default: '' },
    directorId: { type: String, trim: true, default: '' },
    
    providerType: { type: String, enum: ['individual', 'company'], default: 'individual' },

    // Contract (UK providers only)
    contractFile: { type: String, default: '' }, // reference copy of the global agreement, snapshotted at KYC-approval time
    signedContractFile: { type: String, default: '' }, // provider-uploaded signed copy
    contractStatus: { type: String, enum: ['not_required', 'pending', 'signed', 'approved', 'rejected'], default: 'not_required' },
    signatureImage: { type: String, default: '' }, // legacy in-app drawn signature, kept for backward compatibility
    agreedToTerms: { type: Boolean, default: false },
    contractSignedAt: { type: Date },
    contractApprovedAt: { type: Date },
    contractRejectionReason: { type: String, trim: true, default: '' },
    contractRejectedAt: { type: Date },

    certificates: { type: [String], default: [] },

    isKycCompleted: {
      type: Boolean,
      default: false
    },
    kycStatus: {
      type: String,
      enum: ["pending", "approved", "suspended", "rejected"],
      default: "pending"
    },
    kycRejectionReason: {
      type: String,
      trim: true,
      default: ''
    },
    bankDetails: {
      accountHolderName: { type: String, trim: true, default: '' },
      bankName: { type: String, trim: true, default: '' },
      accountNumber: { type: String, trim: true, default: '' },
      branchCode: { type: String, trim: true, default: '' },
    },
  },
  { timestamps: true }
);

// Method to increment service order count
// `serviceId` is undefined for a custom UK service (no backing Service
// document to key the per-template breakdown against) — still count it
// toward totalOrdersCompleted, just skip the per-service map entry.
providerSchema.methods.incrementServiceOrderCount = async function (serviceId) {
  if (serviceId) {
    const currentCount = this.serviceOrdersCount.get(serviceId.toString()) || 0;
    this.serviceOrdersCount.set(serviceId.toString(), currentCount + 1);
  }
  this.totalOrdersCompleted += 1;
  await this.save();
  return serviceId ? this.serviceOrdersCount.get(serviceId.toString()) : undefined;
};

// Method to get service order count
providerSchema.methods.getServiceOrderCount = function (serviceId) {
  if (!serviceId) return 0;
  return this.serviceOrdersCount.get(serviceId.toString()) || 0;
};

providerSchema.pre('save', function clearInvalidLocation() {
  const loc = this.location;
  if (loc && typeof loc === 'object' && (!Array.isArray(loc.coordinates) || loc.coordinates.length !== 2)) {
    this.set('location', undefined);
  }
});

providerSchema.index({ location: '2dsphere' }, { sparse: true });
providerSchema.index({ approvedServices: 1, kycStatus: 1 });

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

providerSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret) {
    return attachLatLng(ret);
  },
});
providerSchema.set('toObject', {
  virtuals: true,
  transform(_doc, ret) {
    return attachLatLng(ret);
  },
});

const Provider = mongoose.models.Provider || mongoose.model('Provider', providerSchema);
export default Provider;