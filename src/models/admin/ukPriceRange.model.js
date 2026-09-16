import mongoose from 'mongoose';

// A single, global price range for the entire UK side — not per service.
// Admin sets it once here; every UK service a provider adds (template-based
// or custom) is validated against this same range.
const ukPriceRangeSchema = new mongoose.Schema({
    region: { type: String, enum: ['UK'], default: 'UK', unique: true },
    minPrice: { type: Number, required: true, min: 0 },
    maxPrice: { type: Number, required: true, min: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
}, { timestamps: true });

const UkPriceRange = mongoose.model('UkPriceRange', ukPriceRangeSchema);
export default UkPriceRange;
