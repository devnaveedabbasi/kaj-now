import mongoose from 'mongoose';

const jobSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      unique: true,
      index: true,
    },

    provider: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Provider',
      required: true,
      index: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    service: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Service', 
      required: true,
    },
    serviceRequestId: {  
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
    },

    amount: {
      type: Number,
      required: true,
      min: 0,
    },

    status: {
      type: String,
      enum: [
        'pending',
        'accepted',
        'rejected_by_provider',
        'in_progress',
        'completed_by_provider',
        'confirmed_by_user',
        'disputed',
        'cancelled',
      ],
      default: 'pending',
      index: true,
    },

    paymentStatus: {
      type: String,
      enum: [
        'pending',
        'held_in_escrow',
        'released_to_provider',
        'refunded_to_customer',
        'refunded',
      ],
      default: 'pending',
    },

    acceptedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedByProviderAt: { type: Date, default: null },
    confirmedByUserAt: { type: Date, default: null },
    disputedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },

    rejectionReason: { type: String, trim: true, default: null },
    disputeReason: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

jobSchema.index({ customer: 1, status: 1 });
jobSchema.index({ provider: 1, status: 1 });
jobSchema.index({ createdAt: -1 });

const Job = mongoose.models.Job || mongoose.model('Job', jobSchema);
export default Job;