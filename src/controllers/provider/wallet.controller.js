import mongoose from 'mongoose';
import Wallet from '../../models/wallet.model.js';
import Provider from '../../models/provider/Provider.model.js';
import User from '../../models/User.model.js';
import Withdrawal from '../../models/withdrawal.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { createNotification } from '../../utils/notification.js';

export const getProviderWallet = async (req, res) => {
    try {
        const userId = req.user._id;

        const provider = await Provider.findOne({ userId });
        if (!provider) {
            throw new ApiError(404, 'Provider profile not found');
        }

        let wallet = await Wallet.findOne({ userId: provider._id, role: 'provider' });
        
        // Create wallet if not exists
        if (!wallet) {
            wallet = await Wallet.create({
                userId: provider._id,
                role: 'provider',
                balance: 0,
                totalEarnings: 0,
                totalWithdrawn: 0,
                totalPlatformFees: 0,
                isActive: true
            });
        }

        // Get pending withdrawal amount
        const pendingWithdrawals = await Withdrawal.aggregate([
            { $match: { providerId: provider._id, status: 'pending' } },
            { $group: { _id: null, total: { $sum: '$requestedAmount' } } }
        ]);

        const pendingAmount = pendingWithdrawals[0]?.total || 0;

        return res.status(200).json(
            new ApiResponse(200, {
                wallet: {
                    balance: wallet.balance,
                    totalEarnings: wallet.totalEarnings,
                    totalWithdrawn: wallet.totalWithdrawn,
                    totalPlatformFees: wallet.totalPlatformFees,
                    availableForWithdrawal: wallet.balance - pendingAmount,
                    pendingWithdrawal: pendingAmount,
                    isActive: wallet.isActive
                },
                
            }, 'Wallet details retrieved successfully')
        );
    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        return res.status(500).json(new ApiResponse(500, null, error.message));
    }
};

// Get wallet transaction history
export const getWalletTransactions = async (req, res) => {
    try {
        const userId = req.user._id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const provider = await Provider.findOne({ userId });
        if (!provider) {
            throw new ApiError(404, 'Provider profile not found');
        }

        const wallet = await Wallet.findOne({ userId: provider._id, role: 'provider' })
            .populate({
                path: 'transactionHistory',
                populate: {
                    path: 'jobId',
                    select: 'orderId service amount'
                }
            })
            .lean();

        if (!wallet) {
            throw new ApiError(404, 'Wallet not found');
        }

        const transactions = wallet.transactionHistory || [];
        const totalCount = transactions.length;
        const paginatedTransactions = transactions.slice(skip, skip + limit);
        const totalPages = Math.ceil(totalCount / limit);

        return res.status(200).json(
            new ApiResponse(200, {
                transactions: paginatedTransactions,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: totalCount,
                    itemsPerPage: limit
                }
            }, 'Transaction history retrieved successfully')
        );
    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        return res.status(500).json(new ApiResponse(500, null, error.message));
    }
};





// Add or update bank details
export const updateBankDetails = async (req, res) => {
    try {
        const userId = req.user._id;
        const { accountHolderName, bankName, accountNumber, branchCode } = req.body;

        // Validation
        if (!accountHolderName || !bankName || !accountNumber) {
            throw new ApiError(400, 'Account holder name, bank name, and account number are required');
        }

        const provider = await Provider.findOne({ userId });
        if (!provider) {
            throw new ApiError(404, 'Provider profile not found');
        }

        // Update bank details
        provider.bankDetails = {
            accountHolderName,
            bankName,
            accountNumber,
            branchCode: branchCode || ''
        };
        await provider.save();

        return res.status(200).json(
            new ApiResponse(200, provider.bankDetails, 'Bank details updated successfully')
        );
    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        return res.status(500).json(new ApiResponse(500, null, error.message));
    }
};

// Get bank details
export const getBankDetails = async (req, res) => {
    try {
        const userId = req.user._id;

        const provider = await Provider.findOne({ userId });
        if (!provider) {
            throw new ApiError(404, 'Provider profile not found');
        }

        return res.status(200).json(
            new ApiResponse(200, provider.bankDetails || {}, 'Bank details retrieved successfully')
        );
    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        return res.status(500).json(new ApiResponse(500, null, error.message));
    }
};