import mongoose from 'mongoose';

/**
 * Provider job / booking record. Customer booking flow should create & update these.
 * Dashboard stats aggregate from this collection.
 */
const jobSchema = new mongoose.Schema(
  {
    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Provider',
      required: true,
      index: true,
    },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'in_progress', 'completed', 'cancelled'],
      default: 'pending',
      index: true,
    },
    acceptedAt: { type: Date },
    /** Provider earning for this job when status is completed */
    amount: { type: Number, required: true, min: 0, default: 0 },
    currency: { type: String, default: 'PKR', trim: true },
    completedAt: { type: Date },
    title: { type: String, trim: true, default: '' },
    /** Payment status */
    paymentStatus: {
      type: String,
      enum: ['pending', 'paid', 'refunded'],
      default: 'pending',
      index: true,
    },
    /** Job description/details */
    description: { type: String, trim: true, default: '' },
    /** Scheduled date/time for the job */
    scheduledAt: { type: Date },
    /** Service location details provided by customer at booking time */
    serviceLocation: {
      name: { type: String, trim: true, required: true },
      phoneNumber: { type: String, trim: true, required: true },
      houseNumber: { type: String, trim: true, required: true },
      address: { type: String, trim: true, required: true },
      city: { type: String, trim: true, required: true },
      postalCode: { type: String, trim: true, required: true },
      coordinates: {
        latitude: { type: Number, required: true },
        longitude: { type: Number, required: true },
      },
    },
  },
  { timestamps: true }
);

jobSchema.index({ provider: 1, status: 1 });
jobSchema.index({ provider: 1, completedAt: 1 });

export const Job = mongoose.models.Job || mongoose.model('Job', jobSchema);
