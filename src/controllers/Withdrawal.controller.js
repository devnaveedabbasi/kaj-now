// controllers/job.controller.js
import mongoose from 'mongoose';
import Job from '../models/job.model.js';
import Payment from '../models/payment.model.js';
import Wallet from '../models/wallet.model.js';
import Provider from '../models/provider/Provider.model.js';
import User from '../models/User.model.js';
import Service from '../models/admin/service.model.js';
import ServiceRequest from '../models/admin/serviceRequest.model.js';
import Withdrawal from '../models/withdrawal.model.js';
import { ApiError } from '../utils/errorHandler.js';
import { processSSLCommerzPayment } from '../utils/sslcommerz.js';
import { createNotification } from '../utils/createNotification.js';



export async function requestWithdrawal(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const providerId = req.user._id; // Provider's userId (from auth token)
    const { amount, bankDetails } = req.body;
    // bankDetails: { bankName, accountNumber, accountTitle, branchCode }

    if (!amount || amount <= 0) throw new ApiError(400, 'Invalid withdrawal amount');
    if (!bankDetails?.bankName || !bankDetails?.accountNumber || !bankDetails?.accountTitle) {
      throw new ApiError(400, 'Bank details are required (bankName, accountNumber, accountTitle)');
    }

    // Get provider wallet by userId (provider's user id from auth)
    const providerWallet = await Wallet.findOne({ userId: providerId, role: 'provider' }).session(session);
    if (!providerWallet) throw new ApiError(404, 'Provider wallet not found');
    if (!providerWallet.isActive) throw new ApiError(400, 'Wallet is not active');

    // ── Platform fee calculation ─────────────────────────────────────────────
    const platformFeePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENTAGE || '10');
    const platformFeeAmount = parseFloat(((platformFeePercentage / 100) * amount).toFixed(2));
    const payableAmount = parseFloat((amount - platformFeeAmount).toFixed(2));

    if (providerWallet.balance < amount) {
      throw new ApiError(400, `Insufficient wallet balance. Available: BDT ${providerWallet.balance}`);
    }

    if (payableAmount <= 0) throw new ApiError(400, 'Withdrawal amount too small after platform fee deduction');

    // ── Hold the amount (deduct from balance immediately) ───────────────────
    providerWallet.balance -= amount;
    await providerWallet.save({ session });

    // ── Create withdrawal request ────────────────────────────────────────────
    const withdrawal = await Withdrawal.create(
      [
        {
          providerId,
          requestedAmount: amount,
          platformFee: platformFeeAmount,
          payableAmount,
          platformFeePercentage,
          bankDetails,
          status: 'pending',
        },
      ],
      { session }
    );

    await session.commitTransaction();

    // ── Notify admin ─────────────────────────────────────────────────────────
    const adminUser = await User.findOne({ role: 'admin' });
    if (adminUser) {
      await createNotification({
        userId: adminUser._id,
        title: 'New Withdrawal Request',
        message: `A provider has requested a withdrawal of BDT ${amount} (Payable: BDT ${payableAmount} after ${platformFeePercentage}% platform fee).`,
        type: 'withdrawal',
        referenceId: withdrawal[0]._id,
        metadata: { withdrawalId: withdrawal[0]._id, amount, payableAmount, platformFeeAmount },
      });
    }

    return res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted successfully.',
      data: {
        withdrawal: withdrawal[0],
        breakdown: {
          requestedAmount: amount,
          platformFee: `${platformFeePercentage}% = BDT ${platformFeeAmount}`,
          payableAmount: `BDT ${payableAmount}`,
        },
        remainingWalletBalance: providerWallet.balance,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
}

