import mongoose from 'mongoose';

const serviceSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Which market this service belongs to. Defaults to BD so every
    // existing service (created before this field existed) is treated
    // as Bangladesh, matching current behavior exactly.
    region: { type: String, enum: ['UK', 'BD'], default: 'BD', index: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    name: { type: String, required: true, trim: true, unique: true, minlength: 4, maxlength: 100 },
    // UK services are just templates (icon + title + category) — the provider
    // fills in price/description/images/etc themselves on their ServiceRequest.
    // BD services keep the original full-listing requirements untouched.
    icon: {
        type: String,
        required: true,
    },
    serviceImage: {
        type: String,
        required: function () { return this.region !== 'UK'; },
    },
    price: {
        type: Number,
        required: function () { return this.region !== 'UK'; },
    },
    description: { type: String, trim: true, minlength: 10, maxlength: 1000 },
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    reviews: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Review' }],
    averageRating: { type: Number, default: 3 },
    subServices: [
        {
            name: { type: String, required: true, trim: true },
            price: { type: Number, required: true },
        }
    ],
}, { timestamps: true });

// Method to update average rating
serviceSchema.methods.updateAverageRating = async function () {
    const result = await mongoose.model('Review').aggregate([
        { $match: { service: this._id } },
        {
            $group: {
                _id: null,
                average: { $avg: '$rating' },
                count: { $sum: 1 }
            }
        }
    ]);

    const averageRating = result.length > 0
        ? Math.round(result[0].average * 10) / 10
        : 0;

    await mongoose.model('Service').findByIdAndUpdate(
        this._id,
        { $set: { averageRating } },
        { runValidators: false }
    );

    this.averageRating = averageRating;

    return averageRating;
};

const Service = mongoose.model('Service', serviceSchema);
export default Service;