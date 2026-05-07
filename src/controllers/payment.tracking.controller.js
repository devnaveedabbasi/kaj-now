import Payment from '../models/payment.model.js';
import Job from '../models/job.model.js';
import User from '../models/User.model.js';
import Wallet from '../models/wallet.model.js';
import { ApiError } from '../utils/errorHandler.js';
import { ApiResponse } from '../utils/apiResponse.js';

/**
 * Get single payment with full tracking details
 * Shows customer, provider, job, refund status, timeline
 */
export const getPaymentTracking = async (req, res) => {
  try {
    const { paymentId } = req.params;

    const payment = await Payment.findById(paymentId)
      .populate({
        path: 'customerId',
        select: 'name email phone role'
      })
      .populate({
        path: 'providerId',
        select: 'userId'
      })
      .populate({
        path: 'jobId',
        select: 'orderId status amount service schedule acceptedAt completedByProviderAt cancelledAt'
      })
      .lean();

    if (!payment) {
      throw new ApiError(404, 'Payment not found');
    }

    // Get provider user details (since providerId is Provider, we need to get the User through userId)
    let providerUser = null;
    if (payment.providerId?.userId) {
      providerUser = await User.findById(payment.providerId.userId).select('name email phone').lean();
    }

    // Format timeline based on payment status
    const timeline = [];
    
    timeline.push({
      status: 'created',
      timestamp: payment.createdAt,
      label: 'Payment Created',
      description: `BDT ${payment.totalAmount} booking initiated`
    });

    if (payment.paymentStatus === 'completed' || payment.paymentStatus === 'refunded') {
      timeline.push({
        status: 'payment_completed',
        timestamp: payment.updatedAt,
        label: 'Payment Processed',
        description: `Payment confirmed by ${payment.paymentGateway}`
      });
    }

    if (payment.escrowStatus === 'held_in_admin_wallet') {
      timeline.push({
        status: 'held_in_escrow',
        timestamp: payment.updatedAt,
        label: 'Held in Admin Wallet',
        description: `BDT ${payment.totalAmount} held until service completion`
      });
    }

    if (payment.escrowStatus === 'released_to_provider') {
      timeline.push({
        status: 'released_to_provider',
        timestamp: payment.releasedAt || payment.updatedAt,
        label: 'Released to Provider',
        description: `BDT ${payment.providerAmount} released to provider wallet. Admin fee: BDT ${payment.platformFee}`
      });
    }

    if (payment.paymentStatus === 'refunded') {
      timeline.push({
        status: 'refunded',
        timestamp: payment.refundedAt,
        label: 'Refunded to Customer',
        description: `BDT ${payment.totalAmount} refunded. Reason: ${payment.refundReason}`
      });
    }

    return res.status(200).json(
      new ApiResponse(200, {
        payment: {
          _id: payment._id,
          orderId: payment.jobId?.orderId,
          status: payment.paymentStatus,
          escrowStatus: payment.escrowStatus,
          amount: payment.totalAmount,
          servicePrice: payment.servicePrice,
          platformFee: payment.platformFee,
          providerAmount: payment.providerAmount,
          paymentGateway: payment.paymentGateway,
          refundReason: payment.refundReason,
          refundedAt: payment.refundedAt,
          createdAt: payment.createdAt,
        },
        customer: {
          _id: payment.customerId._id,
          name: payment.customerId.name,
          email: payment.customerId.email,
          phone: payment.customerId.phone,
          role: payment.customerId.role
        },
        provider: providerUser ? {
          _id: payment.providerId._id,
          name: providerUser.name,
          email: providerUser.email,
          phone: providerUser.phone,
        } : null,
        job: payment.jobId ? {
          _id: payment.jobId._id,
          orderId: payment.jobId.orderId,
          status: payment.jobId.status,
          schedule: payment.jobId.schedule,
          acceptedAt: payment.jobId.acceptedAt,
          completedByProviderAt: payment.jobId.completedByProviderAt,
          cancelledAt: payment.jobId.cancelledAt,
        } : null,
        timeline
      }, 'Payment tracking details retrieved')
    );
  } catch (error) {
    console.error('Error getting payment tracking:', error);
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
    }
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};

/**
 * Get all payments for a customer with refund status
 */
