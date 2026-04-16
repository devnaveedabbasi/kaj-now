import mongoose from 'mongoose';
import Service from '../../models/admin/service.model.js';
import ServiceRequest from '../../models/admin/serviceRequest.model.js';
import Category from '../../models/admin/category.model.js';
import Provider from '../../models/provider/Provider.model.js';
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
            const activeServicesCount = await Service.countDocuments({
                categoryId: category._id,
                isActive: true,
                isDeleted: false
            });
            
            return {
                ...category,
                activeServicesCount
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

export const requestService = async (req, res) => {
    try {
        const userId = req.user._id;
        let { serviceId } = req.body; // serviceId will be an array
        
        // Handle serviceId as array
        let finalServiceIds = [];
        
        if (serviceId && Array.isArray(serviceId)) {
            finalServiceIds = serviceId;
        } else if (serviceId && !Array.isArray(serviceId)) {
            // If single ID sent as string
            finalServiceIds = [serviceId];
        } else {
            throw new ApiError(400, 'Service ID array is required');
        }
        
        console.log('Requesting services with IDs:', finalServiceIds, 'by user:', userId);
        
        // Get provider
        const provider = await Provider.findOne({ userId });
        if (!provider) {
            throw new ApiError(404, 'Provider profile not found');
        }
        
        // Verify all services exist
        const services = await Service.find({
            _id: { $in: finalServiceIds },
            isDeleted: false,
            isActive: true
        });
        
        if (services.length !== finalServiceIds.length) {
            const foundIds = services.map(s => s._id.toString());
            const missingIds = finalServiceIds.filter(id => !foundIds.includes(id));
            throw new ApiError(404, `Services not found: ${missingIds.join(', ')}`);
        }
        
        // Check for existing requests
        const existingRequests = await ServiceRequest.find({
            providerId: provider._id,
            serviceId: { $in: finalServiceIds },
            status: { $in: ['pending', 'approved'] }
        });
        
        if (existingRequests.length > 0) {
            const existingServiceIds = existingRequests.map(r => r.serviceId.toString());
            const newServiceIds = finalServiceIds.filter(id => !existingServiceIds.includes(id));
            
            if (newServiceIds.length === 0) {
                throw new ApiError(409, `Already have requests for all selected services: ${existingServiceIds.join(', ')}`);
            }
            
            // Only process new service IDs
            finalServiceIds = newServiceIds;
            console.log('Processing only new service IDs:', finalServiceIds);
        }
        
        // Create multiple requests
        const requests = [];
        for (const service of services) {
            if (finalServiceIds.includes(service._id.toString())) {
                const request = await ServiceRequest.create({
                    providerId: provider._id,
                    serviceId: service._id,
                    categoryId: service.categoryId
                });
                
                await request.populate('serviceId', 'name price icon');
                await request.populate('categoryId', 'name icon');
                requests.push(request);
            }
        }
        
        if (requests.length === 0) {
            throw new ApiError(400, 'No new service requests to submit');
        }
        
        
        res.status(201).json(
            new ApiResponse(201, {
                requests: requests,
                totalRequested: requests.length,
                submittedServiceIds: finalServiceIds
            }, `${requests.length} service request(s) submitted successfully`)
        );
    } catch (error) {
        console.error('Error requesting services:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, error.message || 'Internal server error'));
        }
    }
};


export const getMyServices = async (req, res) => {
    try {
        const userId = req.user._id;
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const { status } = req.query;
        
        const provider = await Provider.findOne({ userId });
        if (!provider) {
            throw new ApiError(404, 'Provider profile not found');
        }
        
        let query = { providerId: provider._id };
        if (status) {
            query.status = status;
        }
        
    const [services, totalCount] = await Promise.all([
    ServiceRequest.find(query)
        .populate('serviceId', 'name icon price description userId')
        .populate({
            path: 'providerId',
            populate: {
                path: 'userId',
                select: 'name email'
            }
        })
        .populate('categoryId', 'name icon')
        .populate('reviewedByAdmin', 'name email')
        .sort({ reviewedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
    ServiceRequest.countDocuments(query)
]);
        const totalPages = Math.ceil(totalCount / limit);
        
        const results = services.map(s => ({
            _id: s._id,
            status: s.status,
            name: s.serviceId?.name || 'Unknown Service',
            icon: s.serviceId?.icon || '',
            price: s.serviceId?.price || 0,
            description: s.serviceId?.description || 'No description available',
            averageRating: s.serviceId?.averageRating || 0,
            profilePicture: s.providerId?.userId?.profilePicture || null,
            providerName: s.providerId?.userId?.name || 'Unknown Provider',
            providerEmail: s.providerId?.userId?.email || 'Unknown Email',
            categoryName: s.categoryId?.name || 'Unknown Category',
        }));

        res.status(200).json(
            new ApiResponse(200, {
                services: results,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: totalCount,
                    itemsPerPage: limit
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



export const getServiceById = async (req, res) => {
    try {
        const { serviceId:serviceRequestId } = req.params;
        
        // Validate ObjectId
        if (!mongoose.Types.ObjectId.isValid(serviceRequestId)) {
            throw new ApiError(400, 'Invalid service request ID format');
        }
        
        // Find service request by ID
        const serviceRequest = await ServiceRequest.findById(serviceRequestId)
            .populate('serviceId', 'name icon price description userId averageRating')
            .populate({
                path: 'providerId',
                populate: {
                    path: 'userId',
                    select: 'name email profilePicture phoneNumber'
                }
            })
            .populate('categoryId', 'name icon')
            .populate('reviewedByAdmin', 'name email')
            .lean();
        
        if (!serviceRequest) {
            throw new ApiError(404, 'Service request not found');
        }
        
        // Get reviews for this service
        const reviews = await mongoose.model('Review').find({ 
            service: serviceRequest.serviceId._id 
        })
        .populate('userId', 'name email profilePicture')
        .lean();
        
        // Calculate rating distribution
        const ratingDistribution = {
            1: 0, 2: 0, 3: 0, 4: 0, 5: 0
        };
        
        let totalRating = 0;
        if (reviews && reviews.length > 0) {
            reviews.forEach(review => {
                ratingDistribution[review.rating]++;
                totalRating += review.rating;
            });
        }
        
        // Format reviews
        const formattedReviews = reviews?.map(review => ({
            _id: review._id,
            rating: review.rating,
            comment: review.comment,
            userName: review.userId?.name || 'Anonymous',
            userEmail: review.userId?.email,
            userImage: review.userId?.profilePicture || null,
            createdAt: review.createdAt,
            updatedAt: review.updatedAt
        })) || [];
        
        // Prepare response
        const response = {
            // Service Request Info
            _id: serviceRequest._id,
            status: serviceRequest.status,
            requestedAt: serviceRequest.requestedAt,
            reviewedAt: serviceRequest.reviewedAt,
            notes: serviceRequest.notes,
            rejectionReason: serviceRequest.rejectionReason,
            createdAt: serviceRequest.createdAt,
            updatedAt: serviceRequest.updatedAt,
            
            // Service Info
            service: {
                _id: serviceRequest.serviceId?._id,
                name: serviceRequest.serviceId?.name,
                description: serviceRequest.serviceId?.description || 'No description available',
                icon: serviceRequest.serviceId?.icon,
                price: serviceRequest.serviceId?.price,
                averageRating: serviceRequest.serviceId?.averageRating || 0,
                totalReviews: reviews?.length || 0
            },
            
            // Provider Info
            provider: {
                _id: serviceRequest.providerId?._id,
                name: serviceRequest.providerId?.userId?.name,
                email: serviceRequest.providerId?.userId?.email,
                phone: serviceRequest.providerId?.userId?.phoneNumber,
                profilePicture: serviceRequest.providerId?.userId?.profilePicture
            },
            
            // Category Info
            category: {
                _id: serviceRequest.categoryId?._id,
                name: serviceRequest.categoryId?.name,
                icon: serviceRequest.categoryId?.icon
            },
            
            // Admin Info (who reviewed)
            reviewedBy: serviceRequest.reviewedByAdmin ? {
                _id: serviceRequest.reviewedByAdmin._id,
                name: serviceRequest.reviewedByAdmin.name,
                email: serviceRequest.reviewedByAdmin.email
            } : null,
            
            // Reviews & Ratings
            reviews: formattedReviews,
            ratingDistribution: ratingDistribution,
            stats: {
                averageRating: serviceRequest.serviceId?.averageRating || 0,
                totalRatings: reviews?.length || 0
            }
        };
        
        res.status(200).json(
            new ApiResponse(200, response, 'Service request details retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting service request details:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
        }
    }
};