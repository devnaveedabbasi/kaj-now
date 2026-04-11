import Category from '../../models/admin/category.model.js';
import Service from '../../models/admin/service.model.js';
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

// Create service
export const createService = async (req, res) => {
    const { name, categoryId, price, description } = req.body;
    const userId = req.user._id;

    // Validation
    if (!name || !categoryId || !price) {
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        throw new ApiError(400, 'Name, categoryId and price are required');
    }

    if (price < 0) {
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        throw new ApiError(400, 'Price cannot be negative');
    }

    // Check if category exists and belongs to user
    const category = await Category.findOne({ _id: categoryId, userId, isDeleted: false });
    if (!category) {
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        throw new ApiError(404, 'Category not found');
    }

    // Check if service already exists in same category
    const existingService = await Service.findOne({
        userId,
        categoryId,
        name: { $regex: new RegExp(`^${name}$`, 'i') },
        isDeleted: false
    });

    if (existingService) {
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        throw new ApiError(409, 'Service already exists in this category');
    }

    const serviceData = {
        userId,
        categoryId,
        name,
        price: Number(price),
        description: description || '',
        icon: req.file ? `/uploads/services/${req.file.filename}` : null,
    };

    const newService = await Service.create(serviceData);
    
    // Populate category details
    await newService.populate('categoryId', 'name icon');

    res.status(201).json(
        new ApiResponse(201, newService, 'Service created successfully')
    );
};

// Get all services with filters and pagination
export const getAllServices = async (req, res) => {
    const userId = req.user._id;
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const search = req.query.search || '';
    const { categoryId, isActive, isDeleted, minPrice, maxPrice } = req.query;
    
    let query = { userId };
    
    if (categoryId) {
        query.categoryId = categoryId;
    }
    
    if (search) {
        query.name = { $regex: search, $options: 'i' };
    }
    
    if (isActive !== undefined && isActive !== '') {
        query.isActive = isActive === 'true';
    }
    
    if (isDeleted !== undefined && isDeleted !== '') {
        query.isDeleted = isDeleted === 'true';
    }
    
    // Price range filter
    if (minPrice !== undefined || maxPrice !== undefined) {
        query.price = {};
        if (minPrice !== undefined && minPrice !== '') {
            query.price.$gte = Number(minPrice);
        }
        if (maxPrice !== undefined && maxPrice !== '') {
            query.price.$lte = Number(maxPrice);
        }
    }
    
    // Sorting
    const sortField = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortField]: sortOrder };
    
    // Execute queries
    const [services, totalCount] = await Promise.all([
        Service.find(query)
            .populate('categoryId', 'name icon isActive isDeleted')
            .populate('reviews')
            .sort(sort)
            .skip(skip)
            .limit(limit)
            .lean(),
        Service.countDocuments(query)
    ]);
    
    // Calculate average rating if needed
    const servicesWithRating = services.map(service => {
        let avgRating = 0;
        if (service.reviews && service.reviews.length > 0) {
            const totalRating = service.reviews.reduce((sum, review) => sum + (review.rating || 0), 0);
            avgRating = totalRating / service.reviews.length;
        }
        return {
            ...service,
            averageRating: avgRating,
            totalReviews: service.reviews?.length || 0
        };
    });
    
    // Pagination metadata
    const totalPages = Math.ceil(totalCount / limit);
    const hasNextPage = page < totalPages;
    const hasPrevPage = page > 1;
    
    res.status(200).json(
        new ApiResponse(200, {
            services: servicesWithRating,
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
                minPrice: minPrice || null,
                maxPrice: maxPrice || null,
                sortBy: sortField,
                sortOrder: req.query.sortOrder || 'desc'
            }
        }, 'Services retrieved successfully')
    );
};

// Get single service by ID
export const getServiceById = async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    const serviceData = await Service.findOne({ _id: id, userId, isDeleted: false })
        .populate('categoryId', 'name icon isActive isDeleted')
        .populate('reviews');

    if (!serviceData) {
        throw new ApiError(404, 'Service not found');
    }

    // Calculate rating
    let avgRating = 0;
    if (serviceData.reviews && serviceData.reviews.length > 0) {
        const totalRating = serviceData.reviews.reduce((sum, review) => sum + (review.rating || 0), 0);
        avgRating = totalRating / serviceData.reviews.length;
    }

    const response = {
        ...serviceData.toObject(),
        averageRating: avgRating,
        totalReviews: serviceData.reviews?.length || 0
    };

    res.status(200).json(
        new ApiResponse(200, response, 'Service retrieved successfully')
    );
};

