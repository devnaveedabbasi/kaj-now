import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema(
  {
    jobId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Job',
      required: true,
      index: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    providerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Provider',
      required: true,
      index: true,
    },

    // ====== AMOUNT BREAKDOWN ======
    currency: {
      type: String,
      default: 'BDT',
    },
    servicePrice: {
      type: Number,
      required: true,
      min: 0,
    },
    platformFee: {
      type: Number,
      required: true,
      min: 0,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
    },
    providerAmount: {
      type: Number,
      default: 0,
      min: 0,
    },

    // ====== PAYMENT GATEWAY ======
    // 'sslcommerz' covers both card and bKash (both go through SSLCommerz)
    paymentGateway: {
      type: String,
      enum: ['sslcommerz', 'cod', 'bank_transfer', 'stripe'],
      default: 'sslcommerz',
    },

    // ====== PAYMENT METHOD ======
    // Added 'bkash' alongside existing 'card' and 'cod'
    paymentMethod: {
      type: String,
      enum: ['card', 'cod', 'bkash', 'nagad', 'rocket', 'bank'],
      default: 'card',
      index: true,
    },

    // ====== PAYMENT STATUS ======
    paymentStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
      default: 'pending',
      index: true,
    },

    returnToAdmin: {
      type: Number,
      default: 0,
    },

    // ====== ESCROW STATUS ======
    escrowStatus: {
      type: String,
      enum: [
        'pending',
        'held_in_admin_wallet',
        'pending_refund',
        'released_to_provider',
        'refunded_to_customer',
        'cod_pending',
        'cod_completed',
      ],
      default: 'pending',
      index: true,
    },

    // ====== STRIPE INTEGRATION ======
    stripePaymentIntentId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },

    // ====== SSL COMMERZ INTEGRATION ======
    // Shared across card and bKash flows
    sslCommerzReference: {
      type: String,
      trim: true,
    },
    sslCommerzTransactionId: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
    },
    sslCommerzValidation: {
      type: Boolean,
      default: false,
    },

    // ====== BKASH-SPECIFIC FIELDS ======
    bkashTransactionId: {
      type: String,
      trim: true,
      sparse: true,
      index: true,
      description: 'bKash transaction ID returned from SSLCommerz callback',
    },
    bkashNumber: {
      type: String,
      trim: true,
      description: 'Masked bKash mobile number (e.g. 017XXXX1234)',
    },

    // ====== REFUND INFO ======
    refundedAt: { type: Date },
    refundReason: { type: String, trim: true },

    // ====== MANUAL REFUND TRACKING (job cancellations) ======
    // 'not_applicable' — no money was ever collected/held for this payment (e.g. COD, still pending)
    // 'pending'        — job cancelled, money held by admin, refund owed to customer but not yet sent
    // 'completed'      — admin has manually sent the refund outside the system and marked it done
    refundStatus: {
      type: String,
      enum: ['not_applicable', 'pending', 'completed'],
      default: 'not_applicable',
      index: true,
    },
    refundMarkedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    refundMarkedAt: { type: Date, default: null },
    refundNote: { type: String, trim: true, default: null },

    // ====== PAYMENT RELEASE TO PROVIDER ======
    releasedAt: { type: Date },
    confirmedAt: { type: Date }
  },
  { timestamps: true }
);

paymentSchema.index({ jobId: 1, paymentStatus: 1 });
paymentSchema.index({ jobId: 1, escrowStatus: 1 });
paymentSchema.index({ customerId: 1, createdAt: -1 });
paymentSchema.index({ providerId: 1, escrowStatus: 1 });
paymentSchema.index({ createdAt: -1 });

const Payment = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);
export default Payment;