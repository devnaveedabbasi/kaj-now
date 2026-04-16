
import mongoose from 'mongoose';
import Job from '../../models/job.model.js';
import Payment from '../../models/payment.model.js';
import Wallet from '../../models/wallet.model.js';
import Provider from '../../models/provider/Provider.model.js';
import User from '../../models/User.model.js';
import Service from '../../models/admin/service.model.js';
import ServiceRequest from '../../models/admin/serviceRequest.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { processSSLCommerzPayment } from '../../utils/sslcommerz.js';
import { createNotification } from '../../utils/createNotification.js';



export async function getProviderJobs(req, res) {
  try {
    const providerId = req.user._id;
    const { status, page = 1, limit = 10 } = req.query;

    let query = { provider: providerId };
    if (status) query.status = status;

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

    return res.status(200).json({
      success: true,
      data: { jobs, pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / limit) } },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
}


export async function getJobDetails(req, res) {
  try {
    const { jobId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(jobId)) throw new ApiError(400, 'Invalid job ID');

    const job = await Job.findById(jobId)
      .populate({ path: 'provider', populate: { path: 'userId', select: 'name email phone' } })
      .populate('customer', 'name email phone')
      .populate('service', 'name price description');

    if (!job) throw new ApiError(404, 'Job not found');

    const payment = await Payment.findOne({ jobId });

    return res.status(200).json({
      success: true,
      data: {
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
      },
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
}


export async function startJob(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { jobId } = req.params;
    const providerId = req.body.providerId || req.user?._id;

    if (!mongoose.Types.ObjectId.isValid(jobId)) throw new ApiError(400, 'Invalid job ID');

    const job = await Job.findById(jobId).populate('service', 'name').session(session);
    if (!job) throw new ApiError(404, 'Job not found');

    if (job.provider.toString() !== providerId.toString()) {
      throw new ApiError(403, 'Not authorized to start this job');
    }

    if (job.status !== 'accepted') {
      throw new ApiError(400, `Job must be accepted first. Current: ${job.status}`);
    }

    job.status = 'in_progress';
    job.startedAt = new Date();
    await job.save({ session });

    await session.commitTransaction();

    // ── Notifications ────────────────────────────────────────────────────────
    await createNotification({
      userId: job.customer,
      title: 'Job Started',
      message: `Your service "${job.service?.name || 'service'}" (Order #${job.orderId}) has been started by the provider.`,
      type: 'booking',
      referenceId: job._id,
      metadata: { orderId: job.orderId, jobId: job._id },
    });

    return res.status(200).json({ success: true, message: 'Job started successfully', data: job });
  } catch (error) {
    await session.abortTransaction();
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
}


export async function markCompletedByProvider(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { jobId } = req.params;
    const providerId = req.body.providerId || req.user?._id;

    if (!mongoose.Types.ObjectId.isValid(jobId)) throw new ApiError(400, 'Invalid job ID');

    const job = await Job.findById(jobId).populate('service', 'name').session(session);
    if (!job) throw new ApiError(404, 'Job not found');

    if (job.provider.toString() !== providerId.toString()) {
      throw new ApiError(403, 'Not authorized to update this job');
    }

    if (!['accepted', 'in_progress'].includes(job.status)) {
      throw new ApiError(400, `Job must be accepted or in progress. Current: ${job.status}`);
    }

    job.status = 'completed_by_provider';
    job.completedByProviderAt = new Date();
    await job.save({ session });

    await session.commitTransaction();

    // ── Notifications ────────────────────────────────────────────────────────
    await createNotification({
      userId: job.customer,
      title: 'Service Completed — Please Confirm',
      message: `The provider has marked "${job.service?.name || 'your service'}" (Order #${job.orderId}) as completed. Please confirm or raise a dispute.`,
      type: 'booking',
      referenceId: job._id,
      metadata: { orderId: job.orderId, jobId: job._id },
    });

    return res.status(200).json({
      success: true,
      message: 'Job marked as completed. Awaiting customer confirmation.',
      data: job,
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
}
