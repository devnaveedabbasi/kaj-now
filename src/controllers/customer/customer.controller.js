import mongoose from 'mongoose';
import Category from '../../models/admin/category.model.js';
import Service from '../../models/admin/service.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const getAllCategories = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const search = req.query.search || '';
    
    let query = { 
        isActive: true,
        isDeleted: false
    };
    
    if (search) {
        query.name = { $regex: search, $options: 'i' };
    }
    
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
    
    const categoriesWithCount = await Promise.all(
        categories.map(async (category) => {
            const activeserviceCount = await Service.countDocuments({
                categoryId: category._id,
                isActive: true,
                isDeleted: false
            });
            
            return {
                ...category,
                activeserviceCount
            };
        })
    );
    
    const totalPages = Math.ceil(totalCount / limit);
    
    res.status(200).json(
        new ApiResponse(200, {
            categories: categoriesWithCount,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: totalCount,
                itemsPerPage: limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        }, 'Categories retrieved successfully')
    );
};

export const getServicesByCategory = async (req, res) => {
    const { categoryId } = req.params;
    console.log('Fetching services for category ID:', categoryId);
    
    // Validate ObjectId
    if (!mongoose.Types.ObjectId.isValid(categoryId)) {
        throw new ApiError(400, 'Invalid category ID format');
    }
     
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const search = req.query.search || '';
    
    let query = { 
        categoryId,
        isActive: true,
        isDeleted: false
    };
    
    if (search) {
        query.name = { $regex: search, $options: 'i' };
    }
    
    // Check if category exists and is active
    const category = await Category.findOne({ 
        _id: categoryId, 
        isActive: true,
        isDeleted: false
    });
    
    if (!category) {
        throw new ApiError(404, 'Category not found');
    }
    
    const sortField = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortField]: sortOrder };
    
    const [services, totalCount] = await Promise.all([
        Service.find(query)
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(),
        Service.countDocuments(query)
    ]);
    
    const totalPages = Math.ceil(totalCount / limit);
    
    res.status(200).json(
        new ApiResponse(200, {
            category,
            services,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: totalCount,
                itemsPerPage: limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        }, 'Services retrieved successfully')
    );
};