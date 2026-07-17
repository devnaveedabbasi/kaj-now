import mongoose from 'mongoose';

const complaintTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    },
    order: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

complaintTypeSchema.index({ order: 1 });

const ComplaintType = mongoose.models.ComplaintType || mongoose.model('ComplaintType', complaintTypeSchema);
export default ComplaintType;
