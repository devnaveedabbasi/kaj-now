import Category from '../../models/admin/category.model.js';
import Service from '../../models/admin/service.model.js';
import ServiceRequest from '../../models/admin/serviceRequest.model.js';
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


// Create Category
export const createCategory = async (req, res) => {
    const { name, region } = req.body;
    const userId = req.user._id;

    if (!name) {
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        throw new ApiError(400, 'Category name is required');
    }

    if (region && !['UK', 'BD'].includes(region)) {
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        throw new ApiError(400, 'Invalid region');
    }

    const existingCategory = await Category.findOne({
        userId,
        name: { $regex: new RegExp(`^${name}$`, 'i') }
    });

    if (existingCategory) {
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        throw new ApiError(409, 'Category already exists');
    }

    const categoryData = {
        userId,
        name,
        region: region || 'BD',
        icon: req.file ? `/uploads/categories/${req.file.filename}` : null,
    };

    const category = await Category.create(categoryData);

    res.status(201).json(
        new ApiResponse(201, category, 'Category created successfully')
    );
};

// Get All Categories  with Pagination, Search, Filters
export const getAllCategories = async (req, res) => {
    const userId = req.user._id;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const search = req.query.search || '';
    const { isActive, isDeleted, region } = req.query;

    let query = { userId };

    if (region && ['UK', 'BD'].includes(region)) {
        query.region = region;
    }

    // 🔍 Search filter
    if (search) {
        query.name = { $regex: search, $options: 'i' };
    }

    //  FIX: Proper boolean parsing
    if (isActive !== undefined) {
        query.isActive = isActive === 'true';
    }

    if (isDeleted !== undefined) {
        query.isDeleted = isDeleted === 'true';
    } else {
        // default: hide deleted
        query.isDeleted = false;
    }

    // 🔽 Sorting
    const sortField = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortField]: sortOrder };

    const [categories, totalCount] = await Promise.all([
        Category.find(query)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(),
        Category.countDocuments(query)
    ]);

    // 📊 Summary
    const regionFilter = query.region ? { region: query.region } : {};
    const [totalCategories, activeCategories, totalServices] =
        await Promise.all([
            Category.countDocuments({ userId, ...regionFilter, isDeleted: false }),
            Category.countDocuments({ userId, ...regionFilter, isActive: true, isDeleted: false }),
            Service.countDocuments({ userId, ...regionFilter, isDeleted: false })
        ]);

    const deletedCategories = await Category.countDocuments({
        userId,
        ...regionFilter,
        isDeleted: true
    });

    // ⚡ Optimized (avoid N+1 queries)
    const categoriesWithCount = await Promise.all(
        categories.map(async (category) => {
            const [serviceCount, activeServiceCount] = await Promise.all([
                Service.countDocuments({
                    userId,
                    categoryId: category._id
                }),
                Service.countDocuments({
                    userId,
                    categoryId: category._id,
                    isActive: true,
                    isDeleted: false
                })
            ]);

            return {
                ...category,
                serviceCount,
                activeServiceCount
            };
        })
    );

    const totalPages = Math.ceil(totalCount / limit);

    res.status(200).json(
        new ApiResponse(200, {
            summary: {
                totalCategories,
                activeCategories,
                deletedCategories,
                totalServices
            },

            categories: categoriesWithCount,

            pagination: {
                currentPage: page,
                totalPages,
                totalItems: totalCount,
                itemsPerPage: limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            },

            filters: {
                search: search || null,
                isActive: isActive ?? null,
                isDeleted: isDeleted ?? null,
                sortBy: sortField,
                sortOrder: req.query.sortOrder || 'desc'
            }
        }, 'Categories retrieved successfully')
    );
};

