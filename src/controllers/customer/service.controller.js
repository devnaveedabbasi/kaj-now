import mongoose from 'mongoose';
import Category from '../../models/admin/category.model.js';
import Service from '../../models/admin/service.model.js';
import ServiceRequest from '../../models/admin/serviceRequest.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import User from '../../models/User.model.js';
import Provider from '../../models/provider/Provider.model.js';
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
                profilePicture: request.providerId?.userId?.profilePicture|| null
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
                phone: serviceRequest.providerId?.userId?.phone || '',
                profilePicture: serviceRequest.providerId?.userId?.profilePicture || ''
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








// Helper function to calculate distance between two coordinates (in km)
function calculateDistance(coord1, coord2) {
    if (!coord1 || !coord2) return null;

    const [lng1, lat1] = coord1;
    const [lng2, lat2] = coord2;

    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lng2 - lng1) * Math.PI / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Get recommended services based on user's location (within 1km) and high ratings
export const getRecommendedServices = async (req, res) => {
    try {
        // Check if user is authenticated
        if (!req.user || !req.user._id) {
            return res.status(200).json(
                new ApiResponse(200, {
                    services: [],
                    message: 'Please login to see recommended services'
                }, 'Login to see personalized recommendations')
            );
        }
        
        const userId = req.user._id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        
        // Get user's location
        const user = await User.findById(userId).select('location');
        let userCoordinates = null;
        
        if (user?.location?.coordinates && user.location.coordinates.length === 2) {
            userCoordinates = user.location.coordinates; // [lng, lat]
        }
        
        // Build query for approved services
        let query = { status: 'approved' };
        
        // If user has location, find providers within 1km
        let nearbyProviderIds = [];
        if (userCoordinates) {
            try {
                const nearbyProviders = await Provider.find({
                    location: {
                        $near: {
                            $geometry: {
                                type: 'Point',
                                coordinates: userCoordinates
                            },
                            $maxDistance: 1000 // 1km in meters
                        }
                    }
                }).select('_id');
                
                nearbyProviderIds = nearbyProviders.map(p => p._id);
                
                if (nearbyProviderIds.length > 0) {
                    query.providerId = { $in: nearbyProviderIds };
                }
            } catch (geoError) {
                console.error('Geo query error (index might be missing):', geoError);
                // If geo query fails, just get all approved services
                // Don't filter by location
            }
        }
        
        // Get all approved services
        let serviceRequests = await ServiceRequest.find(query)
            .populate('serviceId', 'name icon price description averageRating reviews')
            .populate('categoryId', 'name icon')
            .populate({
                path: 'providerId',
                populate: {
                    path: 'userId',
                    select: 'name email profilePicture phone location'
                }
            })
            .lean();
        
        // Filter by rating (4+ stars) and calculate distances
        let filteredServices = serviceRequests
            .filter(req => req.serviceId && (req.serviceId.averageRating >= 4 || req.serviceId.averageRating === 0))
            .map(request => {
                let distance = null;
                let isNearby = false;
                
                if (userCoordinates && request.providerId?.userId?.location?.coordinates) {
                    distance = calculateDistance(
                        userCoordinates,
                        request.providerId.userId.location.coordinates
                    );
                    isNearby = distance <= 1; // Within 1km
                }
                
                return {
                    _id: request.serviceId._id,
                    name: request.serviceId.name,
                    icon: request.serviceId.icon,
                    price: request.serviceId.price,
                    description: request.serviceId.description?.substring(0, 100),
                    averageRating: request.serviceId.averageRating || 0,
                    totalReviews: request.serviceId.reviews?.length || 0,
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
                    isNearby: isNearby,
                    distance: distance ? distance.toFixed(2) : null
                };
            });
        
        // Sort: Nearby services first, then by rating
        filteredServices.sort((a, b) => {
            if (a.isNearby && !b.isNearby) return -1;
            if (!a.isNearby && b.isNearby) return 1;
            return b.averageRating - a.averageRating;
        });
        
        // Apply pagination
        const totalCount = filteredServices.length;
        const paginatedServices = filteredServices.slice(skip, skip + limit);
        const totalPages = Math.ceil(totalCount / limit);
        
        res.status(200).json(
            new ApiResponse(200, {
                services: paginatedServices,
                userLocation: userCoordinates ? {
                    lat: userCoordinates[1],
                    lng: userCoordinates[0]
                } : null,
                hasLocation: !!userCoordinates,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: totalCount,
                    itemsPerPage: limit,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                }
            }, 'Recommended services retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting recommended services:', error);
        res.status(500).json(new ApiResponse(500, null, error.message));
    }
};

