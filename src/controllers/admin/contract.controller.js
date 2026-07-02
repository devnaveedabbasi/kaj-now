import mongoose from 'mongoose';
import Provider from '../../models/provider/Provider.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { createNotification } from '../../utils/notification.js';
import { sendContractApprovedEmail } from '../../service/emailService.js';

// POST /admin/contracts/upload-template
export const uploadContractTemplate = async (req, res) => {
    try {
        if (!req.file) throw new ApiError(400, 'PDF file is required');

        const baseUrl = `${req.protocol}://${req.get('host')}`;
        const contractUrl = `${baseUrl}/contracts/kajnow_provider_agreement.pdf`;

        res.status(200).json(
            new ApiResponse(200, { contractUrl }, 'Contract template uploaded successfully')
        );
    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
    }
};

// GET /admin/contracts  — list all signed contracts awaiting approval
export const getSignedContracts = async (req, res) => {
    try {
        const { status = 'signed' } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const query = { contractStatus: status };

        const [providers, total] = await Promise.all([
            Provider.find(query)
                .populate('userId', 'name email phone profilePicture region')
                .select('contractFile contractStatus signatureImage agreedToTerms contractSignedAt contractApprovedAt providerType')
                .sort({ contractSignedAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Provider.countDocuments(query)
        ]);

        res.status(200).json(
            new ApiResponse(200, {
                providers,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(total / limit),
                    totalItems: total,
                    hasNextPage: page < Math.ceil(total / limit)
                }
            }, 'Signed contracts fetched successfully')
        );
    } catch (error) {
        res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
    }
};

// GET /admin/contracts/:providerId  — single contract detail
export const getContractDetail = async (req, res) => {
    try {
        const { providerId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(providerId)) {
            throw new ApiError(400, 'Invalid provider ID');
        }

        const provider = await Provider.findById(providerId)
            .populate('userId', 'name email phone profilePicture region')
            .select('contractFile contractStatus signatureImage agreedToTerms contractSignedAt contractApprovedAt providerType')
            .lean();

        if (!provider) throw new ApiError(404, 'Provider not found');

        res.status(200).json(new ApiResponse(200, provider, 'Contract detail fetched'));
    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
    }
};

// POST /admin/contracts/:providerId/approve
export const approveContract = async (req, res) => {
    try {
        const { providerId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(providerId)) {
            throw new ApiError(400, 'Invalid provider ID');
        }

        const provider = await Provider.findById(providerId).populate('userId', 'name email');
        if (!provider) throw new ApiError(404, 'Provider not found');

        if (provider.contractStatus !== 'signed') {
            throw new ApiError(400, `Cannot approve. Current status: ${provider.contractStatus}`);
        }

        provider.contractStatus = 'approved';
        provider.contractApprovedAt = new Date();
        await provider.save();

        // Push notification + DB
        await createNotification({
            userId: provider.userId._id,
            title: 'Contract Approved!',
            message: 'Your provider contract has been approved. You can now start accepting jobs!',
            type: 'kyc',
            referenceId: provider._id
        });

        // Email
        await sendContractApprovedEmail(provider.userId.email, { userName: provider.userId.name });

        res.status(200).json(
            new ApiResponse(200, {
                providerId: provider._id,
                contractStatus: provider.contractStatus,
                contractApprovedAt: provider.contractApprovedAt
            }, 'Contract approved successfully')
        );
    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
    }
};
