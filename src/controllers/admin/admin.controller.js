import User from "../../models/User.model.js";
import Provider from "../../models/provider/Provider.model.js";
import Service from "../../models/admin/service.model.js";
import Category from "../../models/admin/category.model.js";
import ServiceRequest from "../../models/admin/serviceRequest.model.js";
import Review from "../../models/reviews.model.js";
import Notification from "../../models/notification.model.js";
import { ApiError } from "../../utils/errorHandler.js";
import { ApiResponse } from "../../utils/apiResponse.js";
import { createNotification } from "../../utils/createNotification.js";
import mongoose from "mongoose";

// ==================== USER MANAGEMENT ====================

// Get all users
export const getAllUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const { role, isActive, search } = req.query;
        
        let query = {};
        if (role) query.role = role;
        if (isActive !== undefined) query.isActive = isActive === 'true';
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }
        
        const [users, totalCount] = await Promise.all([
            User.find(query).select('-password').sort({ createdAt: -1 }).skip(skip).limit(limit),
            User.countDocuments(query)
        ]);
        
        const totalPages = Math.ceil(totalCount / limit);
        
        res.status(200).json(
            new ApiResponse(200, {
                users,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: totalCount,
                    itemsPerPage: limit
                }
            }, 'Users retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting users:', error);
        res.status(500).json(new ApiResponse(500, null, error.message));
    }
};

// Get user by ID
export const getUserById = async (req, res) => {
    try {
        const { userId } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            throw new ApiError(400, 'Invalid user ID format');
        }
        
        const user = await User.findById(userId).select('-password');
        
        if (!user) {
            throw new ApiError(404, 'User not found');
        }
        
        // If user is provider, get provider details
        let providerDetails = null;
        if (user.role === 'provider') {
            providerDetails = await Provider.findOne({ userId: user._id })
                .populate('Category', 'name icon')
                .populate('services');
        }
        
        res.status(200).json(
            new ApiResponse(200, {
                user,
                providerDetails
            }, 'User retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting user:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, error.message));
        }
    }
};

// Update user status (activate/deactivate)
export const updateUserStatus = async (req, res) => {
    try {
        const { userId } = req.params;
        const { isActive } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            throw new ApiError(400, 'Invalid user ID format');
        }
        
        const user = await User.findById(userId);
        
        if (!user) {
            throw new ApiError(404, 'User not found');
        }
        
        // Check if already in same status
        if (user.isActive === isActive) {
            throw new ApiError(400, `User is already ${isActive ? 'activated' : 'deactivated'}`);
        }
        
        user.isActive = isActive;
        await user.save();
        
        // Send notification to user
        await createNotification({
            userId: user._id,
            title: isActive ? 'Account Activated' : 'Account Deactivated',
            message: isActive ? 'Your account has been activated' : 'Your account has been deactivated. Contact support for details.',
            type: 'system'
        });
        
        res.status(200).json(
            new ApiResponse(200, user, `User ${isActive ? 'activated' : 'deactivated'} successfully`)
        );
    } catch (error) {
        console.error('Error updating user status:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, error.message));
        }
    }
};

// Delete user
export const deleteUser = async (req, res) => {
    try {
        const { userId } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            throw new ApiError(400, 'Invalid user ID format');
        }
        
        const user = await User.findByIdAndDelete(userId);
        
        if (!user) {
            throw new ApiError(404, 'User not found');
        }
        
        // Also delete provider record if exists
        if (user.role === 'provider') {
            await Provider.findOneAndDelete({ userId: user._id });
        }
        
        res.status(200).json(
            new ApiResponse(200, null, 'User deleted successfully')
        );
    } catch (error) {
        console.error('Error deleting user:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, error.message));
        }
    }
};


