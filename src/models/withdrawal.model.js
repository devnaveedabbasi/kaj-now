// models/withdrawal.model.js
import mongoose from 'mongoose';

const withdrawalSchema = new mongoose.Schema(
  {
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // ── Amount Breakdown ─────────────────────────────────────────────────────
    requestedAmount: {
      type: Number,
      required: true,
      min: 1,
      description: 'Full amount provider wants to withdraw',
    },
    platformFeePercentage: {
      type: Number,
      required: true,
      description: 'Platform fee % at the time of request (from env)',
    },
    platformFee: {
      type: Number,
      required: true,
      min: 0,
      description: 'Platform fee deducted (% of requestedAmount)',
    },
    payableAmount: {
      type: Number,
      required: true,
      min: 0,
      description: 'Amount actually transferred to bank (requestedAmount - platformFee)',
    },

    bankDetails: {
      bankName: { type: String, required: true, trim: true },
      accountNumber: { type: String, required: true, trim: true },
      accountTitle: { type: String, required: true, trim: true },
      branchCode: { type: String, trim: true, default: '' },
    },

    // pending → completed (admin processes) OR rejected (admin rejects)
    status: {
      type: String,
      enum: ['pending', 'completed', 'rejected'],
      default: 'pending',
      index: true,
    },

    // ── Admin Proof (after bank transfer) ────────────────────────────────────
    proofMessage: {
      type: String,
      trim: true,
      default: null,
      description: 'Admin note / message sent with proof',
    },
    proofImageUrl: {
      type: String,
      trim: true,
      default: null,
      description: 'Screenshot URL of the bank transfer proof',
    },

    // ── Timestamps ───────────────────────────────────────────────────────────
    processedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, default: null },
  },
  { timestamps: true }
);

withdrawalSchema.index({ providerId: 1, status: 1 });
withdrawalSchema.index({ createdAt: -1 });

const Withdrawal = mongoose.models.Withdrawal || mongoose.model('Withdrawal', withdrawalSchema);
export default Withdrawal;