import mongoose from 'mongoose';

const withdrawalSchema = new mongoose.Schema(
  {
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Provider',
      required: true,
      index: true,
    },

    requestedAmount: {
      type: Number,
      required: true,
      min: 1,
    },


    bankDetails: {
      bankName: { type: String, required: true, trim: true },
      accountNumber: { type: String, required: true, trim: true },
      accountTitle: { type: String, required: true, trim: true },
      branchCode: { type: String, trim: true, default: '' },
    },

    status: {
      type: String,
      enum: ['pending', 'completed', 'rejected'],
      default: 'pending',
      index: true,
    },
  receiptImage: {
      type: String,
      trim: true,
      default: null,
    },
    receiptFileName: {
      type: String,
      trim: true,
      default: null,
    },
    
    transactionId: {
      type: String,
      trim: true,
      default: null,
    },
    invoiceUrl: {
      type: String,
      trim: true,
      default: null,
    },
    adminNotes: {
      type: String,
      trim: true,
      default: null,
    },

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