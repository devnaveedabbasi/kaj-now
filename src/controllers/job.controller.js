// controllers/job.controller.js
import mongoose from 'mongoose';
import Job from '../models/job.model.js';
import Payment from '../models/payment.model.js';
import Wallet from '../models/wallet.model.js';
import Provider from '../models/provider/Provider.model.js';
import User from '../models/User.model.js';
import Service from '../models/admin/service.model.js';
import ServiceRequest from '../models/admin/serviceRequest.model.js';
import { ApiError } from '../utils/errorHandler.js';
import { processSSLCommerzPayment } from '../utils/sslcommerz.js';

const PLATFORM_FEE_PERCENTAGE = 0.10; // 10% platform fee


export async function bookJob(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user._id;
    const { serviceId, providerId, cardDetails } = req.body;

    if (!serviceId || !providerId) {
      throw new ApiError(400, 'serviceId & providerId required');
    }

    if (
      !cardDetails?.cardNumber ||
      !cardDetails?.expiryDate ||
      !cardDetails?.cvv ||
      !cardDetails?.cardHolderName
    ) {
      throw new ApiError(400, 'Complete card details required');
    }

    if (cardDetails.cardNumber.length < 13 || cardDetails.cardNumber.length > 19) {
      throw new ApiError(400, 'Invalid card number');
    }

    if (cardDetails.cvv.length < 3 || cardDetails.cvv.length > 4) {
      throw new ApiError(400, 'Invalid CVV');
    }

    const user = await User.findById(userId).session(session);
    if (!user) throw new ApiError(404, 'User not found');

    const service = await Service.findById(serviceId).session(session);
    if (!service || !service.isActive) {
      throw new ApiError(404, 'Service not available');
    }

    const provider = await Provider.findById(providerId).session(session);
    if (!provider) throw new ApiError(404, 'Provider not found');

    const serviceRequest = await ServiceRequest.findOne({
      serviceId,
      providerId,
      status: 'approved',
    });

    if (!serviceRequest) {
      throw new ApiError(400, 'Provider not approved for this service');
    }

    const existingJob = await Job.findOne({
      customer: userId,
      service: serviceId,
      provider: providerId,
      status: { $in: ['pending', 'accepted', 'in_progress'] },
    });

    if (existingJob) {
      throw new ApiError(400, 'Already have active booking');
    }

    const servicePrice = service.price;
    const platformFee = servicePrice * PLATFORM_FEE_PERCENTAGE;
    const providerAmount = servicePrice - platformFee;

    const job = await Job.create(
      [
        {
          provider: provider._id,
          customer: user._id,
          service: serviceId,
          amount: servicePrice,
          status: 'pending',
          paymentStatus: 'pending',
        },
      ],
      { session }
    );

    const payment = await Payment.create(
      [
        {
          jobId: job[0]._id,
          customerId: user._id,
          providerId: provider._id,
          servicePrice,
          platformFee,
          totalAmount: servicePrice,
          providerAmount,
          paymentGateway: 'sslcommerz',
          paymentStatus: 'pending',
          escrowStatus: 'pending',
        },
      ],
      { session }
    );

    const paymentData = {
      total_amount: servicePrice,
      currency: 'BDT',
      tran_id: `JOB_${job[0]._id}_${Date.now()}`,
      success_url: `${process.env.BASE_URL}/api/payments/success`,
      fail_url: `${process.env.BASE_URL}/api/payments/fail`,
      cancel_url: `${process.env.BASE_URL}/api/payments/cancel`,
      ipn_url: `${process.env.BASE_URL}/api/payments/ipn`,
      cus_name: user.name,
      cus_email: user.email,
      cus_phone: user.phone,
      cus_add1: user.location?.locationName || 'Dhaka',
      shipping_method: 'NO',
      product_name: service.name,
      product_category: 'Service',
      product_profile: 'general',
    };

    const sslResponse = await processSSLCommerzPayment(paymentData, cardDetails);

    if (!sslResponse || sslResponse.status !== 'SUCCESS') {
      throw new ApiError(400, 'Payment failed from gateway');
    }

    payment[0].paymentStatus = 'completed';
    payment[0].escrowStatus = 'held_in_admin_wallet';
    payment[0].sslCommerzTransactionId = paymentData.tran_id;
    payment[0].sslCommerzReference = sslResponse.sessionkey;
    await payment[0].save({ session });

    job[0].paymentStatus = 'held_in_escrow';
    await job[0].save({ session });

    const adminUser = await User.findOne({ role: 'admin' }).session(session);
    if (!adminUser) throw new ApiError(500, 'Admin not found');

    let adminWallet = await Wallet.findOne({
      userId: adminUser._id,
      role: 'admin',
    }).session(session);

    if (!adminWallet) {
      adminWallet = (
        await Wallet.create(
          [
            {
              userId: adminUser._id,
              role: 'admin',
              balance: 0,
              totalEarnings: 0,
              totalPlatformFees: 0,
              isActive: true,
            },
          ],
          { session }
        )
      )[0];
    }

    // Payment held in admin wallet (escrow)
    adminWallet.balance += servicePrice;
    adminWallet.totalEarnings += servicePrice;
    adminWallet.transactionHistory.push(payment[0]._id);
    await adminWallet.save({ session });

    await session.commitTransaction();

    return res.status(201).json({
      success: true,
      message: 'Job booked successfully.',
      data: {
        job: job[0],
        payment: payment[0],
        gatewayUrl: sslResponse.GatewayPageURL,
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


export async function acceptJob(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { jobId } = req.params;
const providerId = req.body.providerId;
  console.log('Accepting job:', jobId, 'by provider:', providerId);
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new ApiError(400, 'Invalid job ID');
    }

    const job = await Job.findById(jobId).session(session);
    if (!job) throw new ApiError(404, 'Job not found');
console.log('Job found:', job);
     if (job.provider.toString() !== providerId) {
      throw new ApiError(403, 'Not authorized to accept this job');
    }

    if (job.status !== 'pending') {
      throw new ApiError(400, `Job status must be pending, current status: ${job.status}`);
    }

    job.status = 'accepted';
    job.acceptedAt = new Date();
    await job.save({ session });

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: 'Job accepted successfully',
      data: job,
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


export async function rejectJob(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { jobId } = req.params;
    const { reason } = req.body;
const providerId = req.body.providerId;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new ApiError(400, 'Invalid job ID');
    }

    const job = await Job.findById(jobId).session(session);
    if (!job) throw new ApiError(404, 'Job not found');

    if (job.provider.toString() !== providerId.toString()) {
      throw new ApiError(403, 'Not authorized to reject this job');
    }

    if (!['pending', 'accepted'].includes(job.status)) {
      throw new ApiError(400, `Cannot reject job with status: ${job.status}`);
    }

    const payment = await Payment.findOne({ jobId: jobId }).session(session);
    if (!payment) throw new ApiError(404, 'Payment record not found');

    if (payment.escrowStatus !== 'held_in_admin_wallet') {
      throw new ApiError(400, 'Payment is not in escrow');
    }

    // ================= REFUND FULL AMOUNT TO CUSTOMER =================
    const customer = await User.findById(payment.customerId).session(session);
    if (!customer) throw new ApiError(404, 'Customer not found');


    payment.paymentStatus = 'refunded';
    payment.escrowStatus = 'refunded_to_customer';
    payment.refundReason = 'provider_rejected';
    payment.refundedAt = new Date();
    await payment.save({ session });

    // ================= REMOVE PAYMENT FROM ADMIN WALLET =================
    const adminUser = await User.findOne({ role: 'admin' }).session(session);
    const adminWallet = await Wallet.findOne({
      userId: adminUser._id,
      role: 'admin',
    }).session(session);

    if (adminWallet) {
      // Deduct the full amount from admin wallet (it was released)
      adminWallet.balance -= payment.totalAmount;
      adminWallet.totalEarnings -= payment.totalAmount;
      await adminWallet.save({ session });
    }

    // ================= UPDATE JOB =================
    job.status = 'rejected_by_provider';
    job.rejectionReason = reason || 'Provider rejected booking';
    job.rejectionRejectedAt = new Date();
    job.paymentStatus = 'refunded_to_customer';
    await job.save({ session });

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: 'Job rejected successfully. Full refund will be processed to customer.',
      data: {
        job,
        payment,
        refundAmount: payment.totalAmount,
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

export async function startJob(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { jobId } = req.params;
const providerId = req.body.providerId;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new ApiError(400, 'Invalid job ID');
    }

    const job = await Job.findById(jobId).session(session);
    if (!job) throw new ApiError(404, 'Job not found');

    if (job.provider.toString() !== providerId.toString()) {
      throw new ApiError(403, 'Not authorized to start this job');
    }

    if (job.status !== 'accepted') {
      throw new ApiError(400, `Job must be accepted first. Current status: ${job.status}`);
    }

    job.status = 'in_progress';
    job.startedAt = new Date();
    await job.save({ session });

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: 'Job started successfully',
      data: job,
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


export async function markCompletedByProvider(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { jobId } = req.params;
const providerId = req.body.providerId;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new ApiError(400, 'Invalid job ID');
    }

    const job = await Job.findById(jobId).session(session);
    if (!job) throw new ApiError(404, 'Job not found');

    if (job.provider.toString() !== providerId.toString()) {
      throw new ApiError(403, 'Not authorized to update this job');
    }

    if (!['accepted', 'in_progress'].includes(job.status)) {
      throw new ApiError(400, `Job must be accepted or in progress. Current status: ${job.status}`);
    }

    job.status = 'completed_by_provider';
    job.completedByProviderAt = new Date();
    await job.save({ session });

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: 'Job marked as completed. Awaiting customer confirmation.',
      data: job,
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

export async function confirmCompletionByCustomer(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { jobId } = req.params;
    const customerId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new ApiError(400, 'Invalid job ID');
    }

    const job = await Job.findById(jobId).session(session);
    if (!job) throw new ApiError(404, 'Job not found');

    if (job.customer.toString() !== customerId.toString()) {
      throw new ApiError(403, 'Not authorized to confirm this job');
    }

    if (job.status !== 'completed_by_provider') {
      throw new ApiError(400, `Job must be completed by provider first. Current status: ${job.status}`);
    }

    const payment = await Payment.findOne({ jobId: jobId }).session(session);
    if (!payment) throw new ApiError(404, 'Payment record not found');

    if (payment.escrowStatus !== 'held_in_admin_wallet') {
      throw new ApiError(400, 'Payment is not in escrow');
    }

    const adminUser = await User.findOne({ role: 'admin' }).session(session);
    if (!adminUser) throw new ApiError(500, 'Admin not found');

    const adminWallet = await Wallet.findOne({
      userId: adminUser._id,
      role: 'admin',
    }).session(session);

    if (!adminWallet) throw new ApiError(500, 'Admin wallet not found');

    if (adminWallet.balance < payment.totalAmount) {
      throw new ApiError(400, 'Insufficient balance in admin wallet');
    }

    // 2. Get or create provider wallet
    let providerWallet = await Wallet.findOne({
      userId: payment.providerId,
      role: 'provider',
    }).session(session);

    if (!providerWallet) {
      providerWallet = (
        await Wallet.create(
          [
            {
              userId: payment.providerId,
              role: 'provider',
              balance: 0,
              totalEarnings: 0,
              totalWithdrawn: 0,
              totalPlatformFees: 0,
              isActive: true,
            },
          ],
          { session }
        )
      )[0];
    }

    // 3. Deduct from admin wallet (escrow + platform fee)
    adminWallet.balance -= payment.totalAmount;
    // Platform fee stays with admin (already accounted for in totalEarnings)
    adminWallet.totalPlatformFees += payment.platformFee;
    await adminWallet.save({ session });

    // 4. Add provider amount (90%) to provider wallet
    providerWallet.balance += payment.providerAmount;
    providerWallet.totalEarnings += payment.providerAmount;
    providerWallet.transactionHistory.push(payment._id);
    await providerWallet.save({ session });

    payment.escrowStatus = 'released_to_provider';
    payment.releasedAt = new Date();
    await payment.save({ session });

    job.status = 'confirmed_by_user';
    job.confirmedByUserAt = new Date();
    job.paymentStatus = 'released_to_provider';
    await job.save({ session });

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: 'Job confirmed. Payment released to provider wallet.',
      data: {
        job,
        payment: {
          totalAmount: payment.totalAmount,
          platformFee: payment.platformFee,
          providerAmount: payment.providerAmount,
          status: 'released_to_provider',
        },
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


export async function rejectCompletion(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { jobId } = req.params;
    const { reason } = req.body;
    const customerId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new ApiError(400, 'Invalid job ID');
    }

    if (!reason) {
      throw new ApiError(400, 'Dispute reason is required');
    }

    const job = await Job.findById(jobId).session(session);
    if (!job) throw new ApiError(404, 'Job not found');

    if (job.customer.toString() !== customerId.toString()) {
      throw new ApiError(403, 'Not authorized to dispute this job');
    }

    if (job.status !== 'completed_by_provider') {
      throw new ApiError(400, `Cannot dispute job with status: ${job.status}`);
    }

    job.status = 'disputed';
    job.disputeReason = reason;
    job.disputedAt = new Date();
    await job.save({ session });

    await session.commitTransaction();

    return res.status(200).json({
      success: true,
      message: 'Dispute initiated. Admin will review and resolve.',
      data: job,
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


export async function getJobDetails(req, res) {
  try {
    const { jobId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new ApiError(400, 'Invalid job ID');
    }

    const job = await Job.findById(jobId)
.populate({
  path: 'provider',
  populate: {
    path: 'userId',
    select: 'name email phone'
  }
})      .populate('customer', 'name email phone')
      .populate('service', 'name price description');

    if (!job) throw new ApiError(404, 'Job not found');

    const payment = await Payment.findOne({ jobId: jobId });

    const jobDetails = {
      ...job.toObject(),
      payment: payment
        ? {
            id: payment._id,
            servicePrice: payment.servicePrice,
            platformFee: payment.platformFee,
            providerAmount: payment.providerAmount,
            totalAmount: payment.totalAmount,
            paymentStatus: payment.paymentStatus,
            escrowStatus: payment.escrowStatus,
            gateway: payment.paymentGateway,
            createdAt: payment.createdAt,
          }
        : null,
    };

    return res.status(200).json({
      success: true,
      data: jobDetails,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
}


export async function getProviderJobs(req, res) {
  try {
    const providerId = req.user._id;
    const { status, page = 1, limit = 10 } = req.query;

    let query = { provider: providerId };
    if (status) {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const [jobs, total] = await Promise.all([
      Job.find(query)
        .populate('customer', 'name phone email')
        .populate('service', 'name price')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Job.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      data: {
        jobs,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages,
        },
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
}


export async function getCustomerJobs(req, res) {
  try {
    const customerId = req.user._id;
    const { status, page = 1, limit = 10 } = req.query;

    let query = { customer: customerId };
    if (status) {
      query.status = status;
    }

    const skip = (page - 1) * limit;

    const [jobs, total] = await Promise.all([
      Job.find(query)
        .populate('provider', 'name phone email rating')
        .populate('service', 'name price')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Job.countDocuments(query),
    ]);

    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      data: {
        jobs,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages,
        },
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message,
    });
  }
}