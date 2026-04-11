import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { type: Number, required: true },
    comment: { type: String, trim: true },
}, { timestamps: true });

const Review =mongoose.model('Review', reviewSchema);
export default Review;