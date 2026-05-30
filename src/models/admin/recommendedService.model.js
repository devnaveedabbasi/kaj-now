import mongoose from 'mongoose';

const recommendedServiceSchema = new mongoose.Schema(
    {
        serviceRequestId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ServiceRequest',
            required: true,
        },
    },
    { timestamps: true }
);

recommendedServiceSchema.index({ serviceRequestId: 1 }, { unique: true });

const RecommendedService = mongoose.model('RecommendedService', recommendedServiceSchema);

export default RecommendedService;