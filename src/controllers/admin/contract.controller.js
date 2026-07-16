import mongoose from 'mongoose';
import fs from 'fs';
import Provider from '../../models/provider/Provider.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { createNotification } from '../../utils/notification.js';
import { sendContractApprovedEmail, sendContractRejectedEmail } from '../../service/emailService.js';
import { getContractPath, generateContractPdfIfMissing } from '../../utils/generateContract.js';

const CONTRACT_SELECT_FIELDS = 'contractFile signedContractFile contractStatus signatureImage agreedToTerms contractSignedAt contractApprovedAt contractRejectionReason contractRejectedAt providerType';

// POST /admin/contracts/upload-template — admin uploads/replaces the single global UK contract PDF
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

// GET /admin/contracts/template — current global template status
export const getContractTemplateStatus = async (req, res) => {
    try {
        const contractPath = getContractPath();
        const exists = fs.existsSync(contractPath);
        const baseUrl = `${req.protocol}://${req.get('host')}`;

        res.status(200).json(
            new ApiResponse(200, {
                exists,
                contractUrl: exists ? `${baseUrl}/contracts/kajnow_provider_agreement.pdf` : null,
                updatedAt: exists ? fs.statSync(contractPath).mtime : null
            }, 'Contract template status fetched')
        );
    } catch (error) {
        res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
    }
};

// DELETE /admin/contracts/template — admin removes the global template.
// A default boilerplate agreement is regenerated so the KYC-approval flow always has a file to send.
export const deleteContractTemplate = async (req, res) => {
    try {
        const contractPath = getContractPath();

        if (!fs.existsSync(contractPath)) {
            throw new ApiError(404, 'No contract template found to delete');
        }

        fs.unlinkSync(contractPath);
        generateContractPdfIfMissing();

        res.status(200).json(
            new ApiResponse(200, null, 'Contract template deleted. A default agreement has been restored.')
        );
    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
    }
};

// GET /admin/contracts  — list providers' signed contracts by review status
export const getSignedContracts = async (req, res) => {
    try {
        const { status = 'all' } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // "all" = every provider who has actually submitted something to
        // review (signed / approved / rejected) — excludes not_required and
        // pending, which never have a signature/PDF to show.
        const query = status === 'all'
            ? { contractStatus: { $in: ['signed', 'approved', 'rejected'] } }
            : { contractStatus: status };

        const [providers, total] = await Promise.all([
            Provider.find(query)
                .populate('userId', 'name email phone profilePicture region')
                .select(CONTRACT_SELECT_FIELDS)
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
            .select(CONTRACT_SELECT_FIELDS)
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
        provider.contractRejectionReason = '';
        provider.contractRejectedAt = undefined;
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

// POST /admin/contracts/:providerId/reject
export const rejectContract = async (req, res) => {
    try {
        const { providerId } = req.params;
        const { reason } = req.body;

        if (!mongoose.Types.ObjectId.isValid(providerId)) {
            throw new ApiError(400, 'Invalid provider ID');
        }
        if (!reason || !reason.trim()) {
            throw new ApiError(400, 'Rejection reason is required');
        }

        const provider = await Provider.findById(providerId).populate('userId', 'name email');
        if (!provider) throw new ApiError(404, 'Provider not found');

        if (provider.contractStatus !== 'signed') {
            throw new ApiError(400, `Cannot reject. Current status: ${provider.contractStatus}`);
        }

        provider.contractStatus = 'rejected';
        provider.contractRejectionReason = reason.trim();
        provider.contractRejectedAt = new Date();

        // Force the provider back through KYC — a new signed contract can only follow a fresh KYC approval
        provider.isKycCompleted = false;
        provider.kycStatus = 'pending';

        await provider.save();

        await createNotification({
            userId: provider.userId._id,
            title: 'Contract Rejected',
            message: `Your signed contract was rejected. Reason: ${provider.contractRejectionReason}. Please complete your KYC verification again to receive a new contract.`,
            type: 'kyc',
            referenceId: provider._id,
            metadata: { reason: provider.contractRejectionReason }
        });

        await sendContractRejectedEmail(provider.userId.email, {
            userName: provider.userId.name,
            reason: provider.contractRejectionReason
        });

        res.status(200).json(
            new ApiResponse(200, {
                providerId: provider._id,
                contractStatus: provider.contractStatus,
                contractRejectionReason: provider.contractRejectionReason,
                contractRejectedAt: provider.contractRejectedAt,
                isKycCompleted: provider.isKycCompleted,
                kycStatus: provider.kycStatus
            }, 'Contract rejected successfully')
        );
    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
    }
};
