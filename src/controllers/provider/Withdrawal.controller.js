import mongoose from 'mongoose';
import Wallet from '../../models/wallet.model.js';
import Provider from '../../models/provider/Provider.model.js';
import User from '../../models/User.model.js';
import Withdrawal from '../../models/withdrawal.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { createNotification } from '../../utils/notification.js';

const MIN_WITHDRAWAL_AMOUNT=100
// Request withdrawal
export const requestWithdrawal = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const userId = req.user._id;
        const { amount } = req.body;

        if (!amount || amount <= 0) {
            throw new ApiError(400, 'Invalid withdrawal amount');
        }

        // Get provider
        const provider = await Provider.findOne({ userId });
        if (!provider) {
            throw new ApiError(404, 'Provider profile not found');
        }

        // Check if bank details exist
        if (!provider.bankDetails || !provider.bankDetails.accountNumber) {
            throw new ApiError(400, 'Please add bank details before requesting withdrawal');
        }

        // Get wallet
        let wallet = await Wallet.findOne({ userId: provider._id, role: 'provider' }).session(session);
        if (!wallet) {
            wallet = await Wallet.create([{
                userId: provider._id,
                role: 'provider',
                balance: 0,
                totalEarnings: 0,
                totalWithdrawn: 0,
                totalPlatformFees: 0,
                isActive: true
            }], { session });
            wallet = wallet[0];
        }

        // Check minimum withdrawal amount
        const minWithdrawal = parseFloat(MIN_WITHDRAWAL_AMOUNT || '500');
        if (amount < minWithdrawal) {
            throw new ApiError(400, `Minimum withdrawal amount is BDT ${minWithdrawal}`);
        }

        // Check balance
        if (wallet.balance < amount) {
            throw new ApiError(400, `Insufficient balance. Available: BDT ${wallet.balance}`);
        }

        // Calculate platform fee
        const platformFeePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENTAGE || '10');
        const platformFee = parseFloat(((platformFeePercentage / 100) * amount).toFixed(2));
        const payableAmount = parseFloat((amount - platformFee).toFixed(2));

        // Deduct from wallet balance
        wallet.balance -= amount;
        await wallet.save({ session });

        // Create withdrawal request
        const withdrawal = await Withdrawal.create([{
            providerId: provider._id,
            requestedAmount: amount,
            platformFeePercentage,
            platformFee,
            payableAmount,
            bankDetails: {
                bankName: provider.bankDetails.bankName,
                accountNumber: provider.bankDetails.accountNumber,
                accountTitle: provider.bankDetails.accountHolderName,
                branchCode: provider.bankDetails.branchCode || ''
            },
            status: 'pending'
        }], { session });

        await session.commitTransaction();

        // Notify admin
        const admins = await User.find({ role: 'admin' });
        for (const admin of admins) {
            await createNotification({
                userId: admin._id,
                title: 'New Withdrawal Request',
                message: `Provider ${provider.name} requested withdrawal of BDT ${amount}`,
                type: 'withdrawal',
                referenceId: withdrawal[0]._id,
                metadata: { withdrawalId: withdrawal[0]._id, amount, payableAmount }
            });
        }

        // Notify provider
        await createNotification({
            userId: provider.userId,
            title: 'Withdrawal Request Submitted',
            message: `Your withdrawal request of BDT ${amount} has been submitted. Admin will process it soon.`,
            type: 'withdrawal',
            referenceId: withdrawal[0]._id
        });

        return res.status(201).json(
            new ApiResponse(201, {
                withdrawal: withdrawal[0],
                remainingBalance: wallet.balance,
                breakdown: {
                    requestedAmount: amount,
                    platformFee: `${platformFeePercentage}% = BDT ${platformFee}`,
                    payableAmount: `BDT ${payableAmount}`
                }
            }, 'Withdrawal request submitted successfully')
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

// Get my withdrawal history (Provider)
export const getMyWithdrawals = async (req, res) => {
    try {
        const userId = req.user._id;
        const { status, page = 1, limit = 10 } = req.query;

        const provider = await Provider.findOne({ userId });
        if (!provider) {
            throw new ApiError(404, 'Provider profile not found');
        }

        let query = { providerId: provider._id };
        if (status && status !== 'all') {
            query.status = status;
        }

        const skip = (page - 1) * limit;
        const [withdrawals, total] = await Promise.all([
            Withdrawal.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
            Withdrawal.countDocuments(query)
        ]);

        // Get statistics
        const stats = await Withdrawal.aggregate([
            { $match: { providerId: provider._id } },
            { $group: {
                _id: '$status',
                totalAmount: { $sum: '$requestedAmount' },
                count: { $sum: 1 }
            }}
        ]);

        const withdrawalStats = {
            totalRequested: 0,
            totalPaid: 0,
            pending: 0,
            completed: 0,
            rejected: 0
        };

        stats.forEach(stat => {
            if (stat._id === 'pending') {
                withdrawalStats.pending = stat.count;
                withdrawalStats.totalRequested += stat.totalAmount;
            }
            if (stat._id === 'completed') {
                withdrawalStats.completed = stat.count;
                withdrawalStats.totalPaid += stat.totalAmount;
                withdrawalStats.totalRequested += stat.totalAmount;
            }
            if (stat._id === 'rejected') {
                withdrawalStats.rejected = stat.count;
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
            }, 'Withdrawal history retrieved successfully')
        );
    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        return res.status(500).json(new ApiResponse(500, null, error.message));
    }
};

// Get withdrawal by ID
export const getWithdrawalById = async (req, res) => {
    try {
        const { withdrawalId } = req.params;
        const userId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(withdrawalId)) {
            throw new ApiError(400, 'Invalid withdrawal ID');
        }

        const provider = await Provider.findOne({ userId });
        if (!provider) {
            throw new ApiError(404, 'Provider profile not found');
        }

        const withdrawal = await Withdrawal.findOne({ _id: withdrawalId, providerId: provider._id });
        if (!withdrawal) {
            throw new ApiError(404, 'Withdrawal not found');
        }

        return res.status(200).json(
            new ApiResponse(200, withdrawal, 'Withdrawal details retrieved successfully')
        );
    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        return res.status(500).json(new ApiResponse(500, null, error.message));
    }
};

export const getWithdrawalReceipt = async (req, res) => {
    try {
        const { withdrawalId } = req.params;
        const userId = req.user._id;

        if (!mongoose.Types.ObjectId.isValid(withdrawalId)) {
            throw new ApiError(400, 'Invalid withdrawal ID');
        }

        const provider = await Provider.findOne({ userId });
        if (!provider) {
            throw new ApiError(404, 'Provider profile not found');
        }

        const withdrawal = await Withdrawal.findOne({ 
            _id: withdrawalId, 
            providerId: provider._id 
        });

        if (!withdrawal) {
            throw new ApiError(404, 'Withdrawal not found');
        }

        if (!withdrawal.receiptImage) {
            throw new ApiError(404, 'Receipt not found');
        }

        const receiptPath = path.join(process.cwd(), 'public', withdrawal.receiptImage);
        
        if (!fs.existsSync(receiptPath)) {
            throw new ApiError(404, 'Receipt file not found');
        }

        return res.sendFile(receiptPath);
    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        return res.status(500).json(new ApiResponse(500, null, error.message));
    }
};