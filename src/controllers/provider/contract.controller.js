import fs from 'fs';
import path from 'path';
import Provider from '../../models/provider/Provider.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { createNotification } from '../../utils/notification.js';

// GET /provider/contract
export const getMyContract = async (req, res) => {
    try {
        const provider = await Provider.findOne({ userId: req.user._id })
            .select('contractFile contractStatus signatureImage agreedToTerms contractSignedAt contractApprovedAt')
            .lean();

        if (!provider) throw new ApiError(404, 'Provider profile not found');
        if (provider.contractStatus === 'not_required') {
            throw new ApiError(403, 'Contract not required for your account');
        }

        res.status(200).json(
            new ApiResponse(200, {
                contractFile: provider.contractFile,
                contractStatus: provider.contractStatus,
                agreedToTerms: provider.agreedToTerms,
                contractSignedAt: provider.contractSignedAt || null,
                contractApprovedAt: provider.contractApprovedAt || null,
            }, 'Contract fetched successfully')
        );
    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
    }
};

// POST /provider/contract/sign
export const submitSignedContract = async (req, res) => {
    try {
        const { signatureImage, agreedToTerms } = req.body;

        if (!signatureImage) throw new ApiError(400, 'Signature is required');
        if (!agreedToTerms) throw new ApiError(400, 'You must agree to the terms and conditions');

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

        // Save signature image as file
        const sigDir = 'public/uploads/signatures';
        if (!fs.existsSync(sigDir)) fs.mkdirSync(sigDir, { recursive: true });

        const base64Data = signatureImage.replace(/^data:image\/\w+;base64,/, '');
        const sigFileName = `sig-${provider._id}-${Date.now()}.png`;
        const sigFilePath = path.join(sigDir, sigFileName);
        fs.writeFileSync(sigFilePath, Buffer.from(base64Data, 'base64'));

        provider.signatureImage = `uploads/signatures/${sigFileName}`;
        provider.contractStatus = 'signed';
        provider.agreedToTerms = true;
        provider.contractSignedAt = new Date();
        await provider.save();

        res.status(200).json(
            new ApiResponse(200, {
                contractStatus: provider.contractStatus,
                contractSignedAt: provider.contractSignedAt
            }, 'Contract signed successfully. Awaiting admin approval.')
        );
    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
    }
};
