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
    contractFile: { type: String, default: '' },
    contractStatus: { type: String, enum: ['not_required', 'pending', 'signed', 'approved'], default: 'not_required' },
    signatureImage: { type: String, default: '' },
    agreedToTerms: { type: Boolean, default: false },
    contractSignedAt: { type: Date },
    contractApprovedAt: { type: Date },

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
providerSchema.methods.incrementServiceOrderCount = async function (serviceId) {
  const currentCount = this.serviceOrdersCount.get(serviceId.toString()) || 0;
  this.serviceOrdersCount.set(serviceId.toString(), currentCount + 1);
  this.totalOrdersCompleted += 1;
  await this.save();
  return this.serviceOrdersCount.get(serviceId.toString());
};

// Method to get service order count
providerSchema.methods.getServiceOrderCount = function (serviceId) {
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