import mongoose from 'mongoose';

const serviceRequestSchema = new mongoose.Schema({
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true },
serviceId: [{
  type: mongoose.Schema.Types.ObjectId,
  ref: "Service"
}],
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    status: { 
        type: String, 
        enum: ['pending', 'approved', 'rejected', 'cancelled', 'admin_deactivated'], 
        default: 'pending' 
    },
    requestedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date },
    reviewedByAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true },
    rejectionReason: { type: String, trim: true },
}, { timestamps: true });

serviceRequestSchema.index({ providerId: 1, status: 1 });
serviceRequestSchema.index({ serviceId: 1, status: 1 });

const ServiceRequest = mongoose.model('ServiceRequest', serviceRequestSchema);
export default ServiceRequest;
