import mongoose from 'mongoose';

const complaintSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ['provider_behavior', 'provider_issue', 'technical_issue',
        'service_quality', 'late_arrival', 'payment_issue', 'other'],
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

// GET /api/complaint/all
// GET /api/complaint/all?status=pending
// GET /api/complaint/:id
// POST /api/complaint/:id/reply body: { reply }
// PATCH /api/complaint/:id/status body: { status }