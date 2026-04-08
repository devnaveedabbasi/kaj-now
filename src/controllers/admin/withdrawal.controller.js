import mongoose from 'mongoose';
import { Withdrawal } from '../../models/Withdrawal.model.js';
import { Wallet } from '../../models/Wallet.model.js';

/**
 * Get all withdrawal requests
 */
export async function getAllWithdrawals(req, res) {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const query = {};
    if (status) {
      query.status = status;
    }

    const withdrawals = await Withdrawal.find(query)
      .populate('userId', 'name email phone')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Withdrawal.countDocuments(query);

    return res.json({
      success: true,
      data: {
        withdrawals: withdrawals.map(w => ({
          _id: w._id,
          user: {
            _id: w.userId._id,
            name: w.userId.name,
            email: w.userId.email,
            phone: w.userId.phone,
          },
          amount: w.amount,
          status: w.status,
          paymentMethod: w.paymentMethod,
          adminNotes: w.adminNotes,
          processedAt: w.processedAt,
          completedAt: w.completedAt,
          rejectionReason: w.rejectionReason,
          createdAt: w.createdAt,
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        }
      },
    });
  } catch (err) {
    console.error('getAllWithdrawals:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to load withdrawals.' });
  }
}

/**
 * Process withdrawal request (mark as processing)
 */
export async function processWithdrawal(req, res) {
  try {
    const { withdrawalId } = req.params;
    // const { adminNotes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(withdrawalId)) {
      return res.status(400).json({ success: false, message: 'Invalid withdrawal ID.' });
    }

    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
    }

    if (withdrawal.status !== 'pending') {
      return res.status(400).json({ success: false, message: 'Withdrawal request is not in pending status.' });
    }

    withdrawal.status = 'processing';
    // withdrawal.processedAt = new Date();
    // if (adminNotes) {
    //   withdrawal.adminNotes = adminNotes;
    // }else{
    //   withdrawal.adminNotes = 'Withdrawal request is being processed.';
    // }
    withdrawal.adminNotes = 'Withdrawal request is being processed.';
    await withdrawal.save();

    return res.json({
      success: true,
      message: 'Withdrawal request marked as processing.',
      data: {
        withdrawal: {
          _id: withdrawal._id,
          status: withdrawal.status,
          processedAt: withdrawal.processedAt,
          adminNotes: withdrawal.adminNotes,
        }
      },
    });
  } catch (err) {
    console.error('processWithdrawal:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to process withdrawal.' });
  }
}

/**
 * Complete withdrawal request
 */
export async function completeWithdrawal(req, res) {
  try {
    const { withdrawalId } = req.params;
    const { adminNotes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(withdrawalId)) {
      return res.status(400).json({ success: false, message: 'Invalid withdrawal ID.' });
    }

    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
    }

    if (withdrawal.status !== 'processing') {
      return res.status(400).json({ success: false, message: 'Withdrawal request must be in processing status.' });
    }

    withdrawal.status = 'completed';
    withdrawal.completedAt = new Date();
    if (adminNotes) {
      withdrawal.adminNotes = adminNotes;
    }
    await withdrawal.save();

    return res.json({
      success: true,
      message: 'Withdrawal request completed successfully.',
      data: {
        withdrawal: {
          _id: withdrawal._id,
          status: withdrawal.status,
          completedAt: withdrawal.completedAt,
          adminNotes: withdrawal.adminNotes,
        }
      },
    });
  } catch (err) {
    console.error('completeWithdrawal:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to complete withdrawal.' });
  }
}

/**
 * Reject withdrawal request
 */
export async function rejectWithdrawal(req, res) {
  try {
    const { withdrawalId } = req.params;
    const { rejectionReason, adminNotes } = req.body;

    if (!mongoose.Types.ObjectId.isValid(withdrawalId)) {
      return res.status(400).json({ success: false, message: 'Invalid withdrawal ID.' });
    }

    if (!rejectionReason) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required.' });
    }

    const withdrawal = await Withdrawal.findById(withdrawalId);
    if (!withdrawal) {
      return res.status(404).json({ success: false, message: 'Withdrawal request not found.' });
    }

    if (withdrawal.status !== 'pending' && withdrawal.status !== 'processing') {
      return res.status(400).json({ success: false, message: 'Withdrawal request cannot be rejected at this stage.' });
    }

    // Refund amount to wallet
    const wallet = await Wallet.findOneAndUpdate(
      { userId: withdrawal.userId },
      {
        $inc: { balance: withdrawal.amount },
        $push: {
          transactions: {
            type: 'credit',
            amount: withdrawal.amount,
            description: `Withdrawal rejected: ${rejectionReason}`,
            withdrawalId: withdrawal._id,
          }
        }
      },
      { upsert: true, new: true }
    );

    withdrawal.status = 'rejected';
    withdrawal.rejectionReason = rejectionReason;
    if (adminNotes) {
      withdrawal.adminNotes = adminNotes;
    }
    await withdrawal.save();

    return res.json({
      success: true,
      message: 'Withdrawal request rejected and amount refunded to wallet.',
      data: {
        withdrawal: {
          _id: withdrawal._id,
          status: withdrawal.status,
          rejectionReason: withdrawal.rejectionReason,
          adminNotes: withdrawal.adminNotes,
        },
        wallet: {
          balance: wallet.balance,
        }
      },
    });
  } catch (err) {
    console.error('rejectWithdrawal:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to reject withdrawal.' });
  }
}