// Get all providers with KYC status
export const getAllProviders = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const { kycStatus, search } = req.query;
        
        let query = {};
        if (kycStatus) query.kycStatus = kycStatus;
        
        const providers = await Provider.find(query)
            .populate('userId', '-password')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .lean();
        
        // Filter by search if provided
        let filteredProviders = providers;
        if (search) {
            filteredProviders = providers.filter(provider => 
                provider.userId?.name?.toLowerCase().includes(search.toLowerCase()) ||
                provider.userId?.email?.toLowerCase().includes(search.toLowerCase())
            );
        }
        
        const totalCount = await Provider.countDocuments(query);
        const totalPages = Math.ceil(totalCount / limit);
        
        const formattedProviders = filteredProviders.map(provider => ({
            _id: provider._id,
            kycStatus: provider.kycStatus,
            isKycCompleted: provider.isKycCompleted,
            user: {
                _id: provider.userId?._id,
                name: provider.userId?.name,
                email: provider.userId?.email,
                phone: provider.userId?.phoneNumber,
                profileImage: provider.userId?.profileImage,
                isActive: provider.userId?.isActive
            },
            category: provider.Category,
            documents: {
                facePhoto: provider.facePhoto,
                idCardFront: provider.idCardFront,
                idCardBack: provider.idCardBack,
                certificates: provider.certificates
            },
            createdAt: provider.createdAt
        }));
        
        res.status(200).json(
            new ApiResponse(200, {
                providers: formattedProviders,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: totalCount,
                    itemsPerPage: limit
                }
            }, 'Providers retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting providers:', error);
        res.status(500).json(new ApiResponse(500, null, error.message));
    }
};

// Get provider by ID with full details
export const getProviderById = async (req, res) => {
    try {
        const { providerId } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(providerId)) {
            throw new ApiError(400, 'Invalid provider ID format');
        }
        
        const provider = await Provider.findById(providerId)
            .populate('userId', '-password')
            .populate('Category', 'name icon description')
            .populate({
                path: 'services',
                populate: {
                    path: 'serviceId',
                    select: 'name icon price description averageRating'
                }
            })
            .lean();
        
        if (!provider) {
            throw new ApiError(404, 'Provider not found');
        }
        
        // Get service request statistics
        const serviceStats = await ServiceRequest.aggregate([
            { $match: { providerId: provider._id } },
            { $group: {
                _id: '$status',
                count: { $sum: 1 }
            }}
        ]);
        
        const stats = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
        serviceStats.forEach(stat => {
            if (stats[stat._id] !== undefined) stats[stat._id] = stat.count;
        });
        
        res.status(200).json(
            new ApiResponse(200, {
                ...provider,
                serviceStats: stats
            }, 'Provider details retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting provider:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, error.message));
        }
    }
};

// Approve provider KYC
export const approveProviderKyc = async (req, res) => {
    try {
        const { providerId } = req.params;
        
        if (!mongoose.Types.ObjectId.isValid(providerId)) {
            throw new ApiError(400, 'Invalid provider ID format');
        }
        
        const provider = await Provider.findById(providerId).populate('userId');
        
        if (!provider) {
            throw new ApiError(404, 'Provider not found');
        }
        
        // Check if already approved
        if (provider.kycStatus === 'approved') {
            throw new ApiError(400, 'KYC is already approved');
        }
        
        // Check if documents are uploaded
        if (!provider.facePhoto || !provider.idCardFront || !provider.idCardBack) {
            throw new ApiError(400, 'Cannot approve KYC. Required documents are missing');
        }
        
        provider.kycStatus = 'approved';
        provider.isKycCompleted = true;
        await provider.save();
        
        // Send notification
        await createNotification({
            userId: provider.userId._id,
            title: 'KYC Approved',
            message: 'Your KYC has been approved! You can now offer services.',
            type: 'kyc',
            referenceId: provider._id
        });
        
        res.status(200).json(
            new ApiResponse(200, {
                providerId: provider._id,
                kycStatus: provider.kycStatus,
                isKycCompleted: provider.isKycCompleted
            }, 'Provider KYC approved successfully')
        );
    } catch (error) {
        console.error('Error approving KYC:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, error.message));
        }
    }
};

