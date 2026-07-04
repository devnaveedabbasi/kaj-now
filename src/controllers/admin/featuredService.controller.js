import mongoose from 'mongoose';
import PopularService from '../../models/admin/popularService.model.js';
import RecommendedService from '../../models/admin/recommendedService.model.js';
import ServiceRequest from '../../models/admin/serviceRequest.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';

// GET /featured-requests
// Returns the popular and recommended service requests fully populated
export const getFeaturedServiceRequests = async (req, res) => {
    try {
        const userRegion = req.user?.region || 'BD';
        const regionFilter = userRegion === 'UK'
            ? { 'userArr.region': 'UK' }
            : { 'userArr.region': { $nin: ['UK'] } };

        const [popularDocs, recommendedDocs] = await Promise.all([
            PopularService.find().lean(),
            RecommendedService.find().lean()
        ]);

        const popularIds = popularDocs.map(p => p.serviceRequestId.toString());
        const recommendedIds = recommendedDocs.map(r => r.serviceRequestId.toString());
        const allFeaturedIds = [...new Set([...popularIds, ...recommendedIds])];

        if (allFeaturedIds.length === 0) {
            return res.status(200).json(
                new ApiResponse(200, {
                    popular: [],
                    recommended: []
                }, 'Featured service requests retrieved successfully')
            );
        }

        const pipeline = [
            {
                $match: {
                    _id: { $in: allFeaturedIds.map(id => new mongoose.Types.ObjectId(id)) },
                    status: 'approved'
                }
            },
            {
                $lookup: {
                    from: 'services',
                    localField: 'serviceId',
                    foreignField: '_id',
                    as: 'services'
                }
            },
            {
                $lookup: {
                    from: 'categories',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'categoryArr'
                }
            },
            { $unwind: { path: '$categoryArr', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'providers',
                    localField: 'providerId',
                    foreignField: '_id',
                    as: 'providerArr'
                }
            },
            { $unwind: { path: '$providerArr', preserveNullAndEmptyArrays: true } },
            {
                $lookup: {
                    from: 'users',
                    localField: 'providerArr.userId',
                    foreignField: '_id',
                    as: 'userArr'
                }
            },
            { $unwind: { path: '$userArr', preserveNullAndEmptyArrays: true } },
            { $match: regionFilter },
            {
                $project: {
                    _id: 1,
                    createdAt: 1,
                    category: {
                        _id: '$categoryArr._id',
                        name: '$categoryArr.name',
                        icon: '$categoryArr.icon'
                    },
                    provider: {
                        _id: '$providerArr._id',
                        name: '$userArr.name',
                        email: '$userArr.email',
                        profilePicture: '$userArr.profilePicture',
                        location: '$providerArr.location'
                    },
                    services: {
                        $map: {
                            input: '$services',
                            as: 's',
                            in: {
                                _id: '$$s._id',
                                name: '$$s.name',
                                price: '$$s.price',
                                icon: '$$s.icon',
                                averageRating: '$$s.averageRating',
                                description: '$$s.description'
                            }
                        }
                    }
                }
            }
        ];

        const serviceRequests = await ServiceRequest.aggregate(pipeline);

        // Use a Map for O(1) lookup by ServiceRequest._id (never gets overwritten in projection)
        const srMap = new Map(serviceRequests.map(s => [s._id.toString(), s]));

        const popular = popularDocs
            .map(doc => {
                const enriched = srMap.get(doc.serviceRequestId.toString());
                return enriched ? { featuredId: doc._id, ...enriched } : null;
            })
            .filter(Boolean);

        const recommended = recommendedDocs
            .map(doc => {
                const enriched = srMap.get(doc.serviceRequestId.toString());
                return enriched ? { featuredId: doc._id, ...enriched } : null;
            })
            .filter(Boolean);

       
        res.status(200).json(
            new ApiResponse(200, {
                popular,
                recommended,
            }, 'Featured service requests retrieved successfully')
        );
    } catch (error) {
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            console.error('Error getting featured requests:', error);
            res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
        }
    }
};

