import mongoose from 'mongoose';

const serviceRequestSchema = new mongoose.Schema({
    providerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Provider', required: true },
    serviceId: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    status: { 
        type: String, 
        enum: ['pending', 'approved', 'rejected', 'cancelled'], 
        default: 'pending' 
    },
    requestedAt: { type: Date, default: Date.now },
    reviewedAt: { type: Date },
    reviewedByAdmin: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String, trim: true },
    rejectionReason: { type: String, trim: true },
}, { timestamps: true });

const ServiceRequest = mongoose.model('ServiceRequest', serviceRequestSchema);
export default ServiceRequest;
