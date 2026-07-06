import Provider from '../../models/provider/Provider.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';

// GET /provider/contract
export const getMyContract = async (req, res) => {
    try {
        const provider = await Provider.findOne({ userId: req.user._id })
            .select('contractFile signedContractFile contractStatus agreedToTerms contractSignedAt contractApprovedAt contractRejectionReason contractRejectedAt')
            .lean();

        if (!provider) throw new ApiError(404, 'Provider profile not found');
        if (provider.contractStatus === 'not_required') {
            throw new ApiError(403, 'Contract not required for your account');
        }

        res.status(200).json(
            new ApiResponse(200, {
                contractFile: provider.contractFile,
                signedContractFile: provider.signedContractFile || null,
                contractStatus: provider.contractStatus,
                agreedToTerms: provider.agreedToTerms,
                contractSignedAt: provider.contractSignedAt || null,
                contractApprovedAt: provider.contractApprovedAt || null,
                contractRejectionReason: provider.contractRejectionReason || null,
                contractRejectedAt: provider.contractRejectedAt || null,
            }, 'Contract fetched successfully')
        );
    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
    }
};

// POST /provider/contract/sign — provider uploads their signed copy of the contract PDF
export const submitSignedContract = async (req, res) => {
    try {
        if (!req.file) throw new ApiError(400, 'Signed contract PDF is required');

        const provider = await Provider.findOne({ userId: req.user._id });
        if (!provider) throw new ApiError(404, 'Provider profile not found');

        if (provider.contractStatus === 'not_required') {
            throw new ApiError(403, 'Contract not required for your account');
        }
        if (provider.contractStatus === 'approved') {
            throw new ApiError(400, 'Contract is already approved');
        }
        if (provider.contractStatus === 'signed') {
            throw new ApiError(400, 'Contract already submitted. Awaiting admin approval.');
        }
        if (provider.contractStatus === 'rejected') {
            throw new ApiError(400, 'Your contract was rejected. Please complete your KYC verification again to receive a new contract.');
        }

        provider.signedContractFile = `contracts/signed/${req.file.filename}`;
        provider.contractStatus = 'signed';
        provider.agreedToTerms = true;
        provider.contractSignedAt = new Date();
        provider.contractRejectionReason = '';
        provider.contractRejectedAt = undefined;
        await provider.save();

        res.status(200).json(
            new ApiResponse(200, {
                signedContractFile: provider.signedContractFile,
                contractStatus: provider.contractStatus,
                contractSignedAt: provider.contractSignedAt
            }, 'Signed contract submitted successfully. Awaiting admin approval.')
        );
    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
    }
};
