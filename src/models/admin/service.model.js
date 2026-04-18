import mongoose from 'mongoose';

const serviceSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    name: { type: String, required: true, trim: true ,unique: true,minlength: 4, maxlength: 100},
    icon: {
        type: String,
        required: true,
    },
    price: { type: Number, required: true },
    description: { type: String, trim: true ,minlength: 10, maxlength: 200},
    isActive: { type: Boolean, default: true },
    isDeleted: { type: Boolean, default: false },
    reviews: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Review' }], 
    averageRating: { type: Number, default: 0 },
}, { timestamps: true });

// Method to update average rating
serviceSchema.methods.updateAverageRating = async function() {
    const result = await mongoose.model('Review').aggregate([
        { $match: { service: this._id } },
        { $group: {
            _id: null,
            average: { $avg: '$rating' },
            count: { $sum: 1 }
        }}
    ]);
    
    this.averageRating = result.length > 0 ? Math.round(result[0].average * 10) / 10 : 0;
    await this.save();
    return this.averageRating;
};

const Service = mongoose.model('Service', serviceSchema);
export default Service;