import mongoose from 'mongoose';

const serviceSchema = new mongoose.Schema(
  {
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Provider',
      required: true,
      index: true,
    },
    serviceCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceCategory',
      required: true,
      index: true,
    },
    serviceSubcategories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ServiceSubcategory',
      },
    ],
    name: { type: String, required: true, trim: true },
    price: { type: Number, required: true, min: 0 },
    /** Estimated service duration in minutes */
    durationMinutes: { type: Number, required: true, min: 1 },
    description: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

serviceSchema.index({ provider: 1, isActive: 1 });

serviceSchema.set('toJSON', {
  virtuals: true,
  transform(_doc, ret) {
    ret.time = ret.durationMinutes;
    return ret;
  },
});

export const Service = mongoose.models.Service || mongoose.model('Service', serviceSchema);
