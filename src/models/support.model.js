import mongoose from 'mongoose';

const supportMessageSchema = new mongoose.Schema(
  {
    // roomId = customer/provider ka User._id (har user ka apna unique support room)
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    senderRole: {
      type: String,
      enum: ['customer', 'provider', 'admin'],
      required: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    message: {
      type: String,
      required: true,
      trim: true,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: {
      type: Date,
      default: null,
    },
    // WhatsApp-style: sirf apni side se delete
    deletedFor: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
    ],
  },
  { timestamps: true }
);

supportMessageSchema.index({ roomId: 1, createdAt: 1 });
supportMessageSchema.index({ receiverId: 1, isRead: 1 });

const SupportMessage = mongoose.models.SupportMessage || mongoose.model('SupportMessage', supportMessageSchema);
export default SupportMessage;

// admin chat routes

// GET /api/support/conversations?role=customer
// GET /api/support/conversations?role=provider
// GET /api/support/history/:userId
// GET /api/support/admin-unread

// DELETE /api/support/history/:userId