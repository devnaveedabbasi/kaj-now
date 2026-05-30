import mongoose from 'mongoose';

const popularServiceSchema = new mongoose.Schema(
    {
        serviceRequestId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'ServiceRequest',
            required: true,
        },
    },
    { timestamps: true }
);

popularServiceSchema.index({ serviceRequestId: 1 }, { unique: true });

const PopularService = mongoose.model('PopularService', popularServiceSchema);

export default PopularService;
