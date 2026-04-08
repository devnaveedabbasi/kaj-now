import mongoose from 'mongoose';

const walletSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true
  },
  balance: {
    type: Number,
    default: 0,
    min: 0
  },
  currency: {
    type: String,
    default: 'PKR',
    trim: true
  },
  /** Transaction history */
  transactions: [{
    type: {
      type: String,
      enum: ['credit', 'debit'],
      required: true
    },
    amount: {
      type: Number,
      required: true,
      min: 0
    },
    description: {
      type: String,
      trim: true,
      default: ''
    },
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job'
    },
    withdrawalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Withdrawal'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]
}, { timestamps: true });

export const Wallet = mongoose.models.Wallet || mongoose.model('Wallet', walletSchema);