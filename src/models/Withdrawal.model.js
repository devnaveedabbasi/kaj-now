import mongoose from 'mongoose';

const withdrawalSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  currency: {
    type: String,
    default: 'PKR',
    trim: true
  },
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'rejected'],
    default: 'pending',
    index: true
  },
  /** Payment method details */
  paymentMethod: {
    type: {
      type: String,
      enum: ['bank_transfer', 'easypaisa', 'jazzcash', 'other'],
      required: true
    },
    accountDetails: {
      type: String,
      trim: true,
      default: ''
    }
  },
  /** Admin processing notes */
  adminNotes: {
    type: String,
    trim: true,
    default: ''
  },
  /** When admin processes the withdrawal */
  processedAt: { type: Date },
  /** When admin completes the withdrawal */
  completedAt: { type: Date },
  /** Rejection reason */
  rejectionReason: {
    type: String,
    trim: true,
    default: ''
  }
}, { timestamps: true });

export const Withdrawal = mongoose.models.Withdrawal || mongoose.model('Withdrawal', withdrawalSchema);