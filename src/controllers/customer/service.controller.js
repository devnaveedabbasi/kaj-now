import mongoose from 'mongoose';
import Category from '../../models/admin/category.model.js';
import Service from '../../models/admin/service.model.js';
import ServiceRequest from '../../models/admin/serviceRequest.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const getAllCategories = async (req, res) => {
    try {
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
        
        // Get approved service count for each category from ServiceRequest
        const categoriesWithCount = await Promise.all(
            categories.map(async (category) => {
                const activeServiceCount = await ServiceRequest.countDocuments({
                    categoryId: category._id,
                    status: 'approved'
                });
                
                return {
                    ...category,
                    activeServiceCount
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
    } catch (error) {
        console.error('Error getting categories:', error);
        res.status(500).json(new ApiResponse(500, null, error.message));
    }
};

export const getServicesByCategory = async (req, res) => {
    try {
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
        
        // Check if category exists and is active
        const category = await Category.findOne({ 
            _id: categoryId, 
            isActive: true,
            isDeleted: false
        });
        
        if (!category) {
            throw new ApiError(404, 'Category not found');
        }
        
        // Build query for approved service requests in this category
        let query = { 
            categoryId: categoryId,
            status: 'approved'  // Only get approved services
        };
        
        // If search is provided, search in service name
        if (search) {
            // First find services matching the search
            const matchingServices = await Service.find({
                name: { $regex: search, $options: 'i' },
                isDeleted: false,
                isActive: true
            }).select('_id');
            
            const serviceIds = matchingServices.map(s => s._id);
            query.serviceId = { $in: serviceIds };
        }
        
        const sortField = req.query.sortBy || 'requestedAt';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
        const sort = { [sortField]: sortOrder };
        
        const [serviceRequests, totalCount] = await Promise.all([
            ServiceRequest.find(query)
                .populate('serviceId', 'name icon price description averageRating')
                .populate('providerId', 'userId')
                .populate({
                    path: 'providerId',
                    populate: {
                        path: 'userId',
                        select: 'name email profilePicture'
                    }
                })
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean(),
            ServiceRequest.countDocuments(query)
        ]);
        
        // Format the response
        const formattedServices = serviceRequests.map(request => ({
            _id: request.serviceId?._id,
            name: request.serviceId?.name,
            icon: request.serviceId?.icon,
            price: request.serviceId?.price,
            description: request.serviceId?.description,
            averageRating: request.serviceId?.averageRating || 0,
            provider: {
                _id: request.providerId?._id,
                name: request.providerId?.userId?.name,
                email: request.providerId?.userId?.email,
                profilePicture: request.providerId?.userId?.profilePicture
            },
            requestStatus: request.status,
            requestedAt: request.requestedAt
        }));
        
        const totalPages = Math.ceil(totalCount / limit);
        
        res.status(200).json(
            new ApiResponse(200, {
                category: {
                    _id: category._id,
                    name: category.name,
                    icon: category.icon,
                    description: category.description
                },
                services: formattedServices,
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
    } catch (error) {
        console.error('Error getting services by category:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, error.message));
        }
    }
};


export const getAllApprovedServices = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        
        const search = req.query.search || '';
        const { categoryId, minPrice, maxPrice } = req.query;
        
        // Build query for approved service requests
        let query = { status: 'approved' };
        
        // Filter by category
        if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
            query.categoryId = categoryId;
        }
        
        // Build service filter conditions
        let serviceFilter = {};
        if (search) {
            serviceFilter.name = { $regex: search, $options: 'i' };
        }
        if (minPrice !== undefined || maxPrice !== undefined) {
            serviceFilter.price = {};
            if (minPrice !== undefined && minPrice !== '') {
                serviceFilter.price.$gte = Number(minPrice);
            }
            if (maxPrice !== undefined && maxPrice !== '') {
                serviceFilter.price.$lte = Number(maxPrice);
            }
        }
        
        // First find services matching the filter
        const matchingServices = await Service.find(serviceFilter).select('_id');
        if (matchingServices.length > 0 || Object.keys(serviceFilter).length === 0) {
            if (matchingServices.length > 0) {
                query.serviceId = { $in: matchingServices.map(s => s._id) };
            }
        } else {
            // No matching services found
            return res.status(200).json(
                new ApiResponse(200, {
                    services: [],
                    pagination: {
                        currentPage: page,
                        totalPages: 0,
                        totalItems: 0,
                        itemsPerPage: limit
                    },
                    filters: {
                        search: search || null,
                        categoryId: categoryId || null,
                        minPrice: minPrice || null,
                        maxPrice: maxPrice || null
                    }
                }, 'No services found')
            );
        }
        
        // Sorting
        const sortField = req.query.sortBy || 'createdAt';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
        const sort = { [sortField]: sortOrder };
        
        // Get approved service requests with pagination
        const [serviceRequests, totalCount] = await Promise.all([
            ServiceRequest.find(query)
                .populate('serviceId', 'name icon price description averageRating userId')
                .populate('categoryId', 'name icon')
                .populate({
                    path: 'providerId',
                    populate: {
                        path: 'userId',
                        select: 'name email profilePicture phone'
                    }
                })
                .sort(sort)
                .skip(skip)
                .limit(limit)
                .lean(),
            ServiceRequest.countDocuments(query)
        ]);
        
        // Format the response
        const formattedServices = serviceRequests.map(request => ({
            _id: request.serviceId?._id,
            name: request.serviceId?.name,
            icon: request.serviceId?.icon,
            price: request.serviceId?.price,
            description: request.serviceId?.description || 'No description available',
            averageRating: request.serviceId?.averageRating || 0,
            category: {
                _id: request.categoryId?._id,
                name: request.categoryId?.name,
                icon: request.categoryId?.icon
            },
            provider: {
                _id: request.providerId?._id,
                name: request.providerId?.userId?.name,
                email: request.providerId?.userId?.email,
                phone: request.providerId?.userId?.phone,
                profilePicture: request.providerId?.userId?.profilePicture
            },
            requestId: request._id,
            requestedAt: request.requestedAt,
            approvedAt: request.reviewedAt
        }));
        
        const totalPages = Math.ceil(totalCount / limit);
        
        res.status(200).json(
            new ApiResponse(200, {
                services: formattedServices,
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
                    categoryId: categoryId || null,
                    minPrice: minPrice || null,
                    maxPrice: maxPrice || null,
                    sortBy: sortField,
                    sortOrder: req.query.sortOrder || 'desc'
                }
            }, 'Approved services retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting approved services:', error);
        res.status(500).json(new ApiResponse(500, null, error.message));
    }
};



export const getApprovedServiceById = async (req, res) => {
    try {
        const { serviceId } = req.params;
        
        // Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(serviceId)) {
            throw new ApiError(400, 'Invalid service ID format');
        }
        
        // Find approved service request
        const serviceRequest = await ServiceRequest.findOne({
            serviceId: serviceId,
            status: 'approved'
        })
        .populate('serviceId', 'name icon price description averageRating userId')
        .populate('categoryId', 'name icon description')
        .populate({
            path: 'providerId',
            populate: {
                path: 'userId',
                select: 'name email profilePicture phone'
            }
        })
        .lean();
        
        if (!serviceRequest) {
            throw new ApiError(404, 'Approved service not found');
        }
        
        // Get all reviews for this service
        const Review = mongoose.model('Review');
        const reviews = await Review.find({ service: serviceId })
            .populate('userId', 'name email profilePicture')
            .sort({ createdAt: -1 })
            .lean();
        
        // Calculate rating distribution
        const ratingDistribution = {
            1: 0, 2: 0, 3: 0, 4: 0, 5: 0
        };
        
        let totalRating = 0;
        if (reviews && reviews.length > 0) {
            reviews.forEach(review => {
                if (review.rating >= 1 && review.rating <= 5) {
                    ratingDistribution[review.rating]++;
                    totalRating += review.rating;
                }
            });
        }
        
        const averageRating = reviews.length > 0 ? totalRating / reviews.length : 0;
        
        // Format reviews
        const formattedReviews = reviews.map(review => ({
            _id: review._id,
            rating: review.rating,
            comment: review.comment,
            user: {
                _id: review.userId?._id,
                name: review.userId?.name || 'Anonymous',
                email: review.userId?.email,
                profilePicture: review.userId?.profilePicture || null
            },
            createdAt: review.createdAt,
            updatedAt: review.updatedAt
        }));
        
        // Get similar services (same category)
        const similarServices = await ServiceRequest.find({
            categoryId: serviceRequest.categoryId._id,
            status: 'approved',
            serviceId: { $ne: serviceId }
        })
        .populate('serviceId', 'name icon price description averageRating')
        .limit(5)
        .lean();
        
        const formattedSimilarServices = similarServices.map(s => ({
            _id: s.serviceId?._id,
            name: s.serviceId?.name,
            icon: s.serviceId?.icon,
            price: s.serviceId?.price,
            averageRating: s.serviceId?.averageRating || 0
        }));
        
        // Format response
        const response = {
            _id: serviceRequest.serviceId?._id,
            name: serviceRequest.serviceId?.name,
            icon: serviceRequest.serviceId?.icon,
            price: serviceRequest.serviceId?.price,
            description: serviceRequest.serviceId?.description || 'No description available',
            averageRating: serviceRequest.serviceId?.averageRating || averageRating,
            totalReviews: reviews.length,
            ratingDistribution: ratingDistribution,
            category: {
                _id: serviceRequest.categoryId?._id,
                name: serviceRequest.categoryId?.name,
                icon: serviceRequest.categoryId?.icon,
                description: serviceRequest.categoryId?.description
            },
            provider: {
                _id: serviceRequest.providerId?._id,
                name: serviceRequest.providerId?.userId?.name,
                email: serviceRequest.providerId?.userId?.email,
                phone: serviceRequest.providerId?.userId?.phone||'',
                profilePicture: serviceRequest.providerId?.userId?.profilePicture||''
            },
            reviews: formattedReviews,
            similarServices: formattedSimilarServices,
            stats: {
                totalApprovedProviders: 1,
                averageRating: serviceRequest.serviceId?.averageRating || averageRating,
                totalRatings: reviews.length
            },
            requestedAt: serviceRequest.requestedAt,
            approvedAt: serviceRequest.reviewedAt
        };
        
        res.status(200).json(
            new ApiResponse(200, response, 'Approved service details retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting approved service:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, error.message));
        }
    }
};