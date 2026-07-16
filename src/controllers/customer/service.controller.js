import mongoose from 'mongoose';
import Category from '../../models/admin/category.model.js';
import Service from '../../models/admin/service.model.js';
import ServiceRequest from '../../models/admin/serviceRequest.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import User from '../../models/User.model.js';
import Provider from '../../models/provider/Provider.model.js';
import Job from '../../models/job.model.js';

// UK ServiceRequests carry the provider's actual listing under the nested
// `ukService` subdocument (price/description/serviceImage/subServices) —
// the admin-created Service template itself has none of these (UK admins
// only set name/icon/category). BD keeps everything on the Service doc, so
// `$service.price` etc remain the fallback here, unchanged for BD.
const priceExpr = { $ifNull: ['$ukService.price', '$service.price'] };
const descriptionExpr = { $ifNull: ['$ukService.description', '$service.description'] };
const imagesExpr = {
    $let: {
        vars: { img: { $ifNull: ['$ukService.serviceImage', '$service.serviceImage'] } },
        in: { $cond: [{ $ifNull: ['$$img', false] }, ['$$img'], []] }
    }
};

// export const getAllCategories = async (req, res) => {
//     try {
//         const page = parseInt(req.query.page) || 1;
//         const limit = parseInt(req.query.limit) || 10;
//         const skip = (page - 1) * limit;
//         const search = req.query.search || '';
//         const sortField = req.query.sortBy || 'createdAt';
//         const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
//         const sort = { [sortField]: sortOrder };

//         // Get only ACTIVE and NON-DELETED categories from approved service requests
//         const aggregationPipeline = [
//             { $match: { status: 'approved' } },
//             {
//                 $lookup: {
//                     from: 'categories',
//                     localField: 'categoryId',
//                     foreignField: '_id',
//                     as: 'category'
//                 }
//             },
//             { $unwind: '$category' },
//             //  FILTER: Only active and non-deleted categories
//             {
//                 $match: {
//                     'category.isActive': true,
//                     'category.isDeleted': false
//                 }
//             },
//             ...(search ? [{ $match: { 'category.name': { $regex: search, $options: 'i' } } }] : []),
//             {
//                 $group: {
//                     _id: '$categoryId',
//                     name: { $first: '$category.name' },
//                     icon: { $first: '$category.icon' },
//                     createdAt: { $first: '$category.createdAt' },
//                     updatedAt: { $first: '$category.updatedAt' },
//                     serviceCount: { $sum: 1 }
//                 }
//             },
//             { $sort: sort },
//             { $skip: skip },
//             { $limit: limit }
//         ];

//         const categories = await ServiceRequest.aggregate(aggregationPipeline);

//         res.status(200).json({
//             success: true,
//             categories: categories,
//             pagination: {
//                 page: page,
//                 limit: limit
//             }
//         });
//     } catch (error) {
//         res.status(500).json({ success: false, message: error.message });
//     }
// };

export const getAllCategories = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const search = req.query.search || '';
        const sortField = req.query.sortBy || 'createdAt';
        const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
        const sort = { [sortField]: sortOrder };

        // User ki region
        const userRegion = req.user?.region; // 'United Kingdom' ya 'Bangladesh'
        const categoryRegion = req.user?.region === "UK" ? "UK" : "BD";
        const aggregationPipeline = [
            { $match: { status: 'approved' } },
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
                $match: {
                    'category.isActive': true,
                    'category.isDeleted': false,
                    // Region filter
                    "category.region": categoryRegion,

                }
            },
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
            { $limit: limit },
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

