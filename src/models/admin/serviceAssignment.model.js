import mongoose from 'mongoose';

const serviceAssignmentSchema = new mongoose.Schema({
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    assignedAt: { type: Date, default: Date.now },
    assignedByAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    isActive: { type: Boolean, default: true },
    deactivatedAt: { type: Date },
    deactivationReason: { type: String, trim: true },
}, { timestamps: true });

// Index to prevent duplicate assignments
serviceAssignmentSchema.index({ providerId: 1, serviceId: 1 }, { unique: true });

const ServiceAssignment = mongoose.model('ServiceAssignment', serviceAssignmentSchema);
export default ServiceAssignment;