// Suspend provider KYC
export const suspendProviderKyc = async (req, res) => {
    try {
        const { providerId } = req.params;
        const { reason } = req.body;
        
        if (!mongoose.Types.ObjectId.isValid(providerId)) {
            throw new ApiError(400, 'Invalid provider ID format');
        }
        
        const provider = await Provider.findById(providerId).populate('userId');
        
        if (!provider) {
            throw new ApiError(404, 'Provider not found');
        }
        
        // Check if already suspended
        if (provider.kycStatus === 'suspended') {
            throw new ApiError(400, 'KYC is already suspended');
        }
        
        provider.kycStatus = 'suspended';
        provider.isKycCompleted = false;
        await provider.save();
        
        // Also deactivate user
        await User.findByIdAndUpdate(provider.userId._id, { isActive: false });
        
        // Send notification
        await createNotification({
            userId: provider.userId._id,
            title: 'KYC Suspended',
            message: reason || 'Your KYC has been suspended. Contact support for details.',
            type: 'kyc',
            referenceId: provider._id,
            metadata: { reason }
        });
        
        res.status(200).json(
            new ApiResponse(200, {
                providerId: provider._id,
                kycStatus: provider.kycStatus,
                reason: reason || 'No reason provided'
            }, 'Provider KYC suspended successfully')
        );
    } catch (error) {
        console.error('Error suspending KYC:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, error.message));
        }
    }
};

// Reject provider KYC
export const rejectProviderKyc = async (req, res) => {
    try {
        const { providerId } = req.params;
        const { reason } = req.body;
        
        if (!reason) {
            throw new ApiError(400, 'Rejection reason is required');
        }
        
        if (!mongoose.Types.ObjectId.isValid(providerId)) {
            throw new ApiError(400, 'Invalid provider ID format');
        }
        
        const provider = await Provider.findById(providerId).populate('userId');
        
        if (!provider) {
            throw new ApiError(404, 'Provider not found');
        }
        
        // Check if already pending or rejected
        if (provider.kycStatus === 'pending') {
            throw new ApiError(400, 'KYC is already pending');
        }
        
        provider.kycStatus = 'pending';
        provider.isKycCompleted = false;
        await provider.save();
        
        // Send notification
        await createNotification({
            userId: provider.userId._id,
            title: 'KYC Rejected',
            message: `Your KYC was rejected. Reason: ${reason}. Please resubmit your documents.`,
            type: 'kyc',
            referenceId: provider._id,
            metadata: { reason }
        });
        
        res.status(200).json(
            new ApiResponse(200, {
                providerId: provider._id,
                kycStatus: provider.kycStatus,
                reason
            }, 'Provider KYC rejected successfully')
        );
    } catch (error) {
        console.error('Error rejecting KYC:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, error.message));
        }
    }
};

// Get admin dashboard stats
export const getAdminDashboardStats = async (req, res) => {
    try {
        const [
            totalUsers,
            totalProviders,
            totalServices,
            totalCategories,
            totalServiceRequests,
            pendingRequests,
            approvedRequests,
            totalReviews,
            pendingKyc,
            approvedKyc
        ] = await Promise.all([
            User.countDocuments(),
            User.countDocuments({ role: 'provider' }),
            Service.countDocuments({ isDeleted: false }),
            Category.countDocuments({ isDeleted: false }),
            ServiceRequest.countDocuments(),
            ServiceRequest.countDocuments({ status: 'pending' }),
            ServiceRequest.countDocuments({ status: 'approved' }),
            Review.countDocuments(),
            Provider.countDocuments({ kycStatus: 'pending' }),
            Provider.countDocuments({ kycStatus: 'approved' })
        ]);
        
        // Recent activities
        const recentUsers = await User.find().select('-password').sort({ createdAt: -1 }).limit(5);
        const recentRequests = await ServiceRequest.find()
            .populate('serviceId', 'name')
            .populate('providerId')
            .sort({ createdAt: -1 })
            .limit(5);
        
        res.status(200).json(
            new ApiResponse(200, {
                stats: {
                    totalUsers,
                    totalProviders,
                    totalServices,
                    totalCategories,
                    totalServiceRequests,
                    pendingRequests,
                    approvedRequests,
                    totalReviews,
                    kycStats: {
                        pending: pendingKyc,
                        approved: approvedKyc
                    }
                },
                recentActivities: {
                    recentUsers,
                    recentRequests
                }
            }, 'Dashboard stats retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting dashboard stats:', error);
        res.status(500).json(new ApiResponse(500, null, error.message));
    }
};