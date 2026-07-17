import mongoose from 'mongoose';

const complaintSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    complaintType: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ComplaintType',
      required: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'seen'],
      default: 'pending',
    },
    adminReply: {
      type: String,
      default: null,
    },
    repliedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

complaintSchema.index({ status: 1, createdAt: -1 });

const Complaint = mongoose.models.Complaint || mongoose.model('Complaint', complaintSchema);
export default Complaint;

