import mongoose from 'mongoose';

const reviewSchema = new mongoose.Schema({
    service: { type: mongoose.Schema.Types.ObjectId, ref: 'Service', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    rating: { 
        type: Number, 
        required: true,
        default: 3,
        min: 1,
        max: 5
    },
    comment: { type: String, trim: true },
}, { timestamps: true });

// Ensure one review per user per service
reviewSchema.index({ service: 1, userId: 1 }, { unique: true });

// FIXED: This line was incorrect
const Review = mongoose.model('Review', reviewSchema);
export default Review;