// controllers/payment.controller.js
import mongoose from 'mongoose';
import Payment from '../models/payment.model.js';
import Job from '../models/job.model.js';
import Wallet from '../models/wallet.model.js';
import User from '../models/User.model.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { ApiError } from '../utils/errorHandler.js';
import { validateSSLCommerzPayment } from '../utils/sslcommerz.js';
 
export async function paymentSuccess(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { tran_id, val_id } = req.query;

    // Validate payment with SSLCommerz
    const validation = await validateSSLCommerzPayment(val_id, null);
    
    if (validation.status !== 'VALID') {
      return res.redirect(`${process.env.FRONTEND_URL}/payment/failed?transaction=${tran_id}`);
    }

    // Find payment record
    const payment = await Payment.findOne({ sslCommerzTransactionId: tran_id }).session(session);
    if (!payment) {
      return res.redirect(`${process.env.FRONTEND_URL}/payment/not-found`);
    }

    // Update payment status to completed
    payment.paymentStatus = 'completed';
    payment.escrowStatus = 'held_in_admin_wallet';
    payment.sslCommerzValidation = true;
    await payment.save({ session });

    // Update job to show payment is held in escrow
    const job = await Job.findById(payment.jobId).session(session);
    if (job) {
      job.paymentStatus = 'held_in_escrow';
      await job.save({ session });
    }

    await session.commitTransaction();

    // Redirect to success page
    return res.redirect(`${process.env.FRONTEND_URL}/payment/success?job=${job._id}`);

  } catch (error) {
    await session.abortTransaction();
    console.error('Payment success error:', error);
    return res.redirect(`${process.env.FRONTEND_URL}/payment/error`);
  } finally {
    session.endSession();
  }
}

// ====================================================
// PAYMENT FAILED (From SSLCommerz)
// ====================================================
export async function paymentFailed(req, res) {
  try {
    const { tran_id } = req.query;

    // Find and mark payment as failed
    const payment = await Payment.findOne({ sslCommerzTransactionId: tran_id });
    if (payment) {
      payment.paymentStatus = 'failed';
      await payment.save();

      // Update job status
      const job = await Job.findById(payment.jobId);
      if (job) {
        job.status = 'pending'; // Keep pending for retry
        job.paymentStatus = 'pending';
        await job.save();
      }
    }

    return res.redirect(`${process.env.FRONTEND_URL}/payment/failed?transaction=${tran_id}`);
  } catch (error) {
    console.error('Payment failed error:', error);
    return res.redirect(`${process.env.FRONTEND_URL}/payment/error`);
  }
}

// ====================================================
// PAYMENT HISTORY
// ====================================================
export async function getPaymentHistory(req, res) {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 10, status } = req.query;

    let query = {};
    
    if (req.user.role === 'customer') {
      query.customerId = userId;
    } else if (req.user.role === 'provider') {
      query.providerId = userId;
    }

    if (status) {
      query.paymentStatus = status;
    }

    const skip = (page - 1) * limit;

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate('jobId', 'service amount status')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Payment.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limit);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          payments,
          pagination: {
            total,
            page: parseInt(page),
            limit: parseInt(limit),
            totalPages,
          },
        },
        'Payment history retrieved successfully'
      )
    );
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
}

// ====================================================
// GET PAYMENT DETAILS
// ====================================================
export async function getPaymentDetails(req, res) {
  try {
    const { paymentId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      throw new ApiError(400, 'Invalid payment ID');
    }

    const payment = await Payment.findById(paymentId)
      .populate('jobId')
      .populate('customerId', 'name email phone')
      .populate('providerId', 'name email phone');

    if (!payment) {
      throw new ApiError(404, 'Payment not found');
    }

    // Authorization check
    if (
      payment.customerId._id.toString() !== userId.toString() &&
      payment.providerId._id.toString() !== userId.toString() &&
      req.user.role !== 'admin'
    ) {
      throw new ApiError(403, 'Not authorized to view this payment');
    }

    return res.status(200).json(
      new ApiResponse(200, payment, 'Payment details retrieved successfully')
    );
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
}


export async function refundPayment(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { paymentId } = req.params;
    const { reason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(paymentId)) {
      throw new ApiError(400, 'Invalid payment ID');
    }

    // Only admin can initiate refunds
    if (req.user.role !== 'admin') {
      throw new ApiError(403, 'Only admin can refund payments');
    }

    const payment = await Payment.findById(paymentId).session(session);
    if (!payment) throw new ApiError(404, 'Payment not found');

    // Can only refund payments in escrow
    if (payment.escrowStatus !== 'held_in_admin_wallet') {
      throw new ApiError(400, 'Payment cannot be refunded in current state');
    }

    // Update payment
    payment.paymentStatus = 'refunded';
    payment.escrowStatus = 'refunded_to_customer';
    payment.refundReason = reason || 'Admin refund';
    payment.refundedAt = new Date();
    await payment.save({ session });

    // Deduct from admin wallet
    const admin = await User.findOne({ role: 'admin' }).session(session);
    const adminWallet = await Wallet.findOne({
      userId: admin._id,
      role: 'admin',
    }).session(session);

    if (adminWallet) {
      adminWallet.balance -= payment.totalAmount;
      adminWallet.totalEarnings -= payment.totalAmount;
      await adminWallet.save({ session });
    }

    // Update job
    const job = await Job.findById(payment.jobId).session(session);
    if (job) {
      job.status = 'cancelled';
      job.paymentStatus = 'refunded_to_customer';
      await job.save({ session });
    }

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: 'Payment refunded successfully to customer',
      data: {
        paymentId: payment._id,
        refundAmount: payment.totalAmount,
        refundReason: payment.refundReason,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  } finally {
    session.endSession();
  }
}

// ====================================================
// GET PAYMENT SUMMARY (Admin)
// ====================================================
export async function getPaymentSummary(req, res) {
  try {
    // Only admin can access
    if (req.user.role !== 'admin') {
      throw new ApiError(403, 'Only admin can access payment summary');
    }

    const totalPayments = await Payment.countDocuments();
    const completedPayments = await Payment.countDocuments({ paymentStatus: 'completed' });
    const refundedPayments = await Payment.countDocuments({ paymentStatus: 'refunded' });
    const failedPayments = await Payment.countDocuments({ paymentStatus: 'failed' });

    const totalRevenue = await Payment.aggregate([
      { $match: { paymentStatus: 'completed', escrowStatus: 'released_to_provider' } },
      { $group: { _id: null, total: { $sum: '$platformFee' } } },
    ]);

    const inEscrow = await Payment.aggregate([
      { $match: { escrowStatus: 'held_in_admin_wallet' } },
      { $group: { _id: null, total: { $sum: '$totalAmount' } } },
    ]);

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          totalPayments,
          completedPayments,
          refundedPayments,
          failedPayments,
          totalPlatformFeeEarned: totalRevenue[0]?.total || 0,
          totalInEscrow: inEscrow[0]?.total || 0,
        },
        'Payment summary retrieved successfully'
      )
    );
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
}