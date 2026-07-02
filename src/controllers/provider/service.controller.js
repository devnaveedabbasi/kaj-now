import mongoose from 'mongoose';
import Service from '../../models/admin/service.model.js';
import ServiceRequest from '../../models/admin/serviceRequest.model.js';
import Category from '../../models/admin/category.model.js';
import Provider from '../../models/provider/Provider.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import Job from '../../models/job.model.js';


export const getAllCategories = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
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

        if(provider.approvedServices && provider.approvedServices.length > 0){
            const alreadyApprovedIds = provider.approvedServices.map(id => id.toString());
            const duplicateIds = finalServiceIds.filter(id => alreadyApprovedIds.includes(id));
            if(duplicateIds.length > 0){
                throw new ApiError(409, `Already have approved requests for service`);
            }
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
    const { status } = req.query; // optional filter

    const provider = await Provider.findOne({ userId })
      .populate("userId", "name email profilePicture")
      .populate("approvedServices", "name icon price description averageRating isActive isDeleted");

    if (!provider) throw new ApiError(404, "Provider profile not found");

    // Build query — status filter ho to use karo, warna sab fetch karo
    const query = { providerId: provider._id };
    if (status) query.status = status;

    const serviceRequests = await ServiceRequest.find(query)
      .populate("serviceId", "name icon price description averageRating isActive isDeleted")
      .lean();

    // Har request ko format karo with its services
    const services = serviceRequests.flatMap((request) =>
      (request.serviceId || []).map((service) => ({
        _id: service._id,
        name: service.name,
        icon: service.icon,
        price: service.price,
        description: service.description,
        averageRating: service.averageRating || 0,
        status: request.status,           // pending / approved / rejected
        requestId: request._id,
        rejectionReason: request.rejectionReason || null,
        notes: request.notes || null,
        requestedAt: request.requestedAt,
        reviewedAt: request.reviewedAt || null,
      }))
    );

    return res.status(200).json(new ApiResponse(200, {
      _id: provider._id,
      providerName: provider.userId?.name || "Unknown",
      providerEmail: provider.userId?.email || "Unknown",
      profilePicture: provider.userId?.profilePicture || null,
      totalServices: services.length,
      services,
    }, "Services retrieved successfully"));

  } catch (error) {
    console.error("Error getting services:", error);
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
    }
    return res.status(500).json(new ApiResponse(500, null, "Internal server error"));
  }
};




export const getServiceById = async (req, res) => {
    try {
        const { serviceId } = req.params;
        if (!mongoose.Types.ObjectId.isValid(serviceId)) {
            throw new ApiError(400, 'Invalid service ID format');
        }

        const provider = await Provider.findOne({ userId: req.user._id });
        if (!provider) throw new ApiError(404, 'Provider profile not found');

        const serviceRequest = await ServiceRequest.findOne({
            serviceId: serviceId,
            providerId: provider._id
        })
            .populate('providerId', 'userId businessName businessPhone businessEmail location')
            .populate('serviceId', 'name price icon description categoryId averageRating')
            .populate('categoryId', 'name icon')
            .lean();

        if (!serviceRequest) {
            throw new ApiError(404, 'Service request not found');
        }

        // Get provider user details
        let providerUser = null;
        if (serviceRequest.providerId?.userId) {
            providerUser = await mongoose.model('User').findById(serviceRequest.providerId.userId)
                .select('name email profilePicture phoneNumber')
                .lean();
        }

        // Get reviews for the service
        let reviews = [];
        let ratingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        let totalRating = 0;

        // Requested service ko array mein se dhundho
        const targetService = serviceRequest.serviceId?.find(
            s => s._id.toString() === serviceId
        ) || serviceRequest.serviceId?.[0];

        if (targetService) {
            reviews = await mongoose.model('Review').find({
                service: targetService._id
            })
            .populate('userId', 'name email profilePicture')
            .lean();

            if (reviews.length > 0) {
                reviews.forEach(review => {
                    ratingDistribution[review.rating]++;
                    totalRating += review.rating;
                });
            }
        }

        const formattedReviews = reviews.map(review => ({
            _id: review._id,
            rating: review.rating,
            comment: review.comment,
            userName: review.userId?.name || 'Anonymous',
            userEmail: review.userId?.email,
            userImage: review.userId?.profilePicture || null,
            createdAt: review.createdAt,
            updatedAt: review.updatedAt
        }));

        const response = {
            _id: serviceRequest._id,
            name: targetService?.name || 'N/A',
            description: targetService?.description || 'No description available',
            icon: targetService?.icon || null,
            price: targetService?.price || 0,
            isActive: serviceRequest.status === 'approved',
            averageRating: targetService?.averageRating || 0,
            totalReviews: reviews.length,

            // Provider (service owner)
            provider: {
                _id: providerUser?._id,
                name: providerUser?.name,
                email: providerUser?.email,
                phone: providerUser?.phoneNumber,
                profilePicture: providerUser?.profilePicture,
                location: serviceRequest.providerId?.location,
            },

            // Category
            category: {
                _id: serviceRequest.categoryId?._id,
                name: serviceRequest.categoryId?.name,
                icon: serviceRequest.categoryId?.icon
            },

            // Reviews
            reviews: formattedReviews,
            ratingDistribution,

            stats: {
                averageRating: targetService?.averageRating || 0,
                totalRatings: reviews.length
            },

            createdAt: serviceRequest.createdAt,
            updatedAt: serviceRequest.updatedAt
        };

        res.status(200).json(
            new ApiResponse(200, response, 'Service request retrieved successfully')
        );

    } catch (error) {
        console.error('Error getting service request:', error);

        if (error instanceof ApiError) {
            return res
                .status(error.statusCode)
                .json(new ApiResponse(error.statusCode, null, error.message));
        }

        res.status(500).json(
            new ApiResponse(500, null, 'Internal server error')
        );
    }
};



export const deleteService = async (req, res) => {
  try {
    const userId = req.user._id;
    const { serviceId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(serviceId)) {
      throw new ApiError(400, 'Invalid service ID');
    }

    // 1. Provider
    const provider = await Provider.findOne({ userId });
    if (!provider) {
      throw new ApiError(404, 'Provider not found');
    }

    // 2. Service Request
    const serviceRequest = await ServiceRequest.findOne({
      providerId: provider._id,
      serviceId: { $in: [serviceId] }
    });

    if (!serviceRequest) {
      throw new ApiError(404, 'Service request not found');
    }

    // 3. CHECK: koi bhi non-completed job ho to block
    const blockingJob = await Job.findOne({
      provider: provider._id,
      service: serviceId,
      status: { $nin: ['confirmed_by_user', 'confirmed_by_admin', 'cancelled'] } //  IMPORTANT
    });

    if (blockingJob) {
      throw new ApiError(
        400,
        'Service cannot be deleted. Job is still in progress or not completed.'
      );
    }

    // 4. DELETE SERVICE REQUEST 
    await ServiceRequest.deleteOne({ _id: serviceRequest._id });

    // 5. REMOVE FROM PROVIDER APPROVED SERVICES 
    await Provider.updateOne(
      { _id: provider._id },
      {
        $pull: { approvedServices: serviceId }
      }
    );

    return res.status(200).json(
      new ApiResponse(200, null, 'Service deleted successfully')
    );

  } catch (error) {
    console.error('Delete Service Error:', error);

    return res.status(error.statusCode || 500).json(
      new ApiResponse(error.statusCode || 500, null, error.message)
    );
  }
};