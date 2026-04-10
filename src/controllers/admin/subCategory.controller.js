import Category from '../../models/admin/category.model.js';
import SubCategory from '../../models/admin/subCategory.model.js';
import fs from 'fs';
import path from 'path';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';

// Helper function to delete old image
const deleteOldImage = (imagePath) => {
    try {
        if (imagePath && fs.existsSync(imagePath)) {
            fs.unlinkSync(imagePath);
        }
    } catch (error) {
        console.error('Error deleting old image:', error);
    }
};

// Create SubCategory
export const createSubCategory = async (req, res) => {
    const { name, categoryId } = req.body;
    const userId = req.user._id;

    if (!name || !categoryId) {
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        throw new ApiError(400, 'Name and categoryId are required');
    }

    // Check if category exists
    const category = await Category.findOne({ _id: categoryId, userId });
    if (!category) {
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        throw new ApiError(404, 'Category not found');
    }

    // Check if subcategory already exists
    const existingSubCategory = await SubCategory.findOne({
        userId,
        categoryId,
        name: { $regex: new RegExp(`^${name}$`, 'i') }
    });

    if (existingSubCategory) {
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        throw new ApiError(409, 'SubCategory already exists in this category');
    }

    const subCategoryData = {
        userId,
        categoryId,
        name,
        icon: req.file ? `/uploads/subcategories/${req.file.filename}` : null,
    };

    const subCategory = await SubCategory.create(subCategoryData);
    
    // Populate category details
    await subCategory.populate('categoryId', 'name icon');

    res.status(201).json(
        new ApiResponse(201, subCategory, 'SubCategory created successfully')
    );
};

// Get All SubCategories (Admin) - with Pagination, Search, Filters
export const getAllSubCategories = async (req, res) => {
    const userId = req.user._id;
    
    // Pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    // Search parameter
    const search = req.query.search || '';
    
    // Filter parameters
    const { categoryId, isActive, isDeleted } = req.query;
    
    // Build query
    let query = { userId };
    
    // Add category filter
    if (categoryId) {
        query.categoryId = categoryId;
    }
    
    // Add search condition
    if (search) {
        query.name = { $regex: search, $options: 'i' };
    }
    
    // Add filters
    if (isActive !== undefined && isActive !== '') {
        query.isActive = isActive === 'true';
    }
    
    if (isDeleted !== undefined && isDeleted !== '') {
        query.isDeleted = isDeleted === 'true';
    }
    
    // Sorting
    const sortField = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortField]: sortOrder };
    
    // Execute queries
    const [subCategories, totalCount] = await Promise.all([
        SubCategory.find(query)
            .populate('categoryId', 'name icon isActive isDeleted')
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(),
        SubCategory.countDocuments(query)
    ]);
    
    // Pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;
    
    res.status(200).json(
        new ApiResponse(200, {
            subCategories,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: totalCount,
                itemsPerPage: limit,
                hasNextPage,
                hasPrevPage
            },
            filters: {
                search: search || null,
                categoryId: categoryId || null,
                isActive: isActive || null,
                isDeleted: isDeleted || null,
                sortBy: sortField,
                sortOrder: req.query.sortOrder || 'desc'
            }
        }, 'SubCategories retrieved successfully')
    );
};

// Get Single SubCategory (Admin)
export const getSubCategoryById = async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    const subCategory = await SubCategory.findOne({ _id: id, userId })
        .populate('categoryId', 'name icon isActive isDeleted');

    if (!subCategory) {
        throw new ApiError(404, 'SubCategory not found');
    }

    res.status(200).json(
        new ApiResponse(200, subCategory, 'SubCategory retrieved successfully')
    );
};

