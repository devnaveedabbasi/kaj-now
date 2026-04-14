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
    
    // ====== AMOUNT BREAKDOWN (10% platform fee, 90% for provider) ======
    servicePrice: {
      type: Number,
      required: true,
      min: 0,
      description: 'Base service price'
    },
    platformFee: {
      type: Number,
      required: true,
      min: 0,
      description: 'Admin platform fee (10% of servicePrice)'
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
      description: 'Total amount charged to customer (usually = servicePrice)'
    },
    providerAmount: {
      type: Number,
      default: 0,
      min: 0,
      description: 'Amount provider will receive (90% of servicePrice)'
    },
    
    // ====== PAYMENT GATEWAY ======
    paymentGateway: {
      type: String,
      enum: ['sslcommerz', 'manual', 'wallet'],
      default: 'sslcommerz',
    },
    
    // ====== PAYMENT STATUS (gateway payment confirmation) ======
    // pending → completed (when payment gateway confirms)
    paymentStatus: {
      type: String,
      enum: ['pending', 'processing', 'completed', 'failed', 'refunded'],
      default: 'pending',
      index: true,
    },
    
    // ====== ESCROW STATUS (payment flow in our system) ======
    // pending → held_in_admin_wallet → released_to_provider OR refunded_to_customer
    escrowStatus: {
      type: String,
      enum: ['pending', 'held_in_admin_wallet', 'released_to_provider', 'refunded_to_customer'],
      default: 'pending',
      index: true,
      description: 'Tracks where the payment is held/moved'
    },
    
    // ====== SSL COMMERZ INTEGRATION ======
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

    // ====== REFUND INFO ======
    refundedAt: {
      type: Date,
    },
    refundReason: {
      type: String,
      trim: true,
      description: 'Reason for refund (provider_rejected, dispute_resolution, etc.)'
    },
    
    // ====== PAYMENT RELEASE TO PROVIDER ======
    releasedAt: {
      type: Date,
      description: 'When payment was released to provider wallet'
    },
    
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
