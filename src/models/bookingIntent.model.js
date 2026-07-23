// models/BookingIntent.model.js
import mongoose from 'mongoose';

const bookingIntentSchema = new mongoose.Schema({
  tranId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  orderId: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'User' },
  providerId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Provider' },
  serviceId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'Service' },
  servicePrice: { type: Number, required: true },
  platformFee: { type: Number, required: true },
  providerAmount: { type: Number, required: true },

  paymentMethod: {
    type: String,
    enum: ['card', 'bkash', 'nagad', 'rocket', 'bank'],
    required: true,
  },

  paymentGateway: {
    type: String,
    enum: ['sslcommerz', 'stripe'],
    default: 'sslcommerz',
  },

  // Lifecycle status of this intent
  status: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'cancelled'],
    default: 'pending',
    index: true,
  },

  schedule: {
    date: { type: Date, required: true },
    time: { type: String, required: true },
  },

  // Stored only for card (for direct-charge fallback logging)
  cardDetails: {
    cardNumber: String,
    expiryDate: String,
    cardHolderName: String,
    cvv: String,
  },

  // UK only — snapshot of sub-services chosen at booking time.
  // Stored here so the Stripe webhook can write them to Job.subServices
  // without re-querying the ServiceRequest.
  // Empty array = no sub-services selected (fully optional).
  selectedSubServices: [
    {
      name: { type: String },
      price: { type: Number },
    }
  ],

  // 1-hour TTL — MongoDB auto-deletes after expiry
  expiresAt: {
    type: Date,
    default: () => new Date(Date.now() + 60 * 60 * 1000),
  },

  createdAt: { type: Date, default: Date.now },
});

// Auto-cleanup expired intents via MongoDB TTL
bookingIntentSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Prevent model recompilation error on hot-reload
const BookingIntent =
  mongoose.models.BookingIntent ||
  mongoose.model('BookingIntent', bookingIntentSchema);

export default BookingIntent;