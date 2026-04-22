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
        const sortField = req.query.sortBy || 'createdAt';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
        const sort = { [sortField]: sortOrder };

        // Sirf approved service requests ki saari categories
        const aggregationPipeline = [
            { $match: { status: 'approved' } },  // Sirf approved
            {
                $lookup: {
                    from: 'categories',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'category'
                }
            },
            { $unwind: '$category' },
            ...(search ? [{ $match: { 'category.name': { $regex: search, $options: 'i' } } }] : []),
            {
                $group: {
                    _id: '$categoryId',
                    name: { $first: '$category.name' },
                    icon: { $first: '$category.icon' },
                    createdAt: { $first: '$category.createdAt' },
                    updatedAt: { $first: '$category.updatedAt' },
                    serviceCount: { $sum: 1 }
                }
            },
            { $sort: sort },
            { $skip: skip },
            { $limit: limit }
        ];

        const categories = await ServiceRequest.aggregate(aggregationPipeline);
        
        res.status(200).json({
            success: true,
            categories: categories,
            pagination: {
                page: page,
                limit: limit
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// Get services by category from ServiceRequest only
export const getServicesByCategory = async (req, res) => {
    try {
        const { categoryId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(categoryId)) {
            throw new ApiError(400, 'Invalid category ID format');
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const search = req.query.search || '';

        // Simple pipeline - sirf serviceRequest aur service
        let pipeline = [
            { 
                $match: { 
                    categoryId: new mongoose.Types.ObjectId(categoryId), 
                    status: 'approved' 
                } 
            },
            {
                $lookup: {
                    from: 'services',
                    localField: 'serviceId',
                    foreignField: '_id',
                    as: 'service'
                }
            },
            { $unwind: '$service' }
        ];

        // Search filter agar hai
        if (search) {
            pipeline.push({
                $match: {
                    'service.name': { $regex: search, $options: 'i' }
                }
            });
        }

        // Count total
        const countPipeline = [...pipeline];
        countPipeline.push({ $count: 'total' });

        // Add sorting and pagination
        const sortField = req.query.sortBy || 'requestedAt';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
        
        pipeline.push(
            { $sort: { [sortField]: sortOrder } },
            { $skip: skip },
            { $limit: limit },
            {
                $project: {
                    _id: '$service._id',
                    name: '$service.name',
                    icon: '$service.icon',
                    price: '$service.price',
                    description: '$service.description',
                    averageRating: '$service.averageRating',
                    requestStatus: '$status',
                    requestedAt: '$requestedAt'
                }
            }
        );

        const [services, totalCountResult] = await Promise.all([
            ServiceRequest.aggregate(pipeline),
            ServiceRequest.aggregate(countPipeline)
        ]);

        const totalCount = totalCountResult[0]?.total || 0;
        const totalPages = Math.ceil(totalCount / limit);

        // Category details lelo
        const category = await Category.findById(categoryId);

        res.status(200).json(
            new ApiResponse(200, {
                category: {
                    _id: category._id,
                    name: category.name,
                    icon: category.icon,
                    description: category.description
                },
                services: services,
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
        console.error('Error:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, error.message));
        }
    }
};

// Get all approved services from ServiceRequest only
export const getAllApprovedServices = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
console.log('Query params:');
        const search = req.query.search || '';
        const { categoryId, minPrice, maxPrice } = req.query;

        // Build pipeline
        let pipeline = [
            { $match: { status: 'approved' } },
            {
                $lookup: {
                    from: 'services',
                    localField: 'serviceId',
                    foreignField: '_id',
                    as: 'service'
                }
            },
            { $unwind: '$service' },
            {
                $lookup: {
                    from: 'categories',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'category'
                }
            },
            { $unwind: '$category' },
            {
                $lookup: {
                    from: 'providers',
                    localField: 'providerId',
                    foreignField: '_id',
                    as: 'provider'
                }
            },
            { $unwind: '$provider' },
            {
                $lookup: {
                    from: 'users',
                    localField: 'provider.userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' }
        ];

        // Apply filters
        let matchConditions = {};

        if (categoryId && mongoose.Types.ObjectId.isValid(categoryId)) {
            matchConditions['category._id'] = new mongoose.Types.ObjectId(categoryId);
        }

        if (search) {
            matchConditions['service.name'] = { $regex: search, $options: 'i' };
        }

        if (minPrice !== undefined || maxPrice !== undefined) {
            matchConditions['service.price'] = {};
            if (minPrice !== undefined && minPrice !== '') {
                matchConditions['service.price'].$gte = Number(minPrice);
            }
            if (maxPrice !== undefined && maxPrice !== '') {
                matchConditions['service.price'].$lte = Number(maxPrice);
            }
        }

        if (Object.keys(matchConditions).length > 0) {
            pipeline.push({ $match: matchConditions });
        }

        // Add sorting
        const sortField = req.query.sortBy || 'requestedAt';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
        pipeline.push({ $sort: { [sortField]: sortOrder } });

        // Add pagination
        pipeline.push(
            { $skip: skip },
            { $limit: limit },
            {
                $project: {
                    _id: '$service._id',
                    name: '$service.name',
                    icon: '$service.icon',
                    price: '$service.price',
                    description: '$service.description',
                    averageRating: '$service.averageRating',
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
                    requestId: '$_id',
                    requestedAt: '$requestedAt',
                    approvedAt: '$reviewedAt'
                }
            }
        );

        // Count total for pagination
        let countPipeline = [
            { $match: { status: 'approved' } },
            {
                $lookup: {
                    from: 'services',
                    localField: 'serviceId',
                    foreignField: '_id',
                    as: 'service'
                }
            },
            { $unwind: '$service' },
            {
                $lookup: {
                    from: 'categories',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'category'
                }
            },
            { $unwind: '$category' }
        ];

        if (Object.keys(matchConditions).length > 0) {
            countPipeline.push({ $match: matchConditions });
        }

        countPipeline.push({ $count: 'total' });

        const [services, totalCountResult] = await Promise.all([
            ServiceRequest.aggregate(pipeline),
            ServiceRequest.aggregate(countPipeline)
        ]);

        const totalCount = totalCountResult[0]?.total || 0;
        const totalPages = Math.ceil(totalCount / limit);

        res.status(200).json(
            new ApiResponse(200, {
                services: services,
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

// Get single approved service by ID from ServiceRequest only
export const getApprovedServiceById = async (req, res) => {
    try {
        const { serviceId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(serviceId)) {
            throw new ApiError(400, 'Invalid service ID format');
        }

        // Find service request with all details
        const serviceRequest = await ServiceRequest.aggregate([
            {
                $match: {
                    serviceId: new mongoose.Types.ObjectId(serviceId),
                    status: 'approved'
                }
            },
            {
                $lookup: {
                    from: 'services',
                    localField: 'serviceId',
                    foreignField: '_id',
                    as: 'service'
                }
            },
            { $unwind: '$service' },
            {
                $lookup: {
                    from: 'categories',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'category'
                }
            },
            { $unwind: '$category' },
            {
                $lookup: {
                    from: 'providers',
                    localField: 'providerId',
                    foreignField: '_id',
                    as: 'provider'
                }
            },
            { $unwind: '$provider' },
            {
                $lookup: {
                    from: 'users',
                    localField: 'provider.userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            {
                $project: {
                    _id: '$service._id',
                    name: '$service.name',
                    icon: '$service.icon',
                    price: '$service.price',
                    description: '$service.description',
                    averageRating: '$service.averageRating',
                    category: {
                        _id: '$category._id',
                        name: '$category.name',
                        icon: '$category.icon',
                        description: '$category.description'
                    },
                    provider: {
                        _id: '$provider._id',
                        name: '$user.name',
                        email: '$user.email',
                        phone: '$user.phone',
                        profilePicture: '$user.profilePicture',
                        location: '$provider.location'
                    },
                    requestedAt: '$requestedAt',
                    approvedAt: '$reviewedAt'
                }
            }
        ]);

        if (!serviceRequest || serviceRequest.length === 0) {
            throw new ApiError(404, 'Approved service not found');
        }

        // Get reviews for this service
        const Review = mongoose.model('Review');
        const reviews = await Review.find({ service: new mongoose.Types.ObjectId(serviceId) })
            .populate('userId', 'name email profilePicture')
            .sort({ createdAt: -1 })
            .lean();

        // Calculate rating distribution
        const ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let totalRating = 0;

        reviews.forEach(review => {
            if (review.rating >= 1 && review.rating <= 5) {
                ratingDistribution[review.rating]++;
                totalRating += review.rating;
            }
        });

        const averageRating = reviews.length > 0 ? totalRating / reviews.length : 0;

        // Get similar services from ServiceRequest
        const similarServices = await ServiceRequest.aggregate([
            {
                $match: {
                    categoryId: serviceRequest[0].category._id,
                    status: 'approved',
                    serviceId: { $ne: new mongoose.Types.ObjectId(serviceId) }
                }
            },
            {
                $lookup: {
                    from: 'services',
                    localField: 'serviceId',
                    foreignField: '_id',
                    as: 'service'
                }
            },
            { $unwind: '$service' },
            { $limit: 5 },
            {
                $project: {
                    _id: '$service._id',
                    name: '$service.name',
                    icon: '$service.icon',
                    price: '$service.price',
                    averageRating: '$service.averageRating'
                }
            }
        ]);

        const response = {
            ...serviceRequest[0],
            totalReviews: reviews.length,
            ratingDistribution,
            averageRating: serviceRequest[0].averageRating || averageRating,
            reviews: reviews.map(review => ({
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
            })),
            similarServices,
            stats: {
                totalApprovedProviders: 1,
                averageRating: serviceRequest[0].averageRating || averageRating,
                totalRatings: reviews.length
            }
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

// Helper function to calculate distance
function calculateDistance(coord1, coord2) {
    if (!coord1 || !coord2) return null;
    const [lng1, lat1] = coord1;
    const [lng2, lat2] = coord2;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Get recommended services from ServiceRequest only
export const getRecommendedServices = async (req, res) => {
    try {
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

        const user = await User.findById(userId).select('location');
        let userCoordinates = null;

        if (user?.location?.coordinates && user.location.coordinates.length === 2) {
            userCoordinates = user.location.coordinates;
        }

        // Build pipeline for approved services
        let pipeline = [
            { $match: { status: 'approved' } },
            {
                $lookup: {
                    from: 'services',
                    localField: 'serviceId',
                    foreignField: '_id',
                    as: 'service'
                }
            },
            { $unwind: '$service' },
            {
                $lookup: {
                    from: 'categories',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'category'
                }
            },
            { $unwind: '$category' },
            {
                $lookup: {
                    from: 'providers',
                    localField: 'providerId',
                    foreignField: '_id',
                    as: 'provider'
                }
            },
            { $unwind: '$provider' },
            {
                $lookup: {
                    from: 'users',
                    localField: 'provider.userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' }
        ];

        // Filter by rating 4+
        pipeline.push({
            $match: {
                $or: [
                    { 'service.averageRating': { $gte: 4 } },
                    { 'service.averageRating': 0 }
                ]
            }
        });

        let serviceRequests = await ServiceRequest.aggregate(pipeline);

        // Calculate distances and filter
        let filteredServices = serviceRequests.map(request => {
            let distance = null;
            let isNearby = false;

            if (userCoordinates && request.user?.location?.coordinates) {
                distance = calculateDistance(
                    userCoordinates,
                    request.user.location.coordinates
                );
                isNearby = distance <= 1;
            }

            return {
                _id: request.service._id,
                name: request.service.name,
                icon: request.service.icon,
                price: request.service.price,
                description: request.service.description?.substring(0, 100),
                averageRating: request.service.averageRating || 0,
                totalReviews: request.service.reviews?.length || 0,
                category: {
                    _id: request.category._id,
                    name: request.category.name,
                    icon: request.category.icon
                },
                provider: {
                    _id: request.provider._id,
                    name: request.user.name,
                    email: request.user.email,
                    phone: request.user.phone,
                    profilePicture: request.user.profilePicture
                },
                isNearby: isNearby,
                distance: distance ? distance.toFixed(2) : null
            };
        });

        // Sort and paginate
        filteredServices.sort((a, b) => {
            if (a.isNearby && !b.isNearby) return -1;
            if (!a.isNearby && b.isNearby) return 1;
            return b.averageRating - a.averageRating;
        });

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

// Get popular services from ServiceRequest only
export const getPopularServices = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const popularServices = await ServiceRequest.aggregate([
            { $match: { status: 'approved' } },
            {
                $lookup: {
                    from: 'services',
                    localField: 'serviceId',
                    foreignField: '_id',
                    as: 'service'
                }
            },
            { $unwind: '$service' },
            {
                $lookup: {
                    from: 'categories',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'category'
                }
            },
            { $unwind: '$category' },
            {
                $lookup: {
                    from: 'providers',
                    localField: 'providerId',
                    foreignField: '_id',
                    as: 'provider'
                }
            },
            { $unwind: '$provider' },
            {
                $lookup: {
                    from: 'users',
                    localField: 'provider.userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            {
                $group: {
                    _id: '$serviceId',
                    service: { $first: '$service' },
                    category: { $first: '$category' },
                    provider: { $first: '$provider' },
                    user: { $first: '$user' },
                    requestCount: { $sum: 1 }
                }
            },
            {
                $addFields: {
                    popularityScore: {
                        $add: [
                            { $multiply: ['$service.averageRating', 2] },
                            { $divide: [{ $size: { $ifNull: ['$service.reviews', []] } }, 5] },
                            { $divide: ['$requestCount', 10] }
                        ]
                    }
                }
            },
            { $sort: { popularityScore: -1, 'service.averageRating': -1 } },
            { $skip: skip },
            { $limit: limit },
            {
                $project: {
                    _id: '$service._id',
                    name: '$service.name',
                    icon: '$service.icon',
                    price: '$service.price',
                    description: '$service.description',
                    averageRating: '$service.averageRating',
                    totalReviews: { $size: { $ifNull: ['$service.reviews', []] } },
                    requestCount: 1,
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
                    }
                }
            }
        ]);

        // Get total count of unique services
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

// Get top rated services from ServiceRequest only
export const getTopRatedServices = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const pipeline = [
            { $match: { status: 'approved' } },
            {
                $lookup: {
                    from: 'services',
                    localField: 'serviceId',
                    foreignField: '_id',
                    as: 'service'
                }
            },
            { $unwind: '$service' },
            {
                $match: {
                    'service.averageRating': { $gte: 3 }
                }
            },
            {
                $lookup: {
                    from: 'categories',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'category'
                }
            },
            { $unwind: '$category' },
            {
                $lookup: {
                    from: 'providers',
                    localField: 'providerId',
                    foreignField: '_id',
                    as: 'provider'
                }
            },
            { $unwind: '$provider' },
            {
                $lookup: {
                    from: 'users',
                    localField: 'provider.userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            { $sort: { 'service.averageRating': -1, 'service.reviews': -1 } },
            { $skip: skip },
            { $limit: limit },
            {
                $project: {
                    _id: '$service._id',
                    name: '$service.name',
                    icon: '$service.icon',
                    price: '$service.price',
                    description: '$service.description',
                    averageRating: '$service.averageRating',
                    totalReviews: { $size: { $ifNull: ['$service.reviews', []] } },
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
                    }
                }
            }
        ];

        const [services, totalCountResult] = await Promise.all([
            ServiceRequest.aggregate(pipeline),
            ServiceRequest.aggregate([
                { $match: { status: 'approved' } },
                {
                    $lookup: {
                        from: 'services',
                        localField: 'serviceId',
                        foreignField: '_id',
                        as: 'service'
                    }
                },
                { $unwind: '$service' },
                { $match: { 'service.averageRating': { $gte: 3 } } },
                { $group: { _id: '$serviceId' } },
                { $count: 'total' }
            ])
        ]);

        const totalCount = totalCountResult[0]?.total || 0;
        const totalPages = Math.ceil(totalCount / limit);

        res.status(200).json(
            new ApiResponse(200, {
                services: services,
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



export const quickSearch = async (req, res) => {
    try {
        const { q } = req.query;
        
        if (!q?.trim()) {
            return res.status(200).json(
                new ApiResponse(200, {
                    services: [],
                    query: null
                }, 'No search keyword')
            );
        }

        const searchKeyword = q.trim();

        const services = await ServiceRequest.aggregate([
            { $match: { status: 'approved' } },
            
            // Get service details
            {
                $lookup: {
                    from: 'services',
                    localField: 'serviceId',
                    foreignField: '_id',
                    as: 'service'
                }
            },
            { $unwind: '$service' },
            
            {
                $lookup: {
                    from: 'categories',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'category'
                }
            },
            { $unwind: '$category' },
            
            // Get provider details
            {
                $lookup: {
                    from: 'providers',
                    localField: 'providerId',
                    foreignField: '_id',
                    as: 'provider'
                }
            },
            { $unwind: '$provider' },
            
            {
                $lookup: {
                    from: 'users',
                    localField: 'provider.userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            
            {
                $match: {
                    $or: [
                        { 'service.name': { $regex: searchKeyword, $options: 'i' } },
                        { 'category.name': { $regex: searchKeyword, $options: 'i' } },
                        { 'user.name': { $regex: searchKeyword, $options: 'i' } },
                        { 'provider.businessName': { $regex: searchKeyword, $options: 'i' } }
                    ]
                }
            },
            
            // Project the required fields
            {
                $project: {
                    _id: '$service._id',
                    name: '$service.name',
                    icon: '$service.icon',
                    price: '$service.price',
                    description: '$service.description',
                    averageRating: '$service.averageRating',
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
                        profilePicture: '$user.profilePicture',
                        businessName: '$provider.businessName'
                    }
                }
            },
            
            { $limit: 10 }
        ]);

        res.status(200).json(
            new ApiResponse(200, {
                query: searchKeyword,
                services: services,
                count: services.length
            }, 'Search completed successfully')
        );
    } catch (error) {
        console.error('Quick search error:', error);
        res.status(500).json(
            new ApiResponse(500, null, error.message || 'Search failed')
        );
    }
};