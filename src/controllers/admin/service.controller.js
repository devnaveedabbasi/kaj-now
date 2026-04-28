import Category from '../../models/admin/category.model.js';
import Service from '../../models/admin/service.model.js';
import fs from 'fs';
import path from 'path';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import Review from '../../models/reviews.model.js';
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

// Helper function to cleanup files
const cleanupFiles = (files) => {
    if (!files) return;
    
    if (files.icon) {
        files.icon.forEach(file => {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });
    }
    if (files.images) {
        files.images.forEach(file => {
            if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        });
    }
};

// Create service
export const createService = async (req, res) => {
    try {
        const { name, price, categoryId,description } = req.body;
        const userId = req.user._id;

        const iconFile = req.files?.icon?.[0];

        // Validation
        if (!name || !categoryId || !price) {
            cleanupFiles(req.files);
            throw new ApiError(400, 'Name, categoryId and price are required');
        }

        if (price < 0) {
            cleanupFiles(req.files);
            throw new ApiError(400, 'Price cannot be negative');
        }

        // Check if category exists and belongs to user
        const category = await Category.findOne({ _id: categoryId, userId, isDeleted: false });
        if (!category) {
            cleanupFiles(req.files);
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
            cleanupFiles(req.files);
            throw new ApiError(409, 'Service already exists in this category');
        }

        // Handle icon upload - icon is required
        if (!iconFile) {
            cleanupFiles(req.files);
            throw new ApiError(400, 'Service icon is required');
        }

        const iconPath = `/uploads/services/icons/${iconFile.filename}`;
        

        const newServiceData = {
            userId,
            categoryId,
            name,
            icon: iconPath,
            price: Number(price),
            description: description || ''
        };

        const newService = await Service.create(newServiceData);
        
        // Populate category details
        await newService.populate('categoryId', 'name icon');

        res.status(201).json(
            new ApiResponse(201, newService, 'Service created successfully')
        );
 } catch (error) {
    cleanupFiles(req.files);

    console.error("Error creating service:", error);

    if (error.name === "ValidationError") {
        const messages = Object.values(error.errors).map(e => e.message);

        return res.status(400).json(
            new ApiResponse(400, null, messages.join(", "))
        );
    }

    if (error instanceof ApiError) {
        return res.status(error.statusCode).json(
            new ApiResponse(error.statusCode, null, error.message)
        );
    }
    return res.status(500).json(
        new ApiResponse(500, null, error.message || "Internal server error")
    );
}
}
// Get all services with filters and pagination
export const getAllServices = async (req, res) => {
    try {
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
        } else {
            query.isDeleted = false; // Hide soft-deleted by default
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
        
        // Summary counters (GLOBAL)
        const [totalServices, activeServices, deletedServices] = await Promise.all([
            Service.countDocuments({ userId }),
            Service.countDocuments({ userId, isActive: true, isDeleted: false }),
            Service.countDocuments({ userId, isDeleted: true })
        ]);
        
   const servicesWithRating = services.map(service => {
    let avgRating = 3; // default

    if (service.reviews && service.reviews.length > 0) {
        const totalRating = service.reviews.reduce(
            (sum, review) => sum + (review.rating || 0), 0
        );
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
                summary: {
                    totalServices,
                    activeServices,
                    deletedServices
                },
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
    } catch (error) {
        console.error('Error getting services:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
        }
    }
};

// Get single service by ID
export const getServiceById = async (req, res) => {
    try {
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
    } catch (error) {
        console.error('Error getting service:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
        }
    }
};

// Update service
export const updateService = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;
        const { name, categoryId, price ,description} = req.body;

        const iconFile = req.files?.icon?.[0];
        const newImageFiles = req.files?.images || [];

        // Find existing service
        const existingService = await Service.findOne({ _id: id, userId, isDeleted: false });
        
        if (!existingService) {
            cleanupFiles(req.files);
            throw new ApiError(404, 'Service not found');
        }

        // If categoryId is being changed, verify the new category exists
        if (categoryId && categoryId !== existingService.categoryId.toString()) {
            const category = await Category.findOne({ _id: categoryId, userId, isDeleted: false });
            if (!category) {
                cleanupFiles(req.files);
                throw new ApiError(404, 'Category not found');
            }
        }

        // Check if name is being changed and if it conflicts with another service
        if (name && name !== existingService.name) {
            const duplicateService = await Service.findOne({
                userId,
                categoryId: categoryId || existingService.categoryId,
                name: { $regex: new RegExp(`^${name}$`, 'i') },
                isDeleted: false,
                _id: { $ne: id }
            });

            if (duplicateService) {
                cleanupFiles(req.files);
                throw new ApiError(409, 'Service already exists in this category');
            }
        }

        // Handle icon update
        let iconPath = existingService.icon;
        if (iconFile) {
            // Delete old icon file if it exists
            if (existingService.icon) {
                const oldIconPath = path.join(process.cwd(), 'public', existingService.icon);
                deleteOldImage(oldIconPath);
            }
            iconPath = `/uploads/services/icons/${iconFile.filename}`;
        }

       

        // Prepare update data
        const updateData = {
            ...(name && { name }),
            ...(categoryId && { categoryId }),
            ...(iconFile && { icon: iconPath }),
            ...(price !== undefined && { price: Number(price) }),
            ...(description !== undefined && { description })
        };

        // Update the service
        const updatedService = await Service.findByIdAndUpdate(
            id,
            updateData,
            { new: true, runValidators: true }
        ).populate('categoryId', 'name icon isActive isDeleted')
         .populate('reviews');

        if (!updatedService) {
            throw new ApiError(404, 'Service not found');
        }

        // Calculate rating
        let avgRating = 0;
        if (updatedService.reviews && updatedService.reviews.length > 0) {
            const totalRating = updatedService.reviews.reduce((sum, review) => sum + (review.rating || 0), 0);
            avgRating = totalRating / updatedService.reviews.length;
        }

        const response = {
            ...updatedService.toObject(),
            averageRating: avgRating,
            totalReviews: updatedService.reviews?.length || 0
        };

        res.status(200).json(
            new ApiResponse(200, response, 'Service updated successfully')
        );

    } catch (error) {
        cleanupFiles(req.files);
        
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            console.error('Error updating service:', error);
            res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
        }
    }
};

