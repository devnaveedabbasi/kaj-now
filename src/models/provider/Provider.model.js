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

    /** Document URLs: external or from this API (/uploads/...) after Multer save on PATCH profile. */
    facePhoto: { type: String, trim: true, default: '' },
    idCardFront: { type: String, trim: true, default: '' },
    idCardBack: { type: String, trim: true, default: '' },
    certificates: { type: [String], default: [] },

   
    isKycCompleted: {
      type: Boolean,
      default: false
    },
    kycStatus: {
      type: String,
      enum: ["pending", "approved", "suspended","rejected"],
      default: "pending"
    },
  },
  { timestamps: true }
);

/** Avoid persisting invalid GeoJSON (2dsphere rejects Point without coordinates). */
providerSchema.pre('save', function clearInvalidLocation() {
  const loc = this.location;
  if (loc && typeof loc === 'object' && (!Array.isArray(loc.coordinates) || loc.coordinates.length !== 2)) {
    this.set('location', undefined);
  }
});

providerSchema.index({ location: '2dsphere' }, { sparse: true });

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