export const getCategoryById = async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    const category = await Category.findOne({ _id: id, userId });

    if (!category) {
        throw new ApiError(404, 'Category not found');
    }

    // Get all subcategories for this category (including deleted/inactive)
    const subCategories = await Service.find({
        userId,
        categoryId: category._id
    }).sort({ createdAt: -1 });

    const subCategoriesStats = {
        total: subCategories.length,
        active: subCategories.filter(sc => sc.isActive && !sc.isDeleted).length,
        inactive: subCategories.filter(sc => !sc.isActive && !sc.isDeleted).length,
        deleted: subCategories.filter(sc => sc.isDeleted).length
    };

    res.status(200).json(
        new ApiResponse(200, {
            category,
            subCategories,
            subCategoriesStats
        }, 'Category retrieved successfully')
    );
};

// Update Category
export const updateCategory = async (req, res) => {
    const { id } = req.params;
    const { name } = req.body;
    const userId = req.user._id;

    const category = await Category.findOne({ _id: id, userId });

    if (!category) {
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        throw new ApiError(404, 'Category not found');
    }

    // Check if new name conflicts
    if (name && name !== category.name) {
        const existingCategory = await Category.findOne({
            userId,
            name: { $regex: new RegExp(`^${name}$`, 'i') },
            _id: { $ne: id }
        });
        if (existingCategory) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            throw new ApiError(409, 'Category name already exists');
        }
        category.name = name;
    }

    // Update image if new file uploaded
    if (req.file) {
        if (category.icon) {
            const oldImagePath = path.join('public', category.icon);
            deleteOldImage(oldImagePath);
        }
        category.icon = `/uploads/categories/${req.file.filename}`;
    }

    await category.save();

    res.status(200).json(
        new ApiResponse(200, category, 'Category updated successfully')
    );
};

// Toggle Category Active Status
export const toggleCategoryActive = async (req, res) => {
    const { id } = req.params;

    const category = await Category.findById(id);
    if (!category) throw new Error("Not found");

    const newStatus = !category.isActive;

    // 1. update category
    category.isActive = newStatus;
    await category.save();

    // 2. update services
    await Service.updateMany(
        { categoryId: id },
        { isActive: newStatus }
    );

    // 3. update service requests
    await ServiceRequest.updateMany(
        { categoryId: id, status: "pending" },
        {
            status: newStatus ? "pending" : "admin_deactivated",
            notes: newStatus
                ? "Category activated"
                : "Category deactivated",
        }
    );

    res.json({ success: true });
};

// Soft Delete Category
export const softDeleteCategory = async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    const category = await Category.findOne({ _id: id, userId });

    if (!category) {
        throw new ApiError(404, 'Category not found');
    }

    if (category.isDeleted) {
        throw new ApiError(400, 'Category already deleted');
    }

    // 1. delete category
    category.isDeleted = true;
    category.isActive = false;
    await category.save();

    // 2. delete all services
    await Service.updateMany(
        { categoryId: category._id },
        {
            isDeleted: true,
            isActive: false
        }
    );

    // 3. cancel related requests
    await ServiceRequest.updateMany(
        {
            categoryId: category._id,
            status: { $in: ['pending', 'approved'] }
        },
        {
            status: 'admin_deactivated',
            notes: 'Category deleted by admin'
        }
    );

    res.status(200).json(
        new ApiResponse(200, {}, 'Category deleted successfully')
    );
};

// Permanently Delete Category (Hard Delete)
export const hardDeleteCategory = async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    const category = await Category.findOne({ _id: id, userId });

    if (!category) {
        throw new ApiError(404, 'Category not found');
    }

    // Delete category image
    if (category.icon) {
        const imagePath = path.join('public', category.icon);
        deleteOldImage(imagePath);
    }

    // Hard delete all subcategories under this category
    const subCategories = await Service.find({ userId, categoryId: category._id });
    for (const service of subCategories) {
        if (service.icon) {
            const imagePath = path.join('public', service.icon);
            deleteOldImage(imagePath);
        }
    }
    await Service.deleteMany({ userId, categoryId: category._id });

    // Hard delete category
    await Category.deleteOne({ _id: category._id });

    res.status(200).json(
        new ApiResponse(200, {}, 'Category permanently deleted successfully')
    );
};