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

    // ── UK service-template flow only ──────────────────────────────────
    // For UK, the admin-created Service is just a title+category template;
    // the provider supplies the actual listing details here. All optional
    // and left unset for BD requests — zero effect on existing behavior.
    price: { type: Number, min: 0 },
    description: { type: String, trim: true },
    images: [{ type: String }],
    availability: { type: String, trim: true },
}, { timestamps: true });

serviceRequestSchema.index({ providerId: 1, status: 1 });
serviceRequestSchema.index({ serviceId: 1, status: 1 });

const ServiceRequest = mongoose.model('ServiceRequest', serviceRequestSchema);
export default ServiceRequest;
