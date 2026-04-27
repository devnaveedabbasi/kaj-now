import mongoose from 'mongoose';
import Wallet from '../../models/wallet.model.js';
import Payment from '../../models/payment.model.js';
import Job from '../../models/job.model.js';
import Provider from '../../models/provider/Provider.model.js';
import User from '../../models/User.model.js';
import Withdrawal from '../../models/withdrawal.model.js';
import ServiceRequest from '../../models/admin/serviceRequest.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { createNotification } from '../../utils/notification.js';

// Get admin wallet details and dashboard stats
export const getAdminWallet = async (req, res) => {
    try {
        const adminUser = await User.findOne({ role: 'admin' });
        if (!adminUser) {
            throw new ApiError(404, 'Admin user not found');
        }

        let adminWallet = await Wallet.findOne({ userId: adminUser._id, role: 'admin' });
        if (!adminWallet) {
            adminWallet = await Wallet.create({
                userId: adminUser._id,
                role: 'admin',
                balance: 0,
                totalEarnings: 0,
                totalWithdrawn: 0,
                totalPlatformFees: 0,
                isActive: true
            });
        }

        // --- New Aggregations for Admin Stats ---
        const [
            totalPlatformFeesResult,
            withdrawnPlatformFeesResult,
            totalProviderWithdrawalsResult
        ] = await Promise.all([
            Payment.aggregate([
                { $match: { paymentStatus: 'completed' } },
                { $group: { _id: null, total: { $sum: '$platformFee' } } }
            ]),
            Withdrawal.aggregate([
                { $match: { status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$platformFee' } } }
            ]),
            Withdrawal.aggregate([
                { $match: { status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$payableAmount' } } }
            ])
        ]);

        const totalPlatformFees = totalPlatformFeesResult[0]?.total || 0;
        const withdrawnPlatformFees = withdrawnPlatformFeesResult[0]?.total || 0;
        const totalProviderWithdrawals = totalProviderWithdrawalsResult[0]?.total || 0;
        
        //  FIXED: Admin earns fees from BOTH payment AND withdrawal
        // adminNetEarning = platform fees from payments + platform fees from withdrawals
        const adminNetEarning =   totalPlatformFees;

        // --- Existing Stats ---
        const [
            totalJobs,
            completedJobs,
            pendingJobs,
            totalPayments,
            pendingWithdrawalsCount,
            pendingWithdrawalsAmountResult,
            totalWithdrawalsAmount,
            monthlyEarnings,
            weeklyEarnings
        ] = await Promise.all([
            Job.countDocuments(),
            Job.countDocuments({ status: 'confirmed_by_user' }),
            Job.countDocuments({ status: 'pending' }),
            Payment.aggregate([
                { $match: { paymentStatus: 'completed' } },
                { $group: { _id: null, total: { $sum: '$totalAmount' } } }
            ]),
            Withdrawal.countDocuments({ status: 'pending' }),
            Withdrawal.aggregate([
                { $match: { status: 'pending' } },
                { $group: { _id: null, totalRequested: { $sum: '$requestedAmount' }, totalPayable: { $sum: '$payableAmount' } } }
            ]),
            Withdrawal.aggregate([
                { $match: { status: 'completed' } },
                { $group: { _id: null, total: { $sum: '$payableAmount' } } }
            ]),
            // Monthly earnings (last 30 days)
            Payment.aggregate([
                {
                    $match: {
                        paymentStatus: 'completed',
                        createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
                    }
                },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                        total: { $sum: '$platformFee' }
                    }
                },
                { $sort: { _id: -1 } },
                { $limit: 30 }
            ]),
            // Weekly earnings (last 7 days)
            Payment.aggregate([
                {
                    $match: {
                        paymentStatus: 'completed',
                        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
                    }
                },
                {
                    $group: {
                        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                        total: { $sum: '$platformFee' }
                    }
                },
                { $sort: { _id: -1 } }
            ])
        ]);

        const totalWithdrawnAmount = totalWithdrawalsAmount[0]?.total || 0;
        const totalPendingWithdrawalsAmount = pendingWithdrawalsAmountResult[0]?.totalRequested || 0;
        const totalPendingWithdrawalsPayable = pendingWithdrawalsAmountResult[0]?.totalPayable || 0;

        // Get recent transactions
        const recentTransactions = await Payment.find({ paymentStatus: 'completed' })
            .populate('customerId', 'name email')
            .populate('providerId', 'name email')
            .populate('jobId', 'orderId')
            .sort({ createdAt: -1 })
            .limit(10)
            .lean();

        // Get pending withdrawals with provider details
        const pendingWithdrawalsList = await Withdrawal.find({ status: 'pending' })
            .populate('providerId', 'name email phone bankDetails')
            .sort({ createdAt: -1 })
            .limit(10)
            .lean();

        // Get platform fee breakdown by service
        const platformFeeBreakdown = await Payment.aggregate([
            { $match: { paymentStatus: 'completed' } },
            {
                $lookup: {
                    from: 'jobs',
                    localField: 'jobId',
                    foreignField: '_id',
                    as: 'job'
                }
            },
            { $unwind: '$job' },
            {
                $lookup: {
                    from: 'services',
                    localField: 'job.service',
                    foreignField: '_id',
                    as: 'service'
                }
            },
            { $unwind: '$service' },
            {
                $group: {
                    _id: '$service.name',
                    totalPlatformFee: { $sum: '$platformFee' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { totalPlatformFee: -1 } },
            { $limit: 10 }
        ]);

        // Get monthly statistics for chart
        const monthlyStats = await Payment.aggregate([
            {
                $match: {
                    paymentStatus: 'completed',
                    createdAt: { $gte: new Date(Date.now() - 12 * 30 * 24 * 60 * 60 * 1000) }
                }
            },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' }
                    },
                    totalPlatformFee: { $sum: '$platformFee' },
                    totalAmount: { $sum: '$totalAmount' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.year': -1, '_id.month': -1 } },
            { $limit: 12 }
        ]);

        // Format monthly stats for chart
        const chartData = monthlyStats.map(stat => ({
            month: `${stat._id.year}-${String(stat._id.month).padStart(2, '0')}`,
            platformFee: stat.totalPlatformFee,
            totalAmount: stat.totalAmount,
            count: stat.count
        })).reverse();

        return res.status(200).json(
            new ApiResponse(200, {
                wallet: {
                    balance: adminWallet.balance,
                    totalEarnings: adminNetEarning, // Platform fees from payments + withdrawals
                    totalPlatformFees,
                    withdrawnPlatformFees,
                    totalProviderWithdrawals,
                    totalWithdrawn: adminWallet.totalWithdrawn,
                },
                pendingWithdrawals: {
                    count: pendingWithdrawalsCount,
                    totalRequested: totalPendingWithdrawalsAmount,
                    totalPayable: totalPendingWithdrawalsPayable,
                    list: pendingWithdrawalsList
                },
                breakdown: {
                    byService: platformFeeBreakdown,
                    monthlyData: chartData,
                    recentTransactions
                }
            }, 'Admin wallet details retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting admin wallet:', error);
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        return res.status(500).json(new ApiResponse(500, null, error.message));
    }
};

// Get all transactions (Admin)
export const getAllTransactions = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;
        const { type, startDate, endDate } = req.query;

        let query = { paymentStatus: 'completed' };
        
        if (type === 'withdrawal') {
            // Get withdrawals instead of payments
            const withdrawals = await Withdrawal.find({ status: 'completed' })
                .populate('providerId', 'name email')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit);
            
            const total = await Withdrawal.countDocuments({ status: 'completed' });
            const totalPages = Math.ceil(total / limit);
            
            return res.status(200).json(
                new ApiResponse(200, {
                    transactions: withdrawals,
                    type: 'withdrawal',
                    pagination: {
                        currentPage: page,
                        totalPages,
                        totalItems: total,
                        itemsPerPage: limit
                    }
                }, 'Withdrawals retrieved successfully')
            );
        }

        // Date filter
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const [transactions, total] = await Promise.all([
            Payment.find(query)
                .populate('customerId', 'name email')
                .populate('providerId', 'name email')
                .populate('jobId', 'orderId service')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Payment.countDocuments(query)
        ]);

        const totalPages = Math.ceil(total / limit);

        return res.status(200).json(
            new ApiResponse(200, {
                transactions,
                type: 'payment',
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: total,
                    itemsPerPage: limit
                }
            }, 'Transactions retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting transactions:', error);
        return res.status(500).json(new ApiResponse(500, null, error.message));
    }
};

// Get platform fee statistics
export const getPlatformFeeStats = async (req, res) => {
    try {
        const { period = 'month' } = req.query; // day, week, month, year
        
        let dateFilter = {};
        const now = new Date();
        
        switch(period) {
            case 'day':
                dateFilter = { $gte: new Date(now.setHours(0, 0, 0, 0)) };
                break;
            case 'week':
                dateFilter = { $gte: new Date(now.setDate(now.getDate() - 7)) };
                break;
            case 'month':
                dateFilter = { $gte: new Date(now.setMonth(now.getMonth() - 1)) };
                break;
            case 'year':
                dateFilter = { $gte: new Date(now.setFullYear(now.getFullYear() - 1)) };
                break;
            default:
                dateFilter = { $gte: new Date(now.setMonth(now.getMonth() - 1)) };
        }

        const platformFees = await Payment.aggregate([
            { $match: { paymentStatus: 'completed', createdAt: dateFilter } },
            {
                $group: {
                    _id: null,
                    totalPlatformFee: { $sum: '$platformFee' },
                    totalAmount: { $sum: '$totalAmount' },
                    averagePlatformFee: { $avg: '$platformFee' },
                    count: { $sum: 1 }
                }
            }
        ]);

        // Get top earning services by platform fee
        const topServices = await Payment.aggregate([
            { $match: { paymentStatus: 'completed', createdAt: dateFilter } },
            {
                $lookup: {
                    from: 'jobs',
                    localField: 'jobId',
                    foreignField: '_id',
                    as: 'job'
                }
            },
            { $unwind: '$job' },
            {
                $lookup: {
                    from: 'services',
                    localField: 'job.service',
                    foreignField: '_id',
                    as: 'service'
                }
            },
            { $unwind: '$service' },
            {
                $group: {
                    _id: '$service._id',
                    serviceName: { $first: '$service.name' },
                    totalPlatformFee: { $sum: '$platformFee' },
                    totalJobs: { $sum: 1 }
                }
            },
            { $sort: { totalPlatformFee: -1 } },
            { $limit: 10 }
        ]);

        // Get daily platform fee for chart
        const dailyFees = await Payment.aggregate([
            { $match: { paymentStatus: 'completed', createdAt: dateFilter } },
            {
                $group: {
                    _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
                    total: { $sum: '$platformFee' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        const stats = platformFees[0] || {
            totalPlatformFee: 0,
            totalAmount: 0,
            averagePlatformFee: 0,
            count: 0
        };

        return res.status(200).json(
            new ApiResponse(200, {
                period,
                summary: {
                    totalPlatformFee: stats.totalPlatformFee,
                    totalTransactionAmount: stats.totalAmount,
                    averagePlatformFee: stats.averagePlatformFee.toFixed(2),
                    totalTransactions: stats.count,
                    effectiveRate: stats.totalAmount > 0 
                        ? ((stats.totalPlatformFee / stats.totalAmount) * 100).toFixed(2) 
                        : 0
                },
                topServices,
                dailyBreakdown: dailyFees,
                platformFeePercentage: process.env.PLATFORM_FEE_PERCENTAGE || '10'
            }, 'Platform fee statistics retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting platform fee stats:', error);
        return res.status(500).json(new ApiResponse(500, null, error.message));
    }
};

// Get withdrawal statistics (Admin)
export const getWithdrawalStats = async (req, res) => {
    try {
        const withdrawals = await Withdrawal.aggregate([
            {
                $group: {
                    _id: '$status',
                    totalAmount: { $sum: '$requestedAmount' },
                    totalPayable: { $sum: '$payableAmount' },
                    totalPlatformFee: { $sum: '$platformFee' },
                    count: { $sum: 1 }
                }
            }
        ]);

        const monthlyWithdrawals = await Withdrawal.aggregate([
            {
                $match: {
                    createdAt: { $gte: new Date(Date.now() - 12 * 30 * 24 * 60 * 60 * 1000) }
                }
            },
            {
                $group: {
                    _id: {
                        year: { $year: '$createdAt' },
                        month: { $month: '$createdAt' },
                        status: '$status'
                    },
                    totalAmount: { $sum: '$requestedAmount' },
                    count: { $sum: 1 }
                }
            },
            { $sort: { '_id.year': -1, '_id.month': -1 } }
        ]);

        const stats = {
            pending: { amount: 0, payable: 0, platformFee: 0, count: 0 },
            completed: { amount: 0, payable: 0, platformFee: 0, count: 0 },
            rejected: { amount: 0, payable: 0, platformFee: 0, count: 0 }
        };

        withdrawals.forEach(w => {
            if (stats[w._id]) {
                stats[w._id] = {
                    amount: w.totalAmount,
                    payable: w.totalPayable,
                    platformFee: w.totalPlatformFee,
                    count: w.count
                };
            }
        });

        return res.status(200).json(
            new ApiResponse(200, {
                summary: stats,
                totalWithdrawn: stats.completed.amount,
                totalPlatformFeesCollected: stats.completed.platformFee,
                monthlyBreakdown: monthlyWithdrawals
            }, 'Withdrawal statistics retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting withdrawal stats:', error);
        return res.status(500).json(new ApiResponse(500, null, error.message));
    }
};

// Get admin earnings overview
export const getAdminEarningsOverview = async (req, res) => {
    try {
        // Get earnings by day for current week
        const weeklyEarnings = [];
        for (let i = 6; i >= 0; i--) {
            const date = new Date();
            date.setDate(date.getDate() - i);
            date.setHours(0, 0, 0, 0);
            
            const nextDate = new Date(date);
            nextDate.setDate(nextDate.getDate() + 1);
            
            const earnings = await Payment.aggregate([
                {
                    $match: {
                        paymentStatus: 'completed',
                        createdAt: { $gte: date, $lt: nextDate }
                    }
                },
                {
                    $group: {
                        _id: null,
                        platformFee: { $sum: '$platformFee' },
                        totalAmount: { $sum: '$totalAmount' }
                    }
                }
            ]);
            
            weeklyEarnings.push({
                date: date.toISOString().split('T')[0],
                day: date.toLocaleDateString('en', { weekday: 'short' }),
                platformFee: earnings[0]?.platformFee || 0,
                totalAmount: earnings[0]?.totalAmount || 0
            });
        }

        // Get earnings by month for current year
        const monthlyEarnings = [];
        const currentYear = new Date().getFullYear();
        
        for (let month = 0; month < 12; month++) {
            const startDate = new Date(currentYear, month, 1);
            const endDate = new Date(currentYear, month + 1, 0);
            
            const earnings = await Payment.aggregate([
                {
                    $match: {
                        paymentStatus: 'completed',
                        createdAt: { $gte: startDate, $lte: endDate }
                    }
                },
                {
                    $group: {
                        _id: null,
                        platformFee: { $sum: '$platformFee' },
                        totalAmount: { $sum: '$totalAmount' }
                    }
                }
            ]);
            
            monthlyEarnings.push({
                month: startDate.toLocaleDateString('en', { month: 'short' }),
                platformFee: earnings[0]?.platformFee || 0,
                totalAmount: earnings[0]?.totalAmount || 0
            });
        }

        // Get top providers by platform fee contribution
        const topProviders = await Payment.aggregate([
            { $match: { paymentStatus: 'completed' } },
            {
                $group: {
                    _id: '$providerId',
                    totalPlatformFee: { $sum: '$platformFee' },
                    totalJobs: { $sum: 1 },
                    totalAmount: { $sum: '$totalAmount' }
                }
            },
            {
                $lookup: {
                    from: 'providers',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'provider'
                }
            },
            { $unwind: '$provider' },
            {
                $lookup: {
                    from: 'users',
                    localField: 'provider.userId',
                    foreignField: '_id',
                    as: 'user'
                }
            },
            { $unwind: '$user' },
            {
                $project: {
                    providerId: '$_id',
                    name: '$user.name',
                    email: '$user.email',
                    totalPlatformFee: 1,
                    totalJobs: 1,
                    totalAmount: 1
                }
            },
            { $sort: { totalPlatformFee: -1 } },
            { $limit: 10 }
        ]);

        return res.status(200).json(
            new ApiResponse(200, {
                weekly: weeklyEarnings,
                monthly: monthlyEarnings,
                topProviders,
                platformFeePercentage: process.env.PLATFORM_FEE_PERCENTAGE || '10'
            }, 'Admin earnings overview retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting admin earnings overview:', error);
        return res.status(500).json(new ApiResponse(500, null, error.message));
    }
};