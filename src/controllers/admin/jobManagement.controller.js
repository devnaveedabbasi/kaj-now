import mongoose from 'mongoose';
import ServiceRequest from '../../models/admin/serviceRequest.model.js';
import ServiceAssignment from '../../models/admin/serviceAssignment.model.js';
import Service from '../../models/admin/service.model.js';
import Category from '../../models/admin/category.model.js';
import Provider from '../../models/provider/Provider.model.js';
import { Job } from '../../models/job.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import User from '../../models/User.model.js';

// Provider requests to join a service
export const requestService = async (req, res) => {
    const userId = req.user._id;
    const { serviceId } = req.body;
    
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
    
    // Check if already assigned
    const existingAssignment = await ServiceAssignment.findOne({
        providerId: provider._id,
        serviceId,
        isActive: true
    });
    
    if (existingAssignment) {
        throw new ApiError(409, 'You already have this service assigned');
    }
    
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

// Get provider's service requests
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

// Get provider's assigned services
export const getMyAssignedServices = async (req, res) => {
    const userId = req.user._id;
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const provider = await Provider.findOne({ userId });
    if (!provider) {
        throw new ApiError(404, 'Provider profile not found');
    }
    
    const [assignments, totalCount] = await Promise.all([
        ServiceAssignment.find({ providerId: provider._id, isActive: true })
            .populate('serviceId', 'name icon price description')
            .populate('categoryId', 'name icon')
            .sort({ assignedAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        ServiceAssignment.countDocuments({ providerId: provider._id, isActive: true })
    ]);
    
    const totalPages = Math.ceil(totalCount / limit);
    
    res.status(200).json(
        new ApiResponse(200, {
            assignedServices: assignments,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: totalCount,
                itemsPerPage: limit
            }
        }, 'Your assigned services retrieved successfully')
    );
};

// ===================== CUSTOMER SERVICE BROWSING =====================

// Get available services for a category (for customers to browse)
export const getServicesForCategory = async (req, res) => {
    const { categoryId } = req.params;
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const search = req.query.search || '';
    
    // Verify category exists
    const category = await Category.findOne({ _id: categoryId, isActive: true, isDeleted: false });
    if (!category) {
        throw new ApiError(404, 'Category not found');
    }
    
    let query = { categoryId, isActive: true, isDeleted: false };
    if (search) {
        query.name = { $regex: search, $options: 'i' };
    }
    
    const [services, totalCount] = await Promise.all([
        Service.find(query)
            .select('name icon price description')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        Service.countDocuments(query)
    ]);
    
    // Get provider info for each service
    const servicesWithProviders = await Promise.all(
        services.map(async (service) => {
            const providers = await ServiceAssignment.find({
                serviceId: service._id,
                isActive: true
            })
                .populate('providerId', 'name email')
                .lean();
            
            return {
                ...service,
                providers: providers.map(p => ({ id: p.providerId._id, name: p.providerId.name }))
            };
        })
    );
    
    const totalPages = Math.ceil(totalCount / limit);
    
    res.status(200).json(
        new ApiResponse(200, {
            category,
            services: servicesWithProviders,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: totalCount,
                itemsPerPage: limit
            }
        }, 'Services retrieved successfully')
    );
};

// Get available providers for a specific service
export const getProvidersForService = async (req, res) => {
    const { serviceId } = req.params;
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    // Verify service exists
    const service = await Service.findOne({ _id: serviceId, isActive: true, isDeleted: false });
    if (!service) {
        throw new ApiError(404, 'Service not found');
    }
    
    const [assignments, totalCount] = await Promise.all([
        ServiceAssignment.find({ serviceId, isActive: true })
            .populate('providerId', 'name email location')
            .sort({ assignedAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        ServiceAssignment.countDocuments({ serviceId, isActive: true })
    ]);
    
    const totalPages = Math.ceil(totalCount / limit);
    
    res.status(200).json(
        new ApiResponse(200, {
            service,
            providers: assignments.map(a => a.providerId),
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: totalCount,
                itemsPerPage: limit
            }
        }, 'Service providers retrieved successfully')
    );
};

