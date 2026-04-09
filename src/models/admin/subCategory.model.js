import mongoose from 'mongoose';

const subCategorySchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', required: true },
    name: { type: String, required: true, trim: true },
    icon:{
        type: String,
        required: true,
    },

}, { timestamps: true });

const SubCategory = mongoose.models.SubCategory || mongoose.model('SubCategory', subCategorySchema);
export default SubCategory;