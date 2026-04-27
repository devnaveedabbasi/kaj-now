import mongoose from 'mongoose';
import Wallet from '../../models/wallet.model.js';
import Provider from '../../models/provider/Provider.model.js';
import User from '../../models/User.model.js';
import Withdrawal from '../../models/withdrawal.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { createNotification } from '../../utils/notification.js';
import { createActivityLog } from '../../utils/createActivityLog.js';
import fs from 'fs';
import path from 'path';
import { sendWithdrawalApprovedEmail } from '../../service/emailService.js';
import { generateWithdrawalInvoice } from '../../utils/generateWithdrawalInvoice.js';

// Get all withdrawals (Admin)
export const getAllWithdrawals = async (req, res) => {
  try {
    const { status, page = 1, limit = 10 } = req.query;

    const query = {};
    if (status && status !== "all") {
      query.status = status;
    }

    const skip = (page - 1) * Number(limit);

    const [withdrawals, total] = await Promise.all([
      Withdrawal.find(query)
        .populate({
          path: "providerId",
          select: "userId bankDetails",
          populate: {
            path: "userId",
            select: "name email phone",
          },
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),

      Withdrawal.countDocuments(query),
    ]);

    // ✅ FIXED STATS
    const statsAgg = await Withdrawal.aggregate([
      {
        $group: {
          _id: "$status",
          totalAmount: { $sum: "$requestedAmount" },
          totalFee: { $sum: "$platformFee" },
          count: { $sum: 1 },
        },
      },
    ]);

    const stats = {
      totalPending: 0,
      totalCompleted: 0,
      totalRejected: 0,
      totalCompletedAmount: 0,
      totalPlatformFees: 0,
    };

    statsAgg.forEach((s) => {
      if (s._id === "pending") stats.totalPending = s.count;

      if (s._id === "completed") {
        stats.totalCompleted = s.count;
        stats.totalCompletedAmount = s.totalAmount;
        stats.totalPlatformFees += s.totalFee || 0;
      }

      if (s._id === "rejected") stats.totalRejected = s.count;
    });

    const totalPages = Math.ceil(total / Number(limit));

    const formatted = withdrawals.map((w) => ({
      ...w.toObject(),
  
      invoiceUrl: w.invoiceUrl || null,
    }));

    return res.status(200).json({
      success: true,
      data: {
        withdrawals: formatted,
        stats,
        pagination: {
          currentPage: Number(page),
          totalPages,
          totalItems: total,
          itemsPerPage: Number(limit),
        },
      },
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const approveWithdrawal = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { withdrawalId } = req.params;
        const { transactionId, notes } = req.body;
        const receiptFile = req.file; // Multer file object

        if (!mongoose.Types.ObjectId.isValid(withdrawalId)) {
            // Clean up uploaded file if exists
            if (receiptFile && fs.existsSync(receiptFile.path)) {
                fs.unlinkSync(receiptFile.path);
            }
            throw new ApiError(400, 'Invalid withdrawal ID');
        }

        if (!receiptFile) {
            throw new ApiError(400, 'Payment receipt is required');
        }

        const withdrawal = await Withdrawal.findById(withdrawalId).session(session);
        if (!withdrawal) {
            // Clean up uploaded file
            if (receiptFile && fs.existsSync(receiptFile.path)) {
                fs.unlinkSync(receiptFile.path);
            }
            throw new ApiError(404, 'Withdrawal not found');
        }

        if (withdrawal.status !== 'pending') {
            // Clean up uploaded file
            if (receiptFile && fs.existsSync(receiptFile.path)) {
                fs.unlinkSync(receiptFile.path);
            }
            throw new ApiError(400, `Withdrawal already ${withdrawal.status}`);
        }

        // Save receipt path
        const receiptPath = `/uploads/withdrawals/receipts/${receiptFile.filename}`;

        // Update withdrawal status
        withdrawal.status = 'completed';
        withdrawal.processedAt = new Date();
        withdrawal.transactionId = transactionId || null;
        withdrawal.adminNotes = notes || null;
        withdrawal.receiptImage = receiptPath;
        withdrawal.receiptFileName = receiptFile.originalname;
        await withdrawal.save({ session });

        // Activity Log
        await createActivityLog({
            userId: req.user._id,
            action: 'WITHDRAWAL_APPROVED',
            entityType: 'Withdrawal',
            entityId: withdrawal._id,
            details: { amount: withdrawal.requestedAmount, transactionId },
            req
        });

        // Update provider wallet totals
        const providerWallet = await Wallet.findOne({ userId: withdrawal.providerId, role: 'provider' }).session(session);
        if (providerWallet) {
            providerWallet.totalWithdrawn =
                Number(providerWallet.totalWithdrawn || 0) +
                Number(withdrawal.requestedAmount); await providerWallet.save({ session });
        }

        await session.commitTransaction();


        // 🔹 Get provider
        const provider = await Provider.findById(withdrawal.providerId).populate('userId');

        // 🔹 Generate PDF
        const { filePath, fileName, url } = await generateWithdrawalInvoice(withdrawal, provider);

        // 🔹 Save invoice URL (optional)
        withdrawal.invoiceUrl = url;
        await withdrawal.save();

        await sendWithdrawalApprovedEmail(provider.userId.email, {
            amount: withdrawal.requestedAmount,
            transactionId: withdrawal.transactionId,
            fileName,
            filePath
        });

        if (provider) {
            await createNotification({
                userId: provider.userId._id,
                title: 'Withdrawal Approved',
                message: `Your withdrawal of BDT ${withdrawal.requestedAmount} has been approved and processed. Transaction ID: ${transactionId || 'N/A'}`,
                type: 'withdrawal',
                referenceId: withdrawal._id,
                metadata: {
                    withdrawalId: withdrawal._id,
                    amount: withdrawal.requestedAmount,
                    receiptUrl: receiptPath
                }
            });
        }

        return res.status(200).json(
            new ApiResponse(200, {
                withdrawal: {
                    ...withdrawal.toObject(),
                    receiptUrl: `${process.env.BASE_URL}${receiptPath}`
                }
            }, 'Withdrawal approved successfully')
        );
    } catch (error) {
        await session.abortTransaction();

        // Clean up uploaded file on error
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }

        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }
        return res.status(500).json(new ApiResponse(500, null, error.message));
    } finally {
        session.endSession();
    }
};

// Reject withdrawal
export const rejectWithdrawal = async (req, res) => {
    const session = await mongoose.startSession();
    let transactionCommitted = false;

    try {
        const { withdrawalId } = req.params;
        const { reason } = req.body;

        if (!mongoose.Types.ObjectId.isValid(withdrawalId)) {
            throw new ApiError(400, 'Invalid withdrawal ID');
        }

        if (!reason) {
            throw new ApiError(400, 'Rejection reason is required');
        }

        session.startTransaction();

        const withdrawal = await Withdrawal.findById(withdrawalId).session(session);
        if (!withdrawal) {
            throw new ApiError(404, 'Withdrawal not found');
        }

        if (withdrawal.status !== 'pending') {
            throw new ApiError(400, `Withdrawal already ${withdrawal.status}`);
        }

        // 🔹 Refund wallet
        const providerWallet = await Wallet.findOne({
            userId: withdrawal.providerId,
            role: 'provider',
        }).session(session);

        if (providerWallet) {
            providerWallet.balance += withdrawal.requestedAmount;
            await providerWallet.save({ session });
        }

        // 🔹 Update withdrawal
        withdrawal.status = 'rejected';
        withdrawal.rejectedAt = new Date();
        withdrawal.rejectionReason = reason;
        await withdrawal.save({ session });

        // 🔹 Commit FIRST
        await session.commitTransaction();
        transactionCommitted = true;

        // =========================
        // 🔔 SIDE EFFECTS (SAFE)
        // =========================

        // 🔹 Activity Log (safe)
        try {
            await createActivityLog({
                userId: req.user._id,
                action: 'WITHDRAWAL_REJECTED',
                entityType: 'Withdrawal',
                entityId: withdrawal._id,
                details: {
                    amount: withdrawal.requestedAmount,
                    reason,
                },
                req,
            });
        } catch (err) {
            console.error('Activity log failed:', err.message);
        }

        // 🔹 Notification (safe)
        try {
            const provider = await Provider.findById(withdrawal.providerId).populate('userId');

            if (provider) {
                await createNotification({
                    userId: provider.userId._id,
                    title: 'Withdrawal Rejected',
                    message: `Your withdrawal request of ${withdrawal.requestedAmount} was rejected. Reason: ${reason}. Amount returned to wallet.`,
                    type: 'withdrawal',
                    referenceId: withdrawal._id,
                    metadata: {
                        withdrawalId: withdrawal._id,
                        amount: withdrawal.requestedAmount,
                        reason,
                    },
                });
            }
        } catch (err) {
            console.error('Notification failed:', err.message);
        }

        return res.status(200).json(
            new ApiResponse(200, withdrawal, 'Withdrawal rejected successfully')
        );
    } catch (error) {
        if (!transactionCommitted) {
            await session.abortTransaction();
        }

        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || 'Internal server error',
        });
    } finally {
        session.endSession();
    }
};

// Get withdrawal receipt
export const getWithdrawalReceipt = async (req, res) => {
    try {
        const { withdrawalId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(withdrawalId)) {
            throw new ApiError(400, 'Invalid withdrawal ID');
        }

        const withdrawal = await Withdrawal.findById(withdrawalId);
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