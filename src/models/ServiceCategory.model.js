import mongoose from 'mongoose';

const serviceCategorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, trim: true, sparse: true },
    description: { type: String, trim: true, default: '' },
    /** Image URL (CDN) or app icon key, e.g. "lucide:wrench" */
    icon: { type: String, trim: true, default: '', maxlength: 2048 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

serviceCategorySchema.index({ name: 1 });

export const ServiceCategory =
  mongoose.models.ServiceCategory || mongoose.model('ServiceCategory', serviceCategorySchema);