// ─────────────────────────────────────────────
// 9. ADMIN: Process Payout (mark withdrawal complete + attach proof)
// ─────────────────────────────────────────────
export async function processWithdrawal(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { withdrawalId } = req.params;
    const { proofMessage, proofImageUrl } = req.body; // admin sends proof

    if (!mongoose.Types.ObjectId.isValid(withdrawalId)) throw new ApiError(400, 'Invalid withdrawal ID');

    const withdrawal = await Withdrawal.findById(withdrawalId).session(session);
    if (!withdrawal) throw new ApiError(404, 'Withdrawal request not found');

    if (withdrawal.status !== 'pending') {
      throw new ApiError(400, `Withdrawal already processed. Status: ${withdrawal.status}`);
    }

    // ── Update admin wallet: deduct payable amount ───────────────────────────
    const adminUser = await User.findOne({ role: 'admin' }).session(session);
    if (!adminUser) throw new ApiError(500, 'Admin not found');

    const adminWallet = await Wallet.findOne({ userId: adminUser._id, role: 'admin' }).session(session);
    if (adminWallet) {
      adminWallet.totalPlatformFees += withdrawal.platformFee;
      // Note: admin wallet balance was never credited with the provider amount
      // because it was credited to provider wallet at confirmation time.
      // Platform fee stays in admin wallet.
      await adminWallet.save({ session });
    }

    // ── Update provider wallet totals ────────────────────────────────────────
    const providerWallet = await Wallet.findOne({ userId: withdrawal.providerId, role: 'provider' }).session(session);
    if (providerWallet) {
      providerWallet.totalWithdrawn += withdrawal.requestedAmount;
      providerWallet.totalPlatformFees += withdrawal.platformFee;
      await providerWallet.save({ session });
    }

    // ── Mark withdrawal complete ─────────────────────────────────────────────
    withdrawal.status = 'completed';
    withdrawal.processedAt = new Date();
    withdrawal.proofMessage = proofMessage || null;
    withdrawal.proofImageUrl = proofImageUrl || null;
    await withdrawal.save({ session });

    await session.commitTransaction();

    // ── Notify provider ───────────────────────────────────────────────────────
    await createNotification({
      userId: withdrawal.providerId,
      title: 'Withdrawal Processed',
      message: `Your withdrawal of BDT ${withdrawal.payableAmount} has been transferred to your bank account. ${proofMessage ? `Admin note: ${proofMessage}` : ''}`,
      type: 'withdrawal',
      referenceId: withdrawal._id,
      metadata: {
        withdrawalId: withdrawal._id,
        payableAmount: withdrawal.payableAmount,
        proofImageUrl: withdrawal.proofImageUrl || null,
      },
    });

    return res.status(200).json({
      success: true,
      message: 'Withdrawal processed successfully.',
      data: withdrawal,
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
}

// ─────────────────────────────────────────────
// 10. ADMIN: Reject Withdrawal (refund back to wallet)
// ─────────────────────────────────────────────
export async function rejectWithdrawal(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { withdrawalId } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(withdrawalId)) throw new ApiError(400, 'Invalid withdrawal ID');
    if (!reason) throw new ApiError(400, 'Rejection reason is required');

    const withdrawal = await Withdrawal.findById(withdrawalId).session(session);
    if (!withdrawal) throw new ApiError(404, 'Withdrawal request not found');

    if (withdrawal.status !== 'pending') {
      throw new ApiError(400, `Cannot reject. Status: ${withdrawal.status}`);
    }

    // ── Refund amount back to provider wallet ────────────────────────────────
    const providerWallet = await Wallet.findOne({ userId: withdrawal.providerId, role: 'provider' }).session(session);
    if (providerWallet) {
      providerWallet.balance += withdrawal.requestedAmount; // restore full amount
      await providerWallet.save({ session });
    }

    withdrawal.status = 'rejected';
    withdrawal.rejectedAt = new Date();
    withdrawal.rejectionReason = reason;
    await withdrawal.save({ session });

    await session.commitTransaction();

    // ── Notify provider ───────────────────────────────────────────────────────
    await createNotification({
      userId: withdrawal.providerId,
      title: 'Withdrawal Rejected',
      message: `Your withdrawal request of BDT ${withdrawal.requestedAmount} was rejected. Reason: ${reason}. The amount has been returned to your wallet.`,
      type: 'withdrawal',
      referenceId: withdrawal._id,
      metadata: { withdrawalId: withdrawal._id, refundedAmount: withdrawal.requestedAmount },
    });

    return res.status(200).json({
      success: true,
      message: 'Withdrawal rejected and amount refunded to provider wallet.',
      data: withdrawal,
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
}

// ─────────────────────────────────────────────
// 11. GET WITHDRAWAL HISTORY (Provider)
// ─────────────────────────────────────────────
export async function getMyWithdrawals(req, res) {
  try {
    const providerId = req.user._id;
    const { status, page = 1, limit = 10 } = req.query;

    let query = { providerId };
    if (status) query.status = status;

    const skip = (page - 1) * limit;
    const [withdrawals, total] = await Promise.all([
      Withdrawal.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Withdrawal.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        withdrawals,
        pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
}

// ─────────────────────────────────────────────
// 12. GET ALL WITHDRAWALS (Admin)
// ─────────────────────────────────────────────
export async function getAllWithdrawals(req, res) {
  try {
    const { status, page = 1, limit = 10 } = req.query;

    let query = {};
    if (status) query.status = status;

    const skip = (page - 1) * limit;
    const [withdrawals, total] = await Promise.all([
      Withdrawal.find(query)
        .populate('providerId', 'name email phone')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Withdrawal.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        withdrawals,
        pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / limit) },
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
}