// Delete service image
export const deleteServiceImage = async (req, res) => {
    try {
        const { id, imageIndex } = req.params;
        const userId = req.user._id;

        const service = await Service.findOne({ _id: id, userId });
        
        if (!service) {
            throw new ApiError(404, 'Service not found');
        }

        const imageToDelete = service.images[imageIndex];
        if (!imageToDelete) {
            throw new ApiError(404, 'Image not found');
        }

        // Delete physical file
        const imagePath = path.join(process.cwd(), 'public', imageToDelete);
        deleteOldImage(imagePath);

        // Remove from array
        service.images.splice(imageIndex, 1);
        await service.save();

        res.status(200).json(
            new ApiResponse(200, { images: service.images }, 'Image deleted successfully')
        );
    } catch (error) {
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            console.error('Error deleting image:', error);
            res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
        }
    }
};

// Toggle service Active Status
export const toggleServiceActive = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;

        // 1. Find service
        const serviceData = await Service.findOne({ _id: id, userId });

        if (!serviceData) {
            throw new ApiError(404, "Service not found");
        }

        // 2. Check category status
        const category = await Category.findById(serviceData.categoryId);

        if (!category || !category.isActive) {
            throw new ApiError(
                400,
                "Cannot activate service. Category is inactive"
            );
        }

        // 3. Toggle service
        serviceData.isActive = !serviceData.isActive;
        await serviceData.save();

        // 4. If service deactivated → disable related requests
        if (!serviceData.isActive) {
            await ServiceRequest.updateMany(
                { serviceId: serviceData._id, status: "pending" },
                {
                    status: "admin_deactivated",
                    notes: "Service deactivated by admin",
                }
            );
        }

        res.status(200).json(
            new ApiResponse(
                200,
                {
                    _id: serviceData._id,
                    isActive: serviceData.isActive,
                    status: serviceData.isActive ? "activated" : "deactivated",
                },
                `Service ${
                    serviceData.isActive ? "activated" : "deactivated"
                } successfully`
            )
        );
    } catch (error) {
        if (error instanceof ApiError) {
            res
                .status(error.statusCode)
                .json(
                    new ApiResponse(error.statusCode, null, error.message)
                );
        } else {
            console.error("Error toggling service:", error);
            res
                .status(500)
                .json(
                    new ApiResponse(500, null, "Internal server error")
                );
        }
    }
};

// Soft Delete service
export const softDeleteService = async (req, res) => {
    try {
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
    } catch (error) {
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            console.error('Error soft deleting service:', error);
            res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
        }
    }
};

// Permanently Delete service (Hard Delete)
export const hardDeleteService = async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user._id;

        const serviceData = await Service.findOne({ _id: id, userId });

        if (!serviceData) {
            throw new ApiError(404, 'Service not found');
        }

        // Delete service icon
        if (serviceData.icon) {
            const iconPath = path.join('public', serviceData.icon);
            deleteOldImage(iconPath);
        }

        // Delete all service images
        if (serviceData.images && serviceData.images.length > 0) {
            serviceData.images.forEach(image => {
                const imagePath = path.join('public', image);
                deleteOldImage(imagePath);
            });
        }

        await Service.deleteOne({ _id: id, userId });

        res.status(200).json(
            new ApiResponse(200, {
                deletedId: id,
                deletedAt: new Date().toISOString()
            }, 'Service permanently deleted successfully')
        );
    } catch (error) {
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            console.error('Error hard deleting service:', error);
            res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
        }
    }
};

// Get Services by Category (with filters)
export const getServicesByCategory = async (req, res) => {
    try {
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
    } catch (error) {
        console.error('Error getting services by category:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
        }
    }
};


