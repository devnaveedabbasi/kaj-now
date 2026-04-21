import ServiceRequest from '../../models/admin/serviceRequest.model.js';
import Provider from '../../models/provider/Provider.model.js';
import User from '../../models/User.model.js';
import Service from '../../models/admin/service.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';

export const getAllServiceRequests = async (req, res) => {

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;
    const { status, search, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    let query = {};
    if (status) query.status = status;

    if (search) {
        const [matchingUsers, matchingServices] = await Promise.all([
            User.find({
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } }
                ]
            }).select('_id'),
            Service.find({
                name: { $regex: search, $options: 'i' }
            }).select('_id')
        ]);
        
        const userIds = matchingUsers.map(u => u._id);
        const matchingProviders = await Provider.find({ userId: { $in: userIds } }).select('_id');
        const providerIds = matchingProviders.map(p => p._id);
        const serviceIds = matchingServices.map(s => s._id);

        query.$or = [
            { providerId: { $in: providerIds } },
            { serviceId: { $in: serviceIds } }
        ];
    }
    
    let sortQuery = {};
    sortQuery[sortBy] = sortOrder === 'asc' ? 1 : -1;

    const [requests, totalCount] = await Promise.all([
        ServiceRequest.find(query)
            .populate({
                path: 'providerId',
                select: 'userId',
                populate: {
                    path: 'userId',
                    select: 'name email'
                }
            })
            .populate('serviceId', 'name icon price')
            .populate('categoryId', 'name')
            .populate('reviewedByAdmin', 'name email')
            .sort(sortQuery)
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
        .populate({
            path: 'providerId',
            select: 'userId',
            populate: {
                path: 'userId',
                select: 'name email profilePicture'
            }
        })
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
console.log(`Approving service request with ID: ${id} by admin user ID: ${userId}`);
    const request = await ServiceRequest.findById(id);
    if (!request) {
        throw new ApiError(404, 'Service request not found');
    }

    if (request.status !== 'pending') {
        throw new ApiError(400, `Cannot approve request with status: ${request.status}`);
    }

    // Update request status
    request.status = 'approved';
    request.reviewedAt = new Date();
    request.reviewedByAdmin = userId;
    await request.save();

    // Update provider's arrays
    const provider = await Provider.findById(request.providerId);

if (provider) {
  const serviceIds = request.serviceId.map(id => id.toString());

  const existing = provider.approvedServices.map(id => id.toString());

  provider.approvedServices = [
    ...new Set([...existing, ...serviceIds])
  ];

  await provider.save();
}
    // Populate the updated request
    await request.populate([
        {
            path: 'providerId',
            select: 'userId',
            populate: { path: 'userId', select: 'name email profilePicture' }
        },
        { path: 'serviceId', select: 'name icon price' },
        { path: 'categoryId', select: 'name' },
        { path: 'reviewedByAdmin', select: 'name email profilePicture' }
    ]);

    res.status(200).json(
        new ApiResponse(200, request, 'Service request approved successfully')
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

    // Populate the updated request
    await request.populate([
        {
            path: 'providerId',
            select: 'userId',
            populate: { path: 'userId', select: 'name email profilePicture' }
        },
        { path: 'serviceId', select: 'name icon price' },
        { path: 'categoryId', select: 'name' },
        { path: 'reviewedByAdmin', select: 'name email profilePicture' }
    ]);

    res.status(200).json(
        new ApiResponse(200, request, 'Service request rejected successfully')
    );
};

// Get all approved/active service assignments (from approved requests)
export const getAllServiceAssignments = async (req, res) => {
    console.log('Fetching all service assignments with query params:', req.query);

    const [assignments, totalCount] = await Promise.all([
        ServiceRequest.find({ status: 'approved' })
            .populate({
                path: 'providerId',
                select: 'userId',
                populate: {
                    path: 'userId',
                    select: 'name email'
                }
            })
            .populate('serviceId', 'name icon price')
            .populate('categoryId', 'name')
            .populate('reviewedByAdmin', 'name email')
            .sort({ reviewedAt: -1 })
            .lean(),
        ServiceRequest.countDocuments({ status: 'approved' })
    ]);


    res.status(200).json(
        new ApiResponse(200, {
            assignments,

        }, 'Service assignments retrieved successfully')
    );
};



