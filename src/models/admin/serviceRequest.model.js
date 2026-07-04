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
    region: {
        type: String,
        enum: ['UK', 'BD'],
        default: 'BD',
        index: true,
    },
    // ── UK flow only ─────────────────────────────────────────────────
    // UK services are admin-created templates (title + category + icon) —
    // the provider fills in the rest of the listing here (see `ukService`).
    // `isCustomService` additionally lets a UK provider skip the template
    // entirely and propose a brand new service — their own title and cover
    // photo too, not just price/description.
    // All optional and left unset for BD requests — zero effect there.
    // Required-ness of these fields is enforced in the controller (not
    // here), since it depends on isCustomService vs template mode, not on
    // anything this subdocument itself knows.
    isCustomService: { type: Boolean, default: false },
    ukService: {
        title: { type: String, trim: true, minlength: 3, maxlength: 100 },
        serviceImage: { type: String },
        price: { type: Number, min: 0 },
        description: { type: String, trim: true, maxlength: 1000 },
        subServices: [
            {
                name: { type: String, trim: true },
                price: { type: Number },
            }
        ],
        estimatedTime: { type: String, trim: true },
        availability: [{ type: String, trim: true }],
    },
}, { timestamps: true });

serviceRequestSchema.index({ providerId: 1, status: 1 });
serviceRequestSchema.index({ serviceId: 1, status: 1 });

const ServiceRequest = mongoose.model('ServiceRequest', serviceRequestSchema);
export default ServiceRequest;
