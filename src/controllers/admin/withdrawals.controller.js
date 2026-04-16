import mongoose from 'mongoose';
import Wallet from '../../models/wallet.model.js';
import Provider from '../../models/provider/Provider.model.js';
import User from '../../models/User.model.js';
import Withdrawal from '../../models/withdrawal.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { createNotification } from '../../utils/createNotification.js';

// Get all withdrawals (Admin)
export const getAllWithdrawals = async (req, res) => {
    try {
        const { status, page = 1, limit = 10 } = req.query;

        let query = {};
        if (status && status !== 'all') {
            query.status = status;
        }

        const skip = (page - 1) * limit;
        const [withdrawals, total] = await Promise.all([
            Withdrawal.find(query)
                .populate('providerId', 'name email phone bankDetails')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit)),
            Withdrawal.countDocuments(query)
        ]);

        // Get statistics
        const stats = await Withdrawal.aggregate([
            { $group: {
                _id: '$status',
                totalAmount: { $sum: '$requestedAmount' },
                totalPayable: { $sum: '$payableAmount' },
                count: { $sum: 1 }
            }}
        ]);

        const withdrawalStats = {
            totalPending: 0,
            totalCompleted: 0,
            totalRejected: 0,
            totalPendingAmount: 0,
            totalCompletedAmount: 0,
            totalPlatformFees: 0
        };

        stats.forEach(stat => {
            if (stat._id === 'pending') {
                withdrawalStats.totalPending = stat.count;
                withdrawalStats.totalPendingAmount = stat.totalAmount;
            }
            if (stat._id === 'completed') {
                withdrawalStats.totalCompleted = stat.count;
                withdrawalStats.totalCompletedAmount = stat.totalAmount;
                withdrawalStats.totalPlatformFees = stat.totalAmount - stat.totalPayable;
            }
            if (stat._id === 'rejected') {
                withdrawalStats.totalRejected = stat.count;
            }
        });

        const totalPages = Math.ceil(total / limit);

        return res.status(200).json(
            new ApiResponse(200, {
                withdrawals,
                stats: withdrawalStats,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages,
                    totalItems: total,
                    itemsPerPage: parseInt(limit)
                }
            }, 'Withdrawals retrieved successfully')
        );
    } catch (error) {
        return res.status(500).json(new ApiResponse(500, null, error.message));
    }
};

// Approve withdrawal (Admin)
export const approveWithdrawal = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { withdrawalId } = req.params;
        const { transactionId, notes } = req.body;

        if (!mongoose.Types.ObjectId.isValid(withdrawalId)) {
            throw new ApiError(400, 'Invalid withdrawal ID');
        }

        const withdrawal = await Withdrawal.findById(withdrawalId).session(session);
        if (!withdrawal) {
            throw new ApiError(404, 'Withdrawal not found');
        }

        if (withdrawal.status !== 'pending') {
            throw new ApiError(400, `Withdrawal already ${withdrawal.status}`);
        }

        // Update withdrawal status
        withdrawal.status = 'completed';
        withdrawal.processedAt = new Date();
        withdrawal.transactionId = transactionId || null;
        withdrawal.adminNotes = notes || null;
        await withdrawal.save({ session });

        // Update provider wallet totals
        const providerWallet = await Wallet.findOne({ userId: withdrawal.providerId, role: 'provider' }).session(session);
        if (providerWallet) {
            providerWallet.totalWithdrawn += withdrawal.requestedAmount;
            providerWallet.totalPlatformFees += withdrawal.platformFee;
            await providerWallet.save({ session });
        }

        // Update admin wallet (platform fees collected)
        const adminUser = await User.findOne({ role: 'admin' }).session(session);
        if (adminUser) {
            let adminWallet = await Wallet.findOne({ userId: adminUser._id, role: 'admin' }).session(session);
            if (adminWallet) {
                adminWallet.totalPlatformFees += withdrawal.platformFee;
                await adminWallet.save({ session });
            }
        }

        await session.commitTransaction();

        // Notify provider
        const provider = await Provider.findById(withdrawal.providerId);
        if (provider) {
            await createNotification({
                userId: provider.userId,
                title: 'Withdrawal Approved',
                message: `Your withdrawal of BDT ${withdrawal.payableAmount} has been approved and processed. Amount will be credited to your bank account.`,
                type: 'withdrawal',
                referenceId: withdrawal._id,
                metadata: { withdrawalId: withdrawal._id, amount: withdrawal.payableAmount }
            });
        }

        return res.status(200).json(
            new ApiResponse(200, withdrawal, 'Withdrawal approved successfully')
        );
    } catch (error) {
        await session.abortTransaction();
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        return res.status(500).json(new ApiResponse(500, null, error.message));
    } finally {
        session.endSession();
    }
};

// Reject withdrawal (Admin)
export const rejectWithdrawal = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { withdrawalId } = req.params;
        const { reason } = req.body;

        if (!mongoose.Types.ObjectId.isValid(withdrawalId)) {
            throw new ApiError(400, 'Invalid withdrawal ID');
        }

        if (!reason) {
            throw new ApiError(400, 'Rejection reason is required');
        }

        const withdrawal = await Withdrawal.findById(withdrawalId).session(session);
        if (!withdrawal) {
            throw new ApiError(404, 'Withdrawal not found');
        }

        if (withdrawal.status !== 'pending') {
            throw new ApiError(400, `Withdrawal already ${withdrawal.status}`);
        }

        // Refund amount back to provider wallet
        const providerWallet = await Wallet.findOne({ userId: withdrawal.providerId, role: 'provider' }).session(session);
        if (providerWallet) {
            providerWallet.balance += withdrawal.requestedAmount;
            await providerWallet.save({ session });
        }

        // Update withdrawal status
        withdrawal.status = 'rejected';
        withdrawal.rejectedAt = new Date();
        withdrawal.rejectionReason = reason;
        await withdrawal.save({ session });

        await session.commitTransaction();

        // Notify provider
        const provider = await Provider.findById(withdrawal.providerId);
        if (provider) {
            await createNotification({
                userId: provider.userId,
                title: 'Withdrawal Rejected',
                message: `Your withdrawal request of BDT ${withdrawal.requestedAmount} was rejected. Reason: ${reason}. Amount has been returned to your wallet.`,
                type: 'withdrawal',
                referenceId: withdrawal._id,
                metadata: { withdrawalId: withdrawal._id, amount: withdrawal.requestedAmount, reason }
            });
        }

        return res.status(200).json(
            new ApiResponse(200, withdrawal, 'Withdrawal rejected successfully')
        );
    } catch (error) {
        await session.abortTransaction();
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        return res.status(500).json(new ApiResponse(500, null, error.message));
    } finally {
        session.endSession();
    }
};