export const getServiceById = async (req, res) => {
    try {
        const { serviceId } = req.params;
        const categoryRegion = req.user?.region === "UK" ? "UK" : "BD";
        if (!mongoose.Types.ObjectId.isValid(serviceId)) {
            return res.status(400).json(new ApiResponse(400, null, 'Invalid service ID format'));
        }

        const service = await ServiceRequest.findOne({
            serviceId: { $in: [serviceId] },
            status: 'approved',
        })
            .populate({
                path: 'serviceId',
                match: { _id: new mongoose.Types.ObjectId(serviceId) },  // sirf wahi service jo maangi hai
                select: 'name price icon averageRating description reviews subServices'
            })
            .populate({
                path: 'providerId',
                select: 'userId location',
                populate: {
                    path: 'userId',
                    select: 'name email phone profilePicture'
                }
            })
            .lean();

        const jobCount = await Job.countDocuments({
            service: new mongoose.Types.ObjectId(serviceId),
            status: { $in: ['confirmed_by_admin', 'confirmed_by_user'] }
        }); console.log('Job count for service:', jobCount);

        console.log('Service found:', service);
        if (!service) {
            return res.status(404).json(new ApiResponse(404, null, 'Service not found'));
        }

        const category = await Category.findOne({
            _id: service.categoryId,
            isActive: true,
            isDeleted: false,
            region: categoryRegion
        });

        if (!category) {
            // Category doesn't exist, isn't active, or belongs to the other region.
            return res.status(404).json(new ApiResponse(404, null, 'Service not found'));
        }

        const relatedServices = await ServiceRequest.find({
            serviceId: serviceId,
            status: 'approved',
            _id: { $ne: service._id } // optional exclude current
        })
            .populate({
                path: 'serviceId',
                select: 'name price icon averageRating description'
            })
            .populate({
                path: 'providerId',
                select: 'userId location',
                populate: {
                    path: 'userId',
                    select: 'name email phone profilePicture'
                }
            })
            .lean();
        console.log('Related services found:', relatedServices);
        console.log('Service found:', service);
        const targetService = service.serviceId.find(
            s => s._id.toString() === serviceId
        );

        res.status(200).json(
            new ApiResponse(200, {
                service: {
                    _id: targetService._id,
                    name: targetService.name,
                    icon: targetService.icon,
                    // UK templates have no price/description of their own —
                    // fall back to what the provider submitted on the request.
                    price: targetService.price ?? service.ukService?.price,
                    description: targetService.description ?? service.ukService?.description,
                    images: service.ukService?.serviceImage ? [service.ukService.serviceImage] : [],
                    averageRating: targetService.averageRating,
                    reviews: targetService.reviews || [],
                    subServices: (service.ukService?.subServices?.length ? service.ukService.subServices : targetService.subServices) || [],
                    ordersCount: jobCount || 22,
                    provider: {
                        _id: service.providerId?._id,
                        name: service.providerId?.userId?.name,
                        email: service.providerId?.userId?.email,
                        phone: service.providerId?.userId?.phone,
                        profilePicture: service.providerId?.userId?.profilePicture,
                        location: service.providerId?.location,
                    }
                },
                relatedServices,
                category: category ? {
                    _id: category._id,
                    name: category.name,
                    icon: category.icon,
                    description: category.description
                } : null
            }, 'Service details retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting service by ID:', error);
        res.status(500).json(new ApiResponse(500, null, error.message));
    }
};


// export const getServicesByCategory = async (req, res) => {
//     try {
//         const { categoryId } = req.params;

//         if (!mongoose.Types.ObjectId.isValid(categoryId)) {
//             throw new ApiError(400, 'Invalid category ID format');
//         }

//         const category = await Category.findOne({
//             _id: categoryId,
//             isActive: true,
//             isDeleted: false
//         });


//         const services = await Service.find({
//             categoryId: categoryId,
//             isActive: true,
//             isDeleted: false
//         }).select('name icon price description averageRating');


//         const serviceResults = await ServiceRequest.aggregate([
//             { $match: { categoryId: new mongoose.Types.ObjectId(categoryId), status: 'approved' } },
//             {
//                 $lookup: {
//                     from: 'services',
//                     localField: 'serviceId',
//                     foreignField: '_id',
//                     as: 'service'
//                 }
//             },
//             { $unwind: '$service' }
//         ]);


//         res.status(200).json({
//             success: true, category: {

//             }, services: serviceResults.map(sr => ({
//                 _id: sr.service._id,
//                 name: sr.service.name,
//                 icon: sr.service.icon,
//                 price: sr.service.price,
//                 description: sr.service.description,
//                 averageRating: sr.service.averageRating
//             }))
//         });

//     } catch (error) {
//         res.status(500).json({ success: false, message: error.message });
//     }
// }

// Get services by category from ServiceRequest only
export const getServicesByCategory = async (req, res) => {
    try {
        const { categoryId } = req.params;
        const categoryRegion = req.user?.region === "UK" ? "UK" : "BD";

        if (!mongoose.Types.ObjectId.isValid(categoryId)) {
            throw new ApiError(400, 'Invalid category ID format');
        }

        const category = await Category.findOne({
            _id: categoryId,
            isActive: true,
            isDeleted: false,
            region: categoryRegion
        });

        if (!category) {
            throw new ApiError(404, 'Category not found');
        }

        const services = await ServiceRequest.aggregate([
            {
                $match: {
                    categoryId: new mongoose.Types.ObjectId(categoryId),
                    status: 'approved'
                }
            },

            // serviceId array unwind
            {
                $unwind: '$serviceId'
            },

            // get service
            {
                $lookup: {
                    from: 'services',
                    localField: 'serviceId',
                    foreignField: '_id',
                    as: 'service'
                }
            },
            {
                $unwind: '$service'
            },

            // active services only
            {
                $match: {
                    'service.isActive': true,
                    'service.isDeleted': false
                }
            },

            // get provider
            {
                $lookup: {
                    from: 'providers',
                    localField: 'providerId',
                    foreignField: '_id',
                    as: 'provider'
                }
            },
            {
                $unwind: '$provider'
            },

            // get provider user
            {
                $lookup: {
                    from: 'users',
                    localField: 'provider.userId',
                    foreignField: '_id',
                    as: 'providerUser'
                }
            },
            {
                $unwind: '$providerUser'
            },

            // active provider only
            {
                $match: {
                    'providerUser.isActive': true,
                    'providerUser.status': 'approved'
                }
            },

            // GROUP BY SERVICE
            {
                $group: {
                    _id: '$service._id',

                    name: {
                        $first: '$service.name'
                    },

                    icon: {
                        $first: '$service.icon'
                    },

                    price: {
                        $first: priceExpr
                    },

                    description: {
                        $first: descriptionExpr
                    },

                    images: {
                        $first: imagesExpr
                    },

                    averageRating: {
                        $first: '$service.averageRating'
                    },

                    providers: {
                        $push: {
                            _id: '$provider._id',
                            name: '$providerUser.name',
                            email: '$providerUser.email',
                            phone: '$providerUser.phone',
                            profilePicture: '$providerUser.profilePicture',
                            location: '$provider.location'
                        }
                    }
                }
            },

            {
                $sort: {
                    createdAt: -1
                }
            }
        ]);

        res.status(200).json(
            new ApiResponse(
                200,
                {
                    category: {
                        _id: category._id,
                        name: category.name,
                        icon: category.icon,
                        description: category.description
                    },

                    services
                },
                'Services fetched successfully'
            )
        );

    } catch (error) {
        console.error(error);

        if (error instanceof ApiError) {
            return res
                .status(error.statusCode)
                .json(
                    new ApiResponse(
                        error.statusCode,
                        null,
                        error.message
                    )
                );
        }

        res.status(500).json(
            new ApiResponse(
                500,
                null,
                error.message
            )
        );
    }
};

// Get all approved services from ServiceRequest only
export const getAllApprovedServices = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const search = req.query.search || '';
        const { categoryId, minPrice, maxPrice } = req.query;
        const categoryRegion = req.user?.region === "UK" ? "UK" : "BD";

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
            //  FILTER: Only active and non-deleted categories and services in the user's region
            {
                $match: {
                    'service.isActive': true,
                    'service.isDeleted': false,
                    'category.isActive': true,
                    'category.isDeleted': false,
                    'category.region': categoryRegion
                }
            },
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
            // UK services have no price of their own — resolve the actual
            // listing price up front so both filtering and the final
            // projection use the same value.
            { $addFields: { effectivePrice: priceExpr } }
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
            matchConditions['effectivePrice'] = {};
            if (minPrice !== undefined && minPrice !== '') {
                matchConditions['effectivePrice'].$gte = Number(minPrice);
            }
            if (maxPrice !== undefined && maxPrice !== '') {
                matchConditions['effectivePrice'].$lte = Number(maxPrice);
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
                    price: '$effectivePrice',
                    description: descriptionExpr,
                    images: imagesExpr,
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
            { $unwind: '$category' },
            //  FILTER: Only active and non-deleted categories and services in the user's region
            {
                $match: {
                    'service.isActive': true,
                    'service.isDeleted': false,
                    'category.isActive': true,
                    'category.isDeleted': false,
                    'category.region': categoryRegion
                }
            },
            { $addFields: { effectivePrice: priceExpr } }
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
        const categoryRegion = req.user?.region === "UK" ? "UK" : "BD";

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
            //  FILTER: Only active and non-deleted categories and services in the user's region
            {
                $match: {
                    'service.isActive': true,
                    'service.isDeleted': false,
                    'category.isActive': true,
                    'category.isDeleted': false,
                    'category.region': categoryRegion
                }
            },
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
                    price: priceExpr,
                    description: descriptionExpr,
                    images: imagesExpr,
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
            //  FILTER: Only active and non-deleted services
            {
                $match: {
                    'service.isActive': true,
                    'service.isDeleted': false
                }
            },
            { $limit: 5 },
            {
                $project: {
                    _id: '$service._id',
                    name: '$service.name',
                    icon: '$service.icon',
                    price: priceExpr,
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

        const userRegion = req.user?.region || 'BD';
        const regionFilter = userRegion === 'UK'
            ? { 'user.region': 'UK' }
            : { 'user.region': { $nin: ['UK'] } };
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
                $group: {
                    _id: "$service._id",
                    data: { $first: "$$ROOT" }
                }
            },
            {
                $replaceRoot: {
                    newRoot: "$data"
                }
            },

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
                $match: {
                    'service.isActive': true,
                    'service.isDeleted': false,
                    'category.isActive': true,
                    'category.isDeleted': false
                }
            },

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
            { $match: regionFilter },
        ];

        let serviceRequests = await ServiceRequest.aggregate(pipeline);

        let results = [];


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
                        price: req.ukService?.price ?? req.service.price,
                        description: (req.ukService?.description ?? req.service.description)?.substring(0, 100),
                        images: req.ukService?.serviceImage ? [req.ukService.serviceImage] : [],

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

            if (results.length > 0) break;
        }

        // STEP 1: sort
        results.sort((a, b) => {
            if (a.distance !== null && b.distance !== null) {
                if (a.distance !== b.distance) {
                    return a.distance - b.distance;
                }
            }
            return b.averageRating - a.averageRating;
        });

        // STEP 2: BALANCED PICK
        const final = [];
        const providerMap = new Map();
        const serviceSet = new Set();

        const MAX_PER_PROVIDER = 2; // 👈 key fix

        for (const item of results) {

            const providerId = item.provider._id.toString();
            const serviceId = item._id.toString();

            // skip duplicate service
            if (serviceSet.has(serviceId)) continue;

            // provider limit
            const count = providerMap.get(providerId) || 0;
            if (count >= MAX_PER_PROVIDER) continue;

            providerMap.set(providerId, count + 1);
            serviceSet.add(serviceId);

            final.push(item);

            if (final.length === 6) break;
        }

        // fallback fill
        if (final.length < 6) {
            for (const item of results) {
                if (final.length === 6) break;

                if (!serviceSet.has(item._id.toString())) {
                    final.push(item);
                }
            }
        }

        const topServices = final;


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
        const userRegion = req.user?.region || 'BD';
        const regionFilter = userRegion === 'UK'
            ? { 'user.region': 'UK' }
            : { 'user.region': { $nin: ['UK'] } };

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

            //  REMOVE DUPLICATE SERVICES
            {
                $group: {
                    _id: "$service._id",
                    data: { $first: "$$ROOT" }
                }
            },
            {
                $replaceRoot: {
                    newRoot: "$data"
                }
            },

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
                $match: {
                    'service.isActive': true,
                    'service.isDeleted': false,
                    'category.isActive': true,
                    'category.isDeleted': false
                }
            },

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
            { $match: regionFilter },

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
                    rating: -1,
                    reviewsCount: -1,
                    createdAt: -1,
                },
            },

            { $limit: limit },

            {
                $project: {
                    _id: "$service._id",
                    name: "$service.name",
                    icon: "$service.icon",
                    price: priceExpr,
                    description: descriptionExpr,
                    images: imagesExpr,

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
        const userRegion = req.user?.region || 'BD';
        const regionFilter = userRegion === 'UK'
            ? { 'user.region': 'UK' }
            : { 'user.region': { $nin: ['UK'] } };

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
            //  FILTER: Only active and non-deleted categories and services
            {
                $match: {
                    'service.isActive': true,
                    'service.isDeleted': false,
                    'category.isActive': true,
                    'category.isDeleted': false
                }
            },

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
                    ...regionFilter,
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
                    price: priceExpr,
                    description: descriptionExpr,
                    images: imagesExpr,
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