export const getCustomerPaymentHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { status } = req.query; // completed, refunded, all

    let query = { customerId: userId };

    if (status && status !== 'all') {
      query.paymentStatus = status;
    }

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate({
          path: 'jobId',
          select: 'orderId status amount service'
        })
        .populate({
          path: 'providerId',
          select: 'name email'
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Payment.countDocuments(query)
    ]);

    const formattedPayments = payments.map(payment => ({
      _id: payment._id,
      orderId: payment.jobId?.orderId || 'N/A',
      amount: payment.totalAmount,
      platformFee: payment.platformFee,
      status: payment.paymentStatus,
      isRefunded: payment.paymentStatus === 'refunded',
      refundReason: payment.refundReason,
      refundedAt: payment.refundedAt,
      providerName: payment.providerId?.name || 'N/A',
      createdAt: payment.createdAt,
      jobId: payment.jobId?._id
    }));

    return res.status(200).json(
      new ApiResponse(200, {
        payments: formattedPayments,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
        }
      }, 'Customer payment history retrieved')
    );
  } catch (error) {
    console.error('Error getting customer payment history:', error);
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};

/**
 * Get all payments for admin (with filtering)
 */
export const getAllPaymentsAdmin = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    const { status, escrowStatus, startDate, endDate } = req.query;

    let query = {};

    if (status) {
      query.paymentStatus = status;
    }

    if (escrowStatus) {
      query.escrowStatus = escrowStatus;
    }

    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const [payments, total] = await Promise.all([
      Payment.find(query)
        .populate({
          path: 'customerId',
          select: 'name email'
        })
        .populate({
          path: 'providerId',
          select: 'name email'
        })
        .populate({
          path: 'jobId',
          select: 'orderId status'
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Payment.countDocuments(query)
    ]);

    const formattedPayments = payments.map(payment => ({
      _id: payment._id,
      orderId: payment.jobId?.orderId || 'N/A',
      customer: payment.customerId?.name || 'Unknown',
      provider: payment.providerId?.name || 'Unknown',
      amount: payment.totalAmount,
      platformFee: payment.platformFee,
      status: payment.paymentStatus,
      escrowStatus: payment.escrowStatus,
      isRefunded: payment.paymentStatus === 'refunded',
      refundReason: payment.refundReason,
      refundedAt: payment.refundedAt,
      createdAt: payment.createdAt
    }));

    // Calculate summary stats
    const stats = payments.reduce((acc, p) => ({
      totalAmount: acc.totalAmount + p.totalAmount,
      totalRefunded: acc.totalRefunded + (p.paymentStatus === 'refunded' ? p.totalAmount : 0),
      totalPlatformFee: acc.totalPlatformFee + p.platformFee,
      refundedCount: acc.refundedCount + (p.paymentStatus === 'refunded' ? 1 : 0),
      completedCount: acc.completedCount + (p.paymentStatus === 'completed' ? 1 : 0)
    }), {
      totalAmount: 0,
      totalRefunded: 0,
      totalPlatformFee: 0,
      refundedCount: 0,
      completedCount: 0
    });

    return res.status(200).json(
      new ApiResponse(200, {
        payments: formattedPayments,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
        },
        stats
      }, 'All payments retrieved')
    );
  } catch (error) {
    console.error('Error getting all payments:', error);
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};

/**
 * Get refund history (for audit trail)
 */
export const getRefundHistory = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [refunds, total] = await Promise.all([
      Payment.find({ paymentStatus: 'refunded' })
        .populate({
          path: 'customerId',
          select: 'name email'
        })
        .populate({
          path: 'providerId',
          select: 'name email'
        })
        .populate({
          path: 'jobId',
          select: 'orderId status'
        })
        .sort({ refundedAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Payment.countDocuments({ paymentStatus: 'refunded' })
    ]);

    const formattedRefunds = refunds.map(refund => ({
      _id: refund._id,
      orderId: refund.jobId?.orderId || 'N/A',
      customer: refund.customerId?.name || 'Unknown',
      provider: refund.providerId?.name || 'Unknown',
      amount: refund.totalAmount,
      platformFee: refund.platformFee,
      refundedAmount: refund.totalAmount - refund.platformFee,
      refundReason: refund.refundReason,
      refundedAt: refund.refundedAt,
      createdAt: refund.createdAt
    }));

    const totalRefundedAmount = refunds.reduce((sum, r) => sum + r.totalAmount, 0);

    return res.status(200).json(
      new ApiResponse(200, {
        refunds: formattedRefunds,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit
        },
        summary: {
          totalRefunds: total,
          totalRefundedAmount,
          averageRefundAmount: total > 0 ? (totalRefundedAmount / total).toFixed(2) : 0
        }
      }, 'Refund history retrieved')
    );
  } catch (error) {
    console.error('Error getting refund history:', error);
    return res.status(500).json(new ApiResponse(500, null, error.message));
  }
};
