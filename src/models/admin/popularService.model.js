import mongoose from 'mongoose';

const popularServiceSchema = new mongoose.Schema(
    {
        serviceRequestId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ServiceRequest',
            required: true,
        },
        // A single ServiceRequest can bundle several real Service documents
        // (e.g. one provider listing offering Sofa Cleaning + Shelf Cleaning
        // + Sweeping together). Without this field, marking any one of them
        // popular/recommended marked the whole bundle at once. null means
        // "the request as a single unit" (custom UK services with no
        // serviceId array, or legacy single-service requests).
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

popularServiceSchema.index({ serviceRequestId: 1, serviceId: 1 }, { unique: true });

const PopularService = mongoose.model('PopularService', popularServiceSchema);

export default PopularService;