// Update SubCategory
export const updateSubCategory = async (req, res) => {
    const { id } = req.params;
    const { name, categoryId } = req.body;
    const userId = req.user._id;

    const subCategory = await SubCategory.findOne({ _id: id, userId });

    if (!subCategory) {
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        throw new ApiError(404, 'SubCategory not found');
    }

    // If categoryId is being changed, verify new category exists
    if (categoryId && categoryId !== subCategory.categoryId.toString()) {
        const category = await Category.findOne({ _id: categoryId, userId });
        if (!category) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            throw new ApiError(404, 'New category not found');
        }
        subCategory.categoryId = categoryId;
    }

    // Check if new name conflicts
    if (name && name !== subCategory.name) {
        const existingSubCategory = await SubCategory.findOne({
            userId,
            categoryId: subCategory.categoryId,
            name: { $regex: new RegExp(`^${name}$`, 'i') },
            _id: { $ne: id },
        });
        if (existingSubCategory) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            throw new ApiError(409, 'SubCategory name already exists in this category');
        }
        subCategory.name = name;
    }

    // Update image if new file uploaded
    if (req.file) {
        if (subCategory.icon) {
            const oldImagePath = path.join('public', subCategory.icon);
            deleteOldImage(oldImagePath);
        }
        subCategory.icon = `/uploads/subcategories/${req.file.filename}`;
    }

    await subCategory.save();
    await subCategory.populate('categoryId', 'name icon');

    res.status(200).json(
        new ApiResponse(200, subCategory, 'SubCategory updated successfully')
    );
};

// Toggle SubCategory Active Status
export const toggleSubCategoryActive = async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    const subCategory = await SubCategory.findOne({ _id: id, userId });

    if (!subCategory) {
        throw new ApiError(404, 'SubCategory not found');
    }

    subCategory.isActive = !subCategory.isActive;
    await subCategory.save();

    res.status(200).json(
        new ApiResponse(200, { 
            _id: subCategory._id, 
            isActive: subCategory.isActive 
        }, `SubCategory ${subCategory.isActive ? 'activated' : 'deactivated'} successfully`)
    );
};

// Soft Delete SubCategory
export const softDeleteSubCategory = async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    const subCategory = await SubCategory.findOne({ _id: id, userId });

    if (!subCategory) {
        throw new ApiError(404, 'SubCategory not found');
    }

    if (subCategory.isDeleted) {
        throw new ApiError(400, 'SubCategory is already deleted');
    }

    subCategory.isDeleted = true;
    subCategory.isActive = false;
    await subCategory.save();

    res.status(200).json(
        new ApiResponse(200, {}, 'SubCategory deleted successfully')
    );
};

// Restore SubCategory (from soft delete)
export const restoreSubCategory = async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    const subCategory = await SubCategory.findOne({ _id: id, userId, isDeleted: true });

    if (!subCategory) {
        throw new ApiError(404, 'Deleted subcategory not found');
    }

    subCategory.isDeleted = false;
    subCategory.isActive = true;
    await subCategory.save();

    res.status(200).json(
        new ApiResponse(200, subCategory, 'SubCategory restored successfully')
    );
};

// Permanently Delete SubCategory (Hard Delete)
export const hardDeleteSubCategory = async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    const subCategory = await SubCategory.findOne({ _id: id, userId });

    if (!subCategory) {
        throw new ApiError(404, 'SubCategory not found');
    }

    // Delete subcategory image
    if (subCategory.icon) {
        const imagePath = path.join('public', subCategory.icon);
        deleteOldImage(imagePath);
    }

    await SubCategory.deleteOne({ _id: id, userId });

    res.status(200).json(
        new ApiResponse(200, {}, 'SubCategory permanently deleted successfully')
    );
};

// Get SubCategories by Category (with filters)
export const getSubCategoriesByCategory = async (req, res) => {
    const { categoryId } = req.params;
    const userId = req.user._id;
    
    // Pagination for this specific endpoint
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const { includeInactive, includeDeleted } = req.query;
    
    // Build query
    let query = { userId, categoryId };
    
    if (includeInactive !== 'true') {
        query.isActive = true;
    }
    
    if (includeDeleted !== 'true') {
        query.isDeleted = false;
    }

    // Verify category exists
    const category = await Category.findOne({ _id: categoryId, userId });
    if (!category) {
        throw new ApiError(404, 'Category not found');
    }

    const [subCategories, totalCount] = await Promise.all([
        SubCategory.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        SubCategory.countDocuments(query)
    ]);
    
    const totalPages = Math.ceil(totalCount / limit);
    
    res.status(200).json(
        new ApiResponse(200, {
            category,
            subCategories,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: totalCount,
                itemsPerPage: limit
            }
        }, 'SubCategories retrieved successfully')
    );
};