// Get popular services (highly rated and most requested)
export const getPopularServices = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Get popular services based on:
        // 1. High average rating
        // 2. Number of reviews
        // 3. Number of times requested/approved

        const popularServices = await ServiceRequest.aggregate([
            // Match only approved services
            { $match: { status: 'approved' } },

            // Lookup service details
            {
                $lookup: {
                    from: 'services',
                    localField: 'serviceId',
                    foreignField: '_id',
                    as: 'service'
                }
            },
            { $unwind: '$service' },

            // Lookup category
            {
                $lookup: {
                    from: 'categories',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'category'
                }
            },
            { $unwind: '$category' },

            // Lookup provider
            {
                $lookup: {
                    from: 'providers',
                    localField: 'providerId',
                    foreignField: '_id',
                    as: 'provider'
                }
            },
            { $unwind: '$provider' },

            // Lookup user details
            {
                $lookup: {
                    from: 'users',
                    localField: 'provider.userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },

            // Calculate popularity score
            {
                $addFields: {
                    popularityScore: {
                        $add: [
                            { $multiply: ['$service.averageRating', 2] }, // Rating weight 2
                            { $divide: [{ $size: { $ifNull: ['$service.reviews', []] } }, 5] }, // Reviews weight
                            1 // Base score for being approved
                        ]
                    }
                }
            },

            // Sort by popularity score
            { $sort: { popularityScore: -1, 'service.averageRating': -1 } },

            // Pagination
            { $skip: skip },
            { $limit: limit },

            // Project final fields
            {
                $project: {
                    _id: '$service._id',
                    name: '$service.name',
                    icon: '$service.icon',
                    price: '$service.price',
                    description: '$service.description',
                    averageRating: '$service.averageRating',
                    totalReviews: { $size: { $ifNull: ['$service.reviews', []] } },
                    popularityScore: 1,
                    category: {
                        _id: '$category._id',
                        name: '$category.name',
                        icon: '$category.icon'
                    },
                    provider: {
                        _id: '$provider._id',
                        name: '$user.name',
                        email: '$user.email',
                        phone: '$user.phone',
                        profilePicture: '$user.profilePicture'
                    },
                    totalRequests: 1
                }
            }
        ]);

        // Get total count for pagination
        const totalCountResult = await ServiceRequest.aggregate([
            { $match: { status: 'approved' } },
            { $group: { _id: '$serviceId' } },
            { $count: 'total' }
        ]);

        const totalCount = totalCountResult[0]?.total || 0;
        const totalPages = Math.ceil(totalCount / limit);

        res.status(200).json(
            new ApiResponse(200, {
                services: popularServices,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: totalCount,
                    itemsPerPage: limit,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                }
            }, 'Popular services retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting popular services:', error);
        res.status(500).json(new ApiResponse(500, null, error.message));
    }
};

// Alternative: Simple popular services based on rating only
export const getTopRatedServices = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        let query = { status: 'approved' };

        const [serviceRequests, totalCount] = await Promise.all([
            ServiceRequest.find(query)
                .populate('serviceId', 'name icon price description averageRating reviews')
                .populate('categoryId', 'name icon')
                .populate({
                    path: 'providerId',
                    populate: {
                        path: 'userId',
                        select: 'name email profilePicture phone'
                    }
                })
                .sort({ 'serviceId.averageRating': -1, 'serviceId.reviews': -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            ServiceRequest.countDocuments(query)
        ]);

        // Filter services with at least 3+ rating and format
        const formattedServices = serviceRequests
            .filter(req => req.serviceId && req.serviceId.averageRating >= 3)
            .map(request => ({
                _id: request.serviceId._id,
                name: request.serviceId.name,
                icon: request.serviceId.icon,
                price: request.serviceId.price,
                description: request.serviceId.description?.substring(0, 100),
                averageRating: request.serviceId.averageRating || 0,
                totalReviews: request.serviceId.reviews?.length || 0,
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
                }
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
                }
            }, 'Top rated services retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting top rated services:', error);
        res.status(500).json(new ApiResponse(500, null, error.message));
    }
};