import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema(
    {
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },

        // Which market this category belongs to. Defaults to BD so every
        // existing category (created before this field existed) is treated
        // as Bangladesh, matching current behavior exactly.
        region: {
            type: String,
            enum: ['UK', 'BD'],
            default: 'BD',
            index: true,
        },

        name: {
            type: String,
            required: true,
            trim: true,
        },

        icon: {
            type: String,
            required: true,
        },

        isActive: {
            type: Boolean,
            default: true,
            index: true,
        },

        isDeleted: {
            type: Boolean,
            default: false,
            index: true,
        },
    },
    { timestamps: true }
);

categorySchema.index({ userId: 1, name: 1 }, { unique: true });

const Category = mongoose.model('Category', categorySchema);

export default Category;