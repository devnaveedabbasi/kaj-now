import fs from 'fs';
import path from 'path';
import Provider from '../../models/provider/Provider.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';

// GET /provider/contract
export const getMyContract = async (req, res) => {
    try {
        const provider = await Provider.findOne({ userId: req.user._id })
            .select('contractFile signedContractFile signatureImage contractStatus agreedToTerms contractSignedAt contractApprovedAt contractRejectionReason contractRejectedAt')
            .lean();

        if (!provider) throw new ApiError(404, 'Provider profile not found');
        if (provider.contractStatus === 'not_required') {
            throw new ApiError(403, 'Contract not required for your account');
        }

        res.status(200).json(
            new ApiResponse(200, {
                contractFile: provider.contractFile,
                signedContractFile: provider.signedContractFile || null,
                signatureImage: provider.signatureImage || null,
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

        // Two accepted flows: the provider either uploads a signed PDF copy
        // of the contract (multipart, req.file), or draws their signature
        // in-app (JSON body, base64 PNG data URI) — the app currently in
        // production still uses the latter, so both must keep working.
        const { signatureImage } = req.body;

        if (req.file) {
            provider.signedContractFile = `/contracts/signed/${req.file.filename}`;
        } else if (signatureImage) {
            const sigDir = 'public/uploads/signatures';
            if (!fs.existsSync(sigDir)) fs.mkdirSync(sigDir, { recursive: true });

            const base64Data = signatureImage.replace(/^data:image\/\w+;base64,/, '');
            const sigFileName = `sig-${provider._id}-${Date.now()}.png`;
            const sigFilePath = path.join(sigDir, sigFileName);
            fs.writeFileSync(sigFilePath, Buffer.from(base64Data, 'base64'));

            provider.signatureImage = `/uploads/signatures/${sigFileName}`;
        } else {
            throw new ApiError(400, 'A signature image or a signed contract PDF is required');
        }

        provider.contractStatus = 'signed';
        provider.agreedToTerms = true;
        provider.contractSignedAt = new Date();
        provider.contractRejectionReason = '';
        provider.contractRejectedAt = undefined;
        await provider.save();

        res.status(200).json(
            new ApiResponse(200, {
                signatureImage: provider.signatureImage || null,
                signedContractFile: provider.signedContractFile || null,
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
