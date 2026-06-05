import mongoose from 'mongoose';

const bookingIntentSchema = new mongoose.Schema(
  {
    tranId: {
      type: String,
      unique: true,
      index: true,
    },
    bookingData: {
      userId: mongoose.Schema.Types.ObjectId,
      serviceId: mongoose.Schema.Types.ObjectId,
      providerId: mongoose.Schema.Types.ObjectId,
      schedule: {
        date: String,
        time: String,
      },
      paymentMethod: String,
      servicePrice: Number,
      platformFee: Number,
      tranId: String,
    },
    expiresAt: {
      type: Date,
      default: () => new Date(Date.now() + 60 * 60 * 1000), // 1 hour
      index: { expireAfterSeconds: 0 }, // Auto-delete after expiry
    },
  },
  { timestamps: true }
);

const BookingIntent = mongoose.models.BookingIntent || mongoose.model('BookingIntent', bookingIntentSchema);
export default BookingIntent;