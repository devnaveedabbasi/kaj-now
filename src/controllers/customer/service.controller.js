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
const RADII = [10, 15, 20, 30];

function calculateDistance(coord1, coord2) {
    if (!coord1?.length || !coord2?.length) return null;

    const [lng1, lat1] = coord1;
    const [lng2, lat2] = coord2;

    const R = 6371;

    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lng2 - lng1) * Math.PI / 180;

    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) *
        Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) ** 2;

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

// Get recommended services from ServiceRequest only
export const getRecommendedServices = async (req, res) => {
    try {
        if (!req.user?._id) {
            return res.status(200).json(
                new ApiResponse(200, {
                    services: [],
                    message: "Please login to see recommendations"
                })
            );
        }

        const user = await User.findById(req.user._id).select("location");

        const userCoordinates =
            user?.location?.coordinates?.length === 2
                ? user.location.coordinates
                : null;

        const pipeline = [
            { $match: { status: "approved" } },

            {
                $lookup: {
                    from: "services",
                    localField: "serviceId",
                    foreignField: "_id",
                    as: "service",
                },
            },
            { $unwind: "$service" },

            {
                $lookup: {
                    from: "categories",
                    localField: "categoryId",
                    foreignField: "_id",
                    as: "category",
                },
            },
            { $unwind: "$category" },

            {
                $lookup: {
                    from: "providers",
                    localField: "providerId",
                    foreignField: "_id",
                    as: "provider",
                },
            },
            { $unwind: "$provider" },

            {
                $lookup: {
                    from: "users",
                    localField: "provider.userId",
                    foreignField: "_id",
                    as: "user",
                },
            },
            { $unwind: "$user" },
        ];

        let serviceRequests = await ServiceRequest.aggregate(pipeline);

        let results = [];

        // =========================
        // 🔁 MULTI RADIUS SEARCH
        // =========================
        for (let radius of RADII) {
            results = serviceRequests
                .map((req) => {
                    let distance = null;

                    if (
                        userCoordinates &&
                        req.user?.location?.coordinates?.length === 2
                    ) {
                        distance = calculateDistance(
                            userCoordinates,
                            req.user.location.coordinates
                        );
                    }

                    return {
                        _id: req.service._id,
                        name: req.service.name,
                        icon: req.service.icon,
                        price: req.service.price,
                        description: req.service.description?.substring(0, 100),

                        averageRating: req.service.averageRating || 0,
                        totalReviews: req.service.reviews?.length || 0,

                        category: {
                            _id: req.category._id,
                            name: req.category.name,
                            icon: req.category.icon,
                        },

                        provider: {
                            _id: req.provider._id,
                            name: req.user.name,
                            email: req.user.email,
                            phone: req.user.phone,
                            profilePicture: req.user.profilePicture,
                        },

                        distance,
                        radiusMatched: radius,
                        isWithinRadius:
                            distance !== null && distance <= radius,
                    };
                })
                .filter((item) => {
                    if (!userCoordinates) return true;
                    return item.distance !== null && item.distance <= radius;
                });

            // 👉 agar results mil gaye to break
            if (results.length > 0) break;
        }

        // =========================
        // 🧠 SORTING (SMART RANKING)
        // =========================
        results.sort((a, b) => {
            // priority 1: distance
            if (a.distance !== null && b.distance !== null) {
                return a.distance - b.distance;
            }

            // priority 2: rating
            return b.averageRating - a.averageRating;
        });

        // =========================
        // 🔥 TOP 6 ONLY
        // =========================
        const topServices = results.slice(0, 6);

        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    services: topServices,
                    totalFound: results.length,
                    usedRadius: results[0]?.radiusMatched || null,
                    hasLocation: !!userCoordinates,
                },
                "Smart recommended services fetched successfully"
            )
        );
    } catch (error) {
        console.error("Recommendation Error:", error);
        return res
            .status(500)
            .json(new ApiResponse(500, null, error.message));
    }
};
// Get top rated services from ServiceRequest only
export const getTopRatedServices = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 6;

        const pipeline = [
            { $match: { status: "approved" } },

            {
                $lookup: {
                    from: "services",
                    localField: "serviceId",
                    foreignField: "_id",
                    as: "service",
                },
            },
            { $unwind: "$service" },

            // =========================
            // 🧠 IMPORTANT FIX
            // include even low ratings (NO FILTER)
            // =========================

            {
                $lookup: {
                    from: "categories",
                    localField: "categoryId",
                    foreignField: "_id",
                    as: "category",
                },
            },
            { $unwind: "$category" },

            {
                $lookup: {
                    from: "providers",
                    localField: "providerId",
                    foreignField: "_id",
                    as: "provider",
                },
            },
            { $unwind: "$provider" },

            {
                $lookup: {
                    from: "users",
                    localField: "provider.userId",
                    foreignField: "_id",
                    as: "user",
                },
            },
            { $unwind: "$user" },

            // =========================
            // 🧠 SORTING (MOST IMPORTANT)
            // =========================
            {
                $addFields: {
                    rating: { $ifNull: ["$service.averageRating", 0] },
                    reviewsCount: {
                        $size: { $ifNull: ["$service.reviews", []] },
                    },
                },
            },

            {
                $sort: {
                    rating: -1,        // highest rating first
                    reviewsCount: -1,  // more reviews next
                    createdAt: -1,     // fallback latest
                },
            },

            { $limit: limit },

            {
                $project: {
                    _id: "$service._id",
                    name: "$service.name",
                    icon: "$service.icon",
                    price: "$service.price",
                    description: "$service.description",

                    averageRating: "$rating",
                    totalReviews: "$reviewsCount",

                    category: {
                        _id: "$category._id",
                        name: "$category.name",
                        icon: "$category.icon",
                    },

                    provider: {
                        _id: "$provider._id",
                        name: "$user.name",
                        email: "$user.email",
                        phone: "$user.phone",
                        profilePicture: "$user.profilePicture",
                    },
                },
            },
        ];

        const services = await ServiceRequest.aggregate(pipeline);

        // =========================
        // 🧠 SAFETY FALLBACK (IMPORTANT)
        // =========================
        const safeServices = services || [];

        return res.status(200).json(
            new ApiResponse(
                200,
                {
                    services: safeServices,
                    count: safeServices.length,
                    isFallback: safeServices.length < limit,
                },
                "Top rated services fetched successfully"
            )
        );
    } catch (error) {
        console.error("Top Rated Error:", error);
        return res
            .status(500)
            .json(new ApiResponse(500, null, error.message));
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