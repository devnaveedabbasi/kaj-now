
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
    const userId = req.user._id;
    const { status, page = 1, limit = 10 } = req.query;

    // Get provider
    const provider = await Provider.findOne({ userId });
    if (!provider) {
      throw new ApiError(404, 'Provider profile not found');
    }

    let query = { provider: provider._id };
    if (status) query.status = status;

    const skip = (page - 1) * limit;
    const [jobs, total] = await Promise.all([
      Job.find(query)
        .populate('customer', 'name phone email profilePicture')
        .populate('service', 'name price icon description averageRating') // Service details
        .populate({
          path: 'provider',
          populate: {
            path: 'userId',
            select: 'name email profilePicture phoneNumber'
          }
        })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Job.countDocuments(query),
    ]);

    // Format jobs with provider details
    const formattedJobs = jobs.map(job => ({
      _id: job._id,
      orderId: job.orderId,
      status: job.status,
      paymentStatus: job.paymentStatus,
      amount: job.amount,
      service: {
        _id: job.service?._id,
        name: job.service?.name,
        icon: job.service?.icon,
        price: job.service?.price,
        description: job.service?.description,
        averageRating: job.service?.averageRating || 0
      },
      customer: {
        _id: job.customer?._id,
        name: job.customer?.name,
        email: job.customer?.email,
        phone: job.customer?.phone,
        profilePicture: job.customer?.profilePicture
      },
      provider: {
        _id: job.provider?._id,
        name: job.provider?.userId?.name,
        email: job.provider?.userId?.email,
        phone: job.provider?.userId?.phoneNumber,
        profilePicture: job.provider?.userId?.profilePicture,
        location: job.provider?.location||job.provider?.userId?.location
      },
      timestamps: {
        createdAt: job.createdAt,
        acceptedAt: job.acceptedAt,
        startedAt: job.startedAt,
        completedByProviderAt: job.completedByProviderAt,
        confirmedByUserAt: job.confirmedByUserAt
      }
    }));

    // Get order counts
    const totalOrders = await Job.countDocuments({ provider: provider._id });
    const completedOrders = await Job.countDocuments({ 
      provider: provider._id, 
      status: 'confirmed_by_user' 
    });
    const pendingOrders = await Job.countDocuments({ 
      provider: provider._id, 
      status: 'pending' 
    });
    const inProgressOrders = await Job.countDocuments({
      provider: provider._id,
      status: 'in_progress'
    });

    return res.status(200).json({
      success: true,
      data: { 
        jobs: formattedJobs,
        stats: {
          totalOrders,
          completedOrders,
          pendingOrders,
          inProgressOrders,
          totalEarnings: completedOrders * 100 // Calculate properly
        },
        pagination: { 
          total, 
          page: parseInt(page), 
          limit: parseInt(limit), 
          totalPages: Math.ceil(total / limit) 
        } 
      },
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
      .populate({
        path: 'provider',
        populate: {
          path: 'userId',
          select: 'name email phone profilePicture location'
        }
      })
      .populate('customer', 'name email phone profilePicture location')
      .populate('service', 'name price description icon averageRating')
      .lean();
    
    if (!job) throw new ApiError(404, 'Job not found');

    const payment = await Payment.findOne({ jobId }).lean();

    // Format response with all details
    const formattedJob = {
      _id: job._id,
      orderId: job.orderId,
      status: job.status,
      paymentStatus: job.paymentStatus,
      amount: job.amount,
      service: {
        _id: job.service?._id,
        name: job.service?.name,
        icon: job.service?.icon,
        price: job.service?.price,
        description: job.service?.description,
        averageRating: job.service?.averageRating || 0
      },
      customer: {
        _id: job.customer?._id,
        name: job.customer?.name,
        email: job.customer?.email,
        phone: job.customer?.phone,
        profilePicture: job.customer?.profilePicture,
        location: job.customer?.location||null
      },
      provider: {
        _id: job.provider?._id,
        name: job.provider?.userId?.name,
        email: job.provider?.userId?.email,
        phone: job.provider?.userId?.phone,
        profilePicture: job.provider?.userId?.profilePicture,
        location: job.provider?.location||job.provider?.userId?.location
      },
      payment: payment ? {
        _id: payment._id,
        servicePrice: payment.servicePrice,
        platformFee: payment.platformFee,
        providerAmount: payment.providerAmount,
        totalAmount: payment.totalAmount,
        paymentStatus: payment.paymentStatus,
        escrowStatus: payment.escrowStatus,
        gateway: payment.paymentGateway,
        createdAt: payment.createdAt,
      } : null,
      timestamps: {
        createdAt: job.createdAt,
        acceptedAt: job.acceptedAt,
        startedAt: job.startedAt,
        completedByProviderAt: job.completedByProviderAt,
        confirmedByUserAt: job.confirmedByUserAt,
        disputedAt: job.disputedAt,
        cancelledAt: job.cancelledAt
      },
      rejectionReason: job.rejectionReason,
      disputeReason: job.disputeReason
    };

    return res.status(200).json({
      success: true,
      data: formattedJob,
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  }
}

export async function acceptJob(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { jobId } = req.params;
    const userId = req.user._id;  // Direct user ID from token

    if (!mongoose.Types.ObjectId.isValid(jobId)) throw new ApiError(400, 'Invalid job ID');

    // Get provider by userId
    const provider = await Provider.findOne({ userId }).session(session);
    if (!provider) throw new ApiError(404, 'Provider profile not found');

    const job = await Job.findById(jobId)
      .populate('service', 'name')
      .populate('customer', 'name email')
      .session(session);
    
    if (!job) throw new ApiError(404, 'Job not found');

    // Check if provider is authorized
    if (job.provider.toString() !== provider._id.toString()) {
      throw new ApiError(403, 'Not authorized to accept this job');
    }

     if (job.status == 'accepted') {
      throw new ApiError(400, `Job already accepted. Current: ${job.status}`);
    }

    // Check job status
    if (job.status !== 'pending') {
      throw new ApiError(400, `Job must be pending first. Current: ${job.status}`);
    }

    

    // Update job status
    job.status = 'accepted';
    job.acceptedAt = new Date();  // FIXED: acceptedAt, not startedAt
    await job.save({ session });

    await session.commitTransaction();

    // Send notification to customer
    await createNotification({
      userId: job.customer._id,
      title: 'Job Accepted',
      message: `Your service "${job.service?.name}" (Order #${job.orderId}) has been accepted by the provider.`,
      type: 'job',
      referenceId: job._id,
      metadata: { orderId: job.orderId, jobId: job._id },
    });

    // Send notification to provider (optional)
    const providerUser = await User.findById(provider.userId);
    if (providerUser) {
      await createNotification({
        userId: providerUser._id,
        title: 'Job Accepted',
        message: `You have accepted job #${job.orderId} for "${job.service?.name}". You can now start the job.`,
        type: 'job',
        referenceId: job._id,
        metadata: { orderId: job.orderId, jobId: job._id },
      });
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Job accepted successfully', 
      data: {
        _id: job._id,
        orderId: job.orderId,
        status: job.status,
        acceptedAt: job.acceptedAt,
        service: job.service,
        customer: job.customer
      } 
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
}



export async function startJob(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { jobId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new ApiError(400, 'Invalid job ID');
    }

    const provider = await Provider.findOne({ userId }).session(session);
    if (!provider) {
      throw new ApiError(404, 'Provider profile not found');
    }

    const job = await Job.findById(jobId)
      .populate('service', 'name')
      .session(session);
    
    if (!job) {
      throw new ApiError(404, 'Job not found');
    }

    if (job.provider.toString() !== provider._id.toString()) {
      throw new ApiError(403, 'Not authorized to start this job');
    }

       if (job.status == 'in_progress') {
      throw new ApiError(400, `Job already started. Current: ${job.status}`);
    }

    if (job.status !== 'accepted') {
      throw new ApiError(400, `Job must be accepted first. Current: ${job.status}`);
    }

    job.status = 'in_progress';
    job.startedAt = new Date();
    await job.save({ session });

    await session.commitTransaction();

    await createNotification({
      userId: job.customer,
      title: 'Job Started',
      message: `Your service "${job.service?.name}" (Order #${job.orderId}) has been started.`,
      type: 'job',
      referenceId: job._id,
    });

    return res.status(200).json({ 
      success: true, 
      message: 'Job started successfully', 
      data: job 
    });
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
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new ApiError(400, 'Invalid job ID');
    }

    const provider = await Provider.findOne({ userId }).session(session);
    if (!provider) {
      throw new ApiError(404, 'Provider profile not found');
    }

    const job = await Job.findById(jobId)
      .populate('service', 'name')
      .session(session);
    
    if (!job) {
      throw new ApiError(404, 'Job not found');
    }

    if (job.provider.toString() !== provider._id.toString()) {
      throw new ApiError(403, 'Not authorized to update this job');
    }

     if ('completed_by_provider'.includes(job.status)) {
      throw new ApiError(400, `Job already completed. Current: ${job.status}`);
    }

    if (!['accepted', 'in_progress'].includes(job.status)) {
      throw new ApiError(400, `Job must be accepted or in progress. Current: ${job.status}`);
    }

    job.status = 'completed_by_provider';
    job.completedByProviderAt = new Date();
    await job.save({ session });

    await session.commitTransaction();

    await createNotification({
      userId: job.customer,
      title: 'Job Completed - Please Confirm',
      message: `Provider has completed "${job.service?.name}" (Order #${job.orderId}). Please confirm.`,
      type: 'job',
      referenceId: job._id,
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
