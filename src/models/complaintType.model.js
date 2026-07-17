import mongoose from 'mongoose';

const complaintTypeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: true,
    }
  },
  { timestamps: true }
);

const ComplaintType = mongoose.models.ComplaintType || mongoose.model('ComplaintType', complaintTypeSchema);
export default ComplaintType;
