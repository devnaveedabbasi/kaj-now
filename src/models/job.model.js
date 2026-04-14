// models/job.model.js
import mongoose from 'mongoose';

const jobSchema = new mongoose.Schema(
  {
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
    // ====== JOB STATUS FLOW ======
    // pending → accepted → in_progress → completed_by_provider → confirmed_by_user → closed
    // Alternative: → rejected_by_provider (triggers refund)
    // Alternative: → disputed → resolved
    status: {
      type: String,
      enum: [
        'pending',                    // Booking created, payment held in admin wallet
        'accepted',                   // Provider accepted the booking
        'in_progress',                // Provider started the work
        'completed_by_provider',      // Provider marked as completed
        'confirmed_by_user',          // User confirmed completion, payment released with fee deduction
        'rejected_by_provider',       // Provider rejected - full refund to user
        'disputed',                   // User disputed the completion
        'resolved',                   // Admin resolved the dispute
        'closed'                      // Job is closed
      ],
      default: 'pending',
      index: true,
    },
    // ====== TIMESTAMPS ======
    acceptedAt: Date,
    startedAt: Date,
    completedByProviderAt: Date,
    confirmedByUserAt: Date,
    rejectedByProviderAt: Date,
    disputedAt: Date,
    resolvedAt: Date,
    closedAt: Date,
    
    // ====== AMOUNT & CURRENCY ======
    amount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    currency: {
      type: String,
      default: 'BDT',
      trim: true,
    },
    
    // ====== PAYMENT STATUS (escrow-based) ======
    // pending → held_in_escrow → released_to_provider OR refunded_to_customer
    paymentStatus: {
      type: String,
      enum: ['pending', 'held_in_escrow', 'released_to_provider', 'refunded_to_customer'],
      default: 'pending',
    },
    
    // ====== REJECTION/DISPUTE REASON ======
    rejectionReason: String,
    rejectionRejectedAt: Date,
    disputeReason: String,
    
    // ====== LOCATION INFO ======
    serviceLocation: {
      name: String,
      phoneNumber: String,
      coordinates: {
        latitude: Number,
        longitude: Number,
      },
    },
    scheduledAt: Date,
  },
  { timestamps: true }
);

// Define all indexes here to avoid duplicates
jobSchema.index({ provider: 1, status: 1 });
jobSchema.index({ customer: 1, status: 1 });
jobSchema.index({ provider: 1, completedByProviderAt: 1 });
jobSchema.index({ paymentStatus: 1 });
jobSchema.index({ createdAt: -1 });

 const Job = mongoose.models.Job || mongoose.model('Job', jobSchema);
 export default Job;