// GET /featured-requests/eligible
// Returns all approved, active, non-deleted service requests (paginated) for the admin to pick from
export const getAllEligibleRequests = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const search = req.query.search || '';
        const region = req.query.region;
        // Base pipeline: approved + active/non-deleted services & categories
        const basePipeline = [
            { $match: { status: 'approved' } },
            // Join services (serviceId is an array)
            {
                $lookup: {
                    from: 'services',
                    localField: 'serviceId',
                    foreignField: '_id',
                    as: 'services'
                }
            },
            // Join category
            {
                $lookup: {
                    from: 'categories',
                    localField: 'categoryId',
                    foreignField: '_id',
                    as: 'categoryArr'
                }
            },
            { $unwind: { path: '$categoryArr', preserveNullAndEmptyArrays: false } },
            // Filter: category must be active & not deleted
            {
                $match: {
                    'categoryArr.isActive': true,
                    'categoryArr.isDeleted': false,
                    ...(region === 'UK' ? { 'categoryArr.region': 'UK' } : {}),
                    ...(region === 'BD' ? { 'categoryArr.region': { $ne: 'UK' } } : {})
                }
            },
            // Join provider
            {
                $lookup: {
                    from: 'providers',
                    localField: 'providerId',
                    foreignField: '_id',
                    as: 'providerArr'
                }
            },
            { $unwind: { path: '$providerArr', preserveNullAndEmptyArrays: false } },
            // Join provider user
            {
                $lookup: {
                    from: 'users',
                    localField: 'providerArr.userId',
                    foreignField: '_id',
                    as: 'userArr'
                }
            },
            { $unwind: { path: '$userArr', preserveNullAndEmptyArrays: false } },
            // Check if popular
            {
                $lookup: {
                    from: 'popularservices',
                    localField: '_id',
                    foreignField: 'serviceRequestId',
                    as: 'popularCheck'
                }
            },
            // Check if recommended
            {
                $lookup: {
                    from: 'recommendedservices',
                    localField: '_id',
                    foreignField: 'serviceRequestId',
                    as: 'recommendedCheck'
                }
            }
        ];

        // Optional search
        if (search) {
            basePipeline.push({
                $match: {
                    $or: [
                        { 'services.name': { $regex: search, $options: 'i' } },
                        { 'userArr.name': { $regex: search, $options: 'i' } },
                        { 'categoryArr.name': { $regex: search, $options: 'i' } }
                    ]
                }
            });
        }

        // Project shape
        const projectStage = {
            $project: {
                _id: 1,
                status: 1,
                createdAt: 1,
                isPopular: { $gt: [{ $size: '$popularCheck' }, 0] },
                isRecommended: { $gt: [{ $size: '$recommendedCheck' }, 0] },
                categoryId: {
                    _id: '$categoryArr._id',
                    name: '$categoryArr.name',
                    icon: '$categoryArr.icon'
                },
                providerId: {
                    _id: '$providerArr._id',
                    userId: {
                        _id: '$userArr._id',
                        name: '$userArr.name',
                        email: '$userArr.email',
                        profilePicture: '$userArr.profilePicture'
                    }
                },
                serviceId: {
                    $map: {
                        input: '$services',
                        as: 's',
                        in: {
                            _id: '$$s._id',
                            name: '$$s.name',
                            price: '$$s.price',
                            icon: '$$s.icon',
                            description: '$$s.description'
                        }
                    }
                }
            }
        };

        const [requests, totalCountResult] = await Promise.all([
            ServiceRequest.aggregate([
                ...basePipeline,
                { $sort: { createdAt: -1 } },
                { $skip: skip },
                { $limit: limit },
                projectStage
            ]),
            ServiceRequest.aggregate([
                ...basePipeline,
                { $count: 'total' }
            ])
        ]);

        const totalCount = totalCountResult[0]?.total || 0;
        const totalPages = Math.ceil(totalCount / limit);

        res.status(200).json(
            new ApiResponse(200, {
                requests,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: totalCount,
                    itemsPerPage: limit,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                }
            }, 'Eligible requests retrieved successfully')
        );
    } catch (error) {
        console.error('Error fetching eligible requests:', error);
        res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
    }
};

// POST /featured-requests/popular/:id
export const togglePopularRequest = async (req, res) => {
    try {
        const { id } = req.params;

        const serviceReq = await ServiceRequest.findById(id);
        if (!serviceReq || serviceReq.status !== 'approved') {
            throw new ApiError(404, 'Approved service request not found');
        }

        const existing = await PopularService.findOne({ serviceRequestId: id });
        let isAdded = false;

        if (existing) {
            await PopularService.deleteOne({ _id: existing._id });
        } else {
            const count = await PopularService.countDocuments();
            if (count >= 10) {
                throw new ApiError(400, 'Maximum limit of 10 popular services reached');
            }
            await PopularService.create({ serviceRequestId: id });
            isAdded = true;
        }

        res.status(200).json(
            new ApiResponse(200, { serviceRequestId: id, isAdded }, `Service request ${isAdded ? 'added to' : 'removed from'} popular services`)
        );
    } catch (error) {
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            console.error('Error toggling popular request:', error);
            res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
        }
    }
};

// POST /featured-requests/recommended/:id
export const toggleRecommendedRequest = async (req, res) => {
    try {
        const { id } = req.params;

        const serviceReq = await ServiceRequest.findById(id);
        if (!serviceReq || serviceReq.status !== 'approved') {
            throw new ApiError(404, 'Approved service request not found');
        }

        const existing = await RecommendedService.findOne({ serviceRequestId: id });
        let isAdded = false;

        if (existing) {
            await RecommendedService.deleteOne({ _id: existing._id });
        } else {
            const count = await RecommendedService.countDocuments();
            if (count >= 10) {
                throw new ApiError(400, 'Maximum limit of 10 recommended services reached');
            }
            await RecommendedService.create({ serviceRequestId: id });
            isAdded = true;
        }

        res.status(200).json(
            new ApiResponse(200, { serviceRequestId: id, isAdded }, `Service request ${isAdded ? 'added to' : 'removed from'} recommended services`)
        );
    } catch (error) {
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            console.error('Error toggling recommended request:', error);
            res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
        }
    }
};
