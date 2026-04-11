import mongoose from 'mongoose';

const serviceSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    name: { type: String, required: true, trim: true },
    icon: {
        type: String,
        required: true,
    },
    price: { type: Number, required: true },
    description: { type: String, trim: true, default: '' },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    reviews: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Review' }],
}, { timestamps: true });

const Service = mongoose.model('Service', serviceSchema);
export default Service;