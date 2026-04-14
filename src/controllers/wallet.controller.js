import mongoose from 'mongoose';
import Wallet from '../models/wallet.model.js';
import Payment from '../models/payment.model.js';
import User from '../models/User.model.js';
import Provider from '../models/provider/Provider.model.js';
import { ApiError } from '../utils/errorHandler.js';
import { ApiResponse } from '../utils/apiResponse.js';


export const getMyWallet = async (req, res) => {
  const userId = req.user._id;
  const userRole = req.user.role;

  try {
    const wallet = await Wallet.findOne({
      userId: new mongoose.Types.ObjectId(userId),
      role: userRole === 'admin' ? 'admin' : 'provider',
    });

    if (!wallet) {
      return res.status(404).json({
        success: false,
        message: 'Wallet not found',
      });
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          _id: wallet._id,
          balance: wallet.balance,
          totalEarnings: wallet.totalEarnings,
          totalWithdrawn: wallet.totalWithdrawn,
          totalPlatformFees: wallet.totalPlatformFees,
          isActive: wallet.isActive,
          createdAt: wallet.createdAt,
        },
        'Wallet retrieved successfully'
      )
    );

  } catch (error) {
    console.error('Get Wallet Error:', error);
    throw error;
  }
};


export const getWalletTransactionHistory = async (req, res) => {
  const userId = req.user._id;
  const { page = 1, limit = 20, status } = req.query;

  try {
    const skip = (page - 1) * limit;

    let wallet = await Wallet.findOne({
      userId,
      role: req.user.role === 'admin' ? 'admin' : 'provider',
    });

    if (!wallet) {
      throw new ApiError(404, 'Wallet not found');
    }

    let query = { _id: { $in: wallet.transactionHistory } };

    if (status) {
      query.paymentStatus = status;
    }

    const [transactions, totalCount] = await Promise.all([
      Payment.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .select(
          'jobId totalAmount platformFee providerAmount paymentStatus disbursementStatus createdAt disbursedAt'
        )
        .populate('jobId', 'status service')
        .lean(),
      Payment.countDocuments(query),
    ]);

    const totalPages = Math.ceil(totalCount / limit);

    res.status(200).json(
      new ApiResponse(
        200,
        {
          transactions,
          pagination: {
            totalCount,
            totalPages,
            currentPage: parseInt(page),
            limit: parseInt(limit),
          },
        },
        'Transaction history retrieved successfully'
      )
    );
  } catch (error) {
    console.error('Get Transaction History Error:', error);
    throw error;
  }
};



export const getEarningsSummary = async (req, res) => {
  const userId = req.user._id;

  try {
    if (req.user.role !== 'provider') {
      throw new ApiError(403, 'Only providers can access earnings summary');
    }

    const wallet = await Wallet.findOne({
      userId,
      role: 'provider',
    });

    if (!wallet) {
      throw new ApiError(404, 'Wallet not found');
    }

    // Get payment statistics
    const payments = await Payment.find({
      providerId: userId,
    });

    const completedPayments = payments.filter((p) => p.paymentStatus === 'completed');
    const disbursedPayments = payments.filter((p) => p.disbursementStatus === 'released');
    const pendingDisbursements = completedPayments.filter((p) => p.disbursementStatus === 'pending');

    const totalCompleted = completedPayments.reduce((sum, p) => sum + p.totalAmount, 0);
    const totalDisbursed = disbursedPayments.reduce((sum, p) => sum + p.providerAmount, 0);
    const totalPending = pendingDisbursements.reduce((sum, p) => sum + p.totalAmount, 0);

    res.status(200).json(
      new ApiResponse(
        200,
        {
          walletBalance: wallet.balance,
          totalEarnings: wallet.totalEarnings,
          totalWithdrawn: wallet.totalWithdrawn,
          totalPlatformFeesDeducted: wallet.totalPlatformFees,
          summary: {
            totalCompletedPayments: totalCompleted,
            totalDisbursedToWallet: totalDisbursed,
            pendingDisbursements: totalPending,
            pendingDisbursementCount: pendingDisbursements.length,
          },
        },
        'Earnings summary retrieved successfully'
      )
    );
  } catch (error) {
    console.error('Get Earnings Summary Error:', error);
    throw error;
  }
};

