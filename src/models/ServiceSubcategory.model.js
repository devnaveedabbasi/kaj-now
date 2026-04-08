import mongoose from 'mongoose';

const serviceSubcategorySchema = new mongoose.Schema(
  {
    serviceCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceCategory',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    icon: { type: String, trim: true, default: '', maxlength: 2048 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

serviceSubcategorySchema.index({ serviceCategory: 1, name: 1 });

export const ServiceSubcategory =
  mongoose.models.ServiceSubcategory ||
  mongoose.model('ServiceSubcategory', serviceSubcategorySchema);
