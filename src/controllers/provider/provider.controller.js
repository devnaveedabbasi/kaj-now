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
    const userId = req.user._id;
    const { serviceId } = req.body;
    console.log('Requesting service with ID:', serviceId, 'by user:', userId);
    
    if (!serviceId) {
        throw new ApiError(400, 'Service ID is required');
    }
    
    // Get provider
    const provider = await Provider.findOne({ userId });
    if (!provider) {
        throw new ApiError(404, 'Provider profile not found');
    }
    
    // Verify service exists
    const service = await Service.findById(serviceId);
    if (!service) {
        throw new ApiError(404, 'Service not found');
    }
    
    // Check if already requested
    const existingRequest = await ServiceRequest.findOne({
        providerId: provider._id,
        serviceId,
        status: { $in: ['pending', 'approved'] }
    });
    
    if (existingRequest) {
        throw new ApiError(409, `Already have a ${existingRequest.status} request for this service`);
    }
    
    //  REMOVED: ServiceAssignment check
    
    // Create request
    const request = await ServiceRequest.create({
        providerId: provider._id,
        serviceId,
        categoryId: service.categoryId
    });
    
    await request.populate('serviceId', 'name price');
    await request.populate('categoryId', 'name');
    
    res.status(201).json(
        new ApiResponse(201, request, 'Service request submitted successfully')
    );
};

export const getMyServiceRequests = async (req, res) => {
    const userId = req.user._id;
    const { status } = req.query;
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const provider = await Provider.findOne({ userId });
    if (!provider) {
        throw new ApiError(404, 'Provider profile not found');
    }
    
    let query = { providerId: provider._id };
    if (status) query.status = status;
    
    const [requests, totalCount] = await Promise.all([
        ServiceRequest.find(query)
            .populate('serviceId', 'name icon price')
            .populate('categoryId', 'name icon')
            .populate('reviewedByAdmin', 'name')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        ServiceRequest.countDocuments(query)
    ]);
    
    const totalPages = Math.ceil(totalCount / limit);
    
    res.status(200).json(
        new ApiResponse(200, {
            requests,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: totalCount,
                itemsPerPage: limit
            }
        }, 'Your service requests retrieved successfully')
    );
};

export const getMyApprovedServices = async (req, res) => {
    const userId = req.user._id;
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const provider = await Provider.findOne({ userId });
    if (!provider) {
        throw new ApiError(404, 'Provider profile not found');
    }
    
    //  Using ServiceRequest with status 'approved' instead of ServiceAssignment
    const [approvedServices, totalCount] = await Promise.all([
        ServiceRequest.find({ providerId: provider._id, status: 'approved' })
            .populate('serviceId', 'name icon price description')
            .populate('categoryId', 'name icon')
            .populate('reviewedByAdmin', 'name email')
            .sort({ reviewedAt: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        ServiceRequest.countDocuments({ providerId: provider._id, status: 'approved' })
    ]);
    
    const totalPages = Math.ceil(totalCount / limit);
    
    res.status(200).json(
        new ApiResponse(200, {
            approvedServices,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: totalCount,
                itemsPerPage: limit
            }
        }, 'Your approved services retrieved successfully')
    );
};