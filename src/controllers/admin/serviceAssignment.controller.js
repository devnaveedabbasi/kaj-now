import ServiceRequest from '../../models/admin/serviceRequest.model.js';
import ServiceAssignment from '../../models/admin/serviceAssignment.model.js';
import Service from '../../models/admin/service.model.js';
import Category from '../../models/admin/category.model.js';
import Provider from '../../models/provider/Provider.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const getAllServiceRequests = async (req, res) => {
    const userId = req.user._id;
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const { status, providerId, serviceId, categoryId } = req.query;
    
    let query = {};
    
    if (status) query.status = status;
    if (providerId) query.providerId = providerId;
    if (serviceId) query.serviceId = serviceId;
    if (categoryId) query.categoryId = categoryId;
    
    const [requests, totalCount] = await Promise.all([
        ServiceRequest.find(query)
            .populate('providerId', 'name email')
            .populate('serviceId', 'name icon price')
            .populate('categoryId', 'name')
            .populate('reviewedByAdmin', 'name email')
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
                itemsPerPage: limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        }, 'Service requests retrieved successfully')
    );
};

// Get service request by ID
export const getServiceRequestById = async (req, res) => {
    const { id } = req.params;
    
    const request = await ServiceRequest.findById(id)
        .populate('providerId', 'name email')
        .populate('serviceId', 'name icon price description')
        .populate('categoryId', 'name icon')
        .populate('reviewedByAdmin', 'name email');
    
    if (!request) {
        throw new ApiError(404, 'Service request not found');
    }
    
    res.status(200).json(
        new ApiResponse(200, request, 'Service request retrieved successfully')
    );
};

// Approve service request
export const approveServiceRequest = async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;
    const { notes } = req.body;
    
    const request = await ServiceRequest.findById(id);
    if (!request) {
        throw new ApiError(404, 'Service request not found');
    }
    
    if (request.status !== 'pending') {
        throw new ApiError(400, `Cannot approve request with status: ${request.status}`);
    }
    
    // Check if assignment already exists
    const existingAssignment = await ServiceAssignment.findOne({
        providerId: request.providerId,
        serviceId: request.serviceId
    });
    
    if (existingAssignment) {
        throw new ApiError(409, 'Service is already assigned to this provider');
    }
    
    // Create assignment
    const assignment = await ServiceAssignment.create({
        providerId: request.providerId,
        serviceId: request.serviceId,
        categoryId: request.categoryId,
        assignedByAdmin: userId
    });
    
    // Update request status
    request.status = 'approved';
    request.reviewedAt = new Date();
    request.reviewedByAdmin = userId;
    request.notes = notes || request.notes;
    await request.save();
    
    // Update provider's services array if not already there
    const provider = await Provider.findById(request.providerId);
    if (provider && !provider.services.includes(request.serviceId)) {
        provider.services.push(request.serviceId);
        await provider.save();
    }
    
    res.status(200).json(
        new ApiResponse(200, { request, assignment }, 'Service request approved successfully')
    );
};

// Reject service request
export const rejectServiceRequest = async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id;
    const { rejectionReason } = req.body;
    
    if (!rejectionReason) {
        throw new ApiError(400, 'Rejection reason is required');
    }
    
    const request = await ServiceRequest.findById(id);
    if (!request) {
        throw new ApiError(404, 'Service request not found');
    }
    
    if (request.status !== 'pending') {
        throw new ApiError(400, `Cannot reject request with status: ${request.status}`);
    }
    
    request.status = 'rejected';
    request.reviewedAt = new Date();
    request.reviewedByAdmin = userId;
    request.rejectionReason = rejectionReason;
    await request.save();
    
    res.status(200).json(
        new ApiResponse(200, request, 'Service request rejected successfully')
    );
};

// ===================== SERVICE ASSIGNMENTS =====================

// Get all service assignments
export const getAllServiceAssignments = async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    const { providerId, serviceId, categoryId, isActive } = req.query;
    
    let query = {};
    
    if (providerId) query.providerId = providerId;
    if (serviceId) query.serviceId = serviceId;
    if (categoryId) query.categoryId = categoryId;
    if (isActive !== undefined && isActive !== '') {
        query.isActive = isActive === 'true';
    }
    
    const [assignments, totalCount] = await Promise.all([
        ServiceAssignment.find(query)
            .populate('providerId', 'name email')
            .populate('serviceId', 'name icon price')
            .populate('categoryId', 'name')
            .populate('assignedByAdmin', 'name email')
            .sort({ assignedAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        ServiceAssignment.countDocuments(query)
    ]);
    
    const totalPages = Math.ceil(totalCount / limit);
    
    res.status(200).json(
        new ApiResponse(200, {
            assignments,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: totalCount,
                itemsPerPage: limit,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        }, 'Service assignments retrieved successfully')
    );
};

// Deactivate service assignment
export const deactivateServiceAssignment = async (req, res) => {
    const { id } = req.params;
    const { deactivationReason } = req.body;
    
    const assignment = await ServiceAssignment.findById(id);
    if (!assignment) {
        throw new ApiError(404, 'Service assignment not found');
    }
    
    if (!assignment.isActive) {
        throw new ApiError(400, 'Service assignment is already deactivated');
    }
    
    assignment.isActive = false;
    assignment.deactivatedAt = new Date();
    assignment.deactivationReason = deactivationReason || '';
    await assignment.save();
    
    // Optionally remove from provider's services array
    await Provider.findByIdAndUpdate(
        assignment.providerId,
        { $pull: { services: assignment.serviceId } }
    );
    
    res.status(200).json(
        new ApiResponse(200, assignment, 'Service assignment deactivated successfully')
    );
};

// Get assignments by category
export const getAssignmentsByCategory = async (req, res) => {
    const { categoryId } = req.params;
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    // Verify category exists
    const category = await Category.findById(categoryId);
    if (!category) {
        throw new ApiError(404, 'Category not found');
    }
    
    const [assignments, totalCount] = await Promise.all([
        ServiceAssignment.find({ categoryId, isActive: true })
            .populate('providerId', 'name email')
            .populate('serviceId', 'name icon price')
            .populate('assignedByAdmin', 'name')
            .sort({ assignedAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        ServiceAssignment.countDocuments({ categoryId, isActive: true })
    ]);
    
    const totalPages = Math.ceil(totalCount / limit);
    
    res.status(200).json(
        new ApiResponse(200, {
            category,
            assignments,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: totalCount,
                itemsPerPage: limit
            }
        }, 'Category assignments retrieved successfully')
    );
};

// Get assignments by provider
export const getAssignmentsByProvider = async (req, res) => {
    const { providerId } = req.params;
    
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    
    // Verify provider exists
    const provider = await Provider.findById(providerId);
    if (!provider) {
        throw new ApiError(404, 'Provider not found');
    }
    
    const [assignments, totalCount] = await Promise.all([
        ServiceAssignment.find({ providerId, isActive: true })
            .populate('serviceId', 'name icon price description')
            .populate('categoryId', 'name icon')
            .populate('assignedByAdmin', 'name')
            .sort({ assignedAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean(),
        ServiceAssignment.countDocuments({ providerId, isActive: true })
    ]);
    
    const totalPages = Math.ceil(totalCount / limit);
    
    res.status(200).json(
        new ApiResponse(200, {
            provider: { _id: provider._id, name: provider.userId },
            assignments,
            pagination: {
                currentPage: page,
                totalPages,
                totalItems: totalCount,
                itemsPerPage: limit
            }
        }, 'Provider assignments retrieved successfully')
    );
};