// Update service
export const updateService = async (req, res) => {
    const { id } = req.params;
    const { name, categoryId, price, description } = req.body;
    const userId = req.user._id;

    const serviceData = await Service.findOne({ _id: id, userId });

    if (!serviceData) {
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        throw new ApiError(404, 'Service not found');
    }

    // If categoryId is being changed, verify new category exists
    if (categoryId && categoryId !== serviceData.categoryId.toString()) {
        const category = await Category.findOne({ _id: categoryId, userId, isDeleted: false });
        if (!category) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            throw new ApiError(404, 'New category not found');
        }
        serviceData.categoryId = categoryId;
    }

    // Check if new name conflicts
    if (name && name !== serviceData.name) {
        const existingService = await Service.findOne({
            userId,
            categoryId: categoryId || serviceData.categoryId,
            name: { $regex: new RegExp(`^${name}$`, 'i') },
            _id: { $ne: id },
            isDeleted: false
        });
        if (existingService) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            throw new ApiError(409, 'Service name already exists in this category');
        }
        serviceData.name = name;
    }

    // Update price
    if (price !== undefined) {
        if (price < 0) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }
            throw new ApiError(400, 'Price cannot be negative');
        }
        serviceData.price = Number(price);
    }

    // Update description
    if (description !== undefined) {
        serviceData.description = description;
    }

    // Update image if new file uploaded
    if (req.file) {
        if (serviceData.icon) {
            const oldImagePath = path.join('public', serviceData.icon);
            deleteOldImage(oldImagePath);
        }
        serviceData.icon = `/uploads/services/${req.file.filename}`;
    }

    await serviceData.save();
    await serviceData.populate('categoryId', 'name icon');
    await serviceData.populate('reviews');

    res.status(200).json(
        new ApiResponse(200, serviceData, 'Service updated successfully')
    );
};

// Toggle service Active Status
export const toggleServiceActive = async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    const serviceData = await Service.findOne({ _id: id, userId });

    if (!serviceData) {
        throw new ApiError(404, 'Service not found');
    }

    serviceData.isActive = !serviceData.isActive;
    await serviceData.save();

    res.status(200).json(
        new ApiResponse(200, { 
            _id: serviceData._id, 
            isActive: serviceData.isActive,
            status: serviceData.isActive ? 'activated' : 'deactivated'
        }, `Service ${serviceData.isActive ? 'activated' : 'deactivated'} successfully`)
    );
};

// Soft Delete service
export const softDeleteService = async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    const serviceData = await Service.findOne({ _id: id, userId });

    if (!serviceData) {
        throw new ApiError(404, 'Service not found');
    }

    serviceData.isDeleted = !serviceData.isDeleted;
    serviceData.isActive = serviceData.isDeleted ? false : serviceData.isActive;
    await serviceData.save();

    const message = serviceData.isDeleted ? 'Service moved to trash' : 'Service restored successfully';
    
    res.status(200).json(
        new ApiResponse(200, {
            _id: serviceData._id,
            isDeleted: serviceData.isDeleted,
            isActive: serviceData.isActive
        }, message)
    );
};

// Permanently Delete service (Hard Delete)
export const hardDeleteService = async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;

    const serviceData = await Service.findOne({ _id: id, userId });

    if (!serviceData) {
        throw new ApiError(404, 'Service not found');
    }

    // Delete service image
    if (serviceData.icon) {
        const imagePath = path.join('public', serviceData.icon);
        deleteOldImage(imagePath);
    }

    await Service.deleteOne({ _id: id, userId });

    res.status(200).json(
        new ApiResponse(200, {
            deletedId: id,
            deletedAt: new Date().toISOString()
        }, 'Service permanently deleted successfully')
    );
};

// Get Services by Category (with filters)
export const getServicesByCategory = async (req, res) => {
    const { categoryId } = req.params;
    const userId = req.user._id;
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const { includeInactive, includeDeleted, minPrice, maxPrice } = req.query;
    
    // Build query
    let query = { userId, categoryId };
    
    if (includeInactive !== 'true') {
        query.isActive = true;
    }
    
    if (includeDeleted !== 'true') {
        query.isDeleted = false;
    }
    
    // Price filter
    if (minPrice !== undefined || maxPrice !== undefined) {
        query.price = {};
        if (minPrice !== undefined && minPrice !== '') {
            query.price.$gte = Number(minPrice);
        }
        if (maxPrice !== undefined && maxPrice !== '') {
            query.price.$lte = Number(maxPrice);
        }
    }

    // Verify category exists
    const category = await Category.findOne({ _id: categoryId, userId, isDeleted: false });
    if (!category) {
        throw new ApiError(404, 'Category not found');
    }

    const [services, totalCount] = await Promise.all([
        Service.find(query)
            .populate('reviews')
            .sort({ price: 1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        Service.countDocuments(query)
    ]);
    
    // Add rating info
    const servicesWithRating = services.map(service => {
        let avgRating = 0;
        if (service.reviews && service.reviews.length > 0) {
            const totalRating = service.reviews.reduce((sum, review) => sum + (review.rating || 0), 0);
            avgRating = totalRating / service.reviews.length;
        }
        return {
            ...service,
            averageRating: avgRating,
            totalReviews: service.reviews?.length || 0
        };
    });
    
    const totalPages = Math.ceil(totalCount / limit);
    
    res.status(200).json(
        new ApiResponse(200, {
            category: {
                _id: category._id,
                name: category.name,
                icon: category.icon
            },
            services: servicesWithRating,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: totalCount,
                itemsPerPage: limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            },
            filters: {
                minPrice: minPrice || null,
                maxPrice: maxPrice || null,
                includeInactive: includeInactive === 'true',
                includeDeleted: includeDeleted === 'true'
            }
        }, 'Services retrieved successfully')
    );
};



