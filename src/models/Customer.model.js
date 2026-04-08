import mongoose from 'mongoose';

const customerSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    favoriteProviders: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    totalBookings: { type: Number, default: 0 },

    // Location data
    permanentAddress: { type: String, trim: true, default: '' },
    city: { type: String, trim: true, default: '' },
    state: { type: String, trim: true, default: '' },
    country: { type: String, trim: true, default: '' },

    /** GeoJSON Point: coordinates are [longitude, latitude]. */
    location: {
      type: {
        type: String,
        enum: ['Point'],
      },
      coordinates: {
        type: [Number],
      },
    },
}, { timestamps: true });

export const Customer = mongoose.model('Customer', customerSchema);