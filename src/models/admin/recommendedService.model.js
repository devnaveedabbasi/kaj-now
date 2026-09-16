import mongoose from 'mongoose';

const recommendedServiceSchema = new mongoose.Schema(
    {
        serviceRequestId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ServiceRequest',
            required: true,
        },
        // See popularService.model.js — same per-sub-service distinction.
        serviceId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null,
        },
        region: {
            type: String,
            enum: ['UK', 'BD'],
            default: 'BD'
        }
    },
    { timestamps: true }
);

recommendedServiceSchema.index({ serviceRequestId: 1, serviceId: 1 }, { unique: true });

const RecommendedService = mongoose.model('RecommendedService', recommendedServiceSchema);

export default RecommendedService;