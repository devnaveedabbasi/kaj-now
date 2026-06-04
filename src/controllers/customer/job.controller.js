import mongoose from 'mongoose';
import Job from '../../models/job.model.js';
import Payment from '../../models/payment.model.js';
import Wallet from '../../models/wallet.model.js';
import Provider from '../../models/provider/Provider.model.js';
import User from '../../models/User.model.js';
import Service from '../../models/admin/service.model.js';
import ServiceRequest from '../../models/admin/serviceRequest.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { processSSLCommerzPayment } from '../../service/sslcommerz.js';
import { createNotification } from '../../utils/notification.js';
import { createActivityLog } from '../../utils/createActivityLog.js';
import { validateCardDetails } from '../../utils/validateCardDetails.js';


async function generateOrderId() {
  const count = await Job.countDocuments();
  const padded = String(count + 1).padStart(3, '0');
  return `OR-${padded}`;
}





export async function bookJob(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user._id;
    const { serviceId, providerId, cardDetails, schedule, paymentMethod } = req.body;

    // ── Basic Validation ────────────────────────────────────────────────────
    if (!serviceId) {
      throw new ApiError(400, 'serviceId required');
    }

    if (!paymentMethod || !['card', 'cod'].includes(paymentMethod)) {
      throw new ApiError(400, 'paymentMethod must be card or cod');
    }

    if (!schedule?.date || !schedule?.time) {
      throw new ApiError(400, 'Schedule date and time required');
    }

    // ── Format Validation ───────────────────────────────────────────────────
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(schedule.date)) {
      throw new ApiError(400, 'Invalid date format. Use YYYY-MM-DD (e.g. 2026-06-04)');
    }

    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(schedule.time)) {
      throw new ApiError(400, 'Invalid time format. Use HH:MM in 24-hour format (e.g. 16:10)');
    }

    // ── Build scheduleDateTime ──────────────────────────────────────────────
    const scheduleDateTime = new Date(`${schedule.date}T${schedule.time}:00`);
    if (isNaN(scheduleDateTime.getTime())) {
      throw new ApiError(400, 'Invalid schedule date or time');
    }

    // ── Date/Time Rules ─────────────────────────────────────────────────────
    const now = new Date();
    const todayDateStr = now.toISOString().split('T')[0];
    const isToday = schedule.date === todayDateStr;

    const todayMidnight = new Date(todayDateStr + 'T00:00:00');
    const scheduleMidnight = new Date(schedule.date + 'T00:00:00');

    if (scheduleMidnight < todayMidnight) {
      throw new ApiError(400, 'Cannot book for a past date');
    }

    if (isToday) {
      const twoHoursLater = new Date(now.getTime() + 2 * 60 * 60 * 1000);
      if (scheduleDateTime <= twoHoursLater) {
        const hh = String(twoHoursLater.getHours()).padStart(2, '0');
        const mm = String(twoHoursLater.getMinutes()).padStart(2, '0');
        throw new ApiError(
          400,
          `For today's booking, time must be at least 2 hours from now. Earliest allowed: ${hh}:${mm}`
        );
      }
    }

    // ── Card validation ─────────────────────────────────────────────────────
    if (paymentMethod === 'card') {
      if (
        !cardDetails?.cardNumber ||
        !cardDetails?.expiryDate ||
        !cardDetails?.cvv ||
        !cardDetails?.cardHolderName
      ) {
        throw new ApiError(400, 'Complete card details required');
      }
      validateCardDetails(cardDetails);
    }

    // ── Fetch documents ─────────────────────────────────────────────────────
    const user = await User.findById(userId).session(session);
    if (!user) throw new ApiError(404, 'User not found');

    const service = await Service.findById(serviceId).session(session);
    if (!service || !service.isActive) throw new ApiError(404, 'Service not available');

    const Category = mongoose.model('Category');
    const category = await Category.findById(service.categoryId).session(session);
    if (!category || !category.isActive) throw new ApiError(404, 'Service category is inactive');

    // ── ServiceRequest se providerId lo ────────────────────────────────────
    const serviceRequest = await ServiceRequest.findOne({
      serviceId: serviceId,
      providerId: providerId,
      status: 'approved',
    }).session(session);

    if (!serviceRequest) throw new ApiError(400, 'No approved provider found for this service');

    // ── Provider serviceRequest se nikalo ───────────────────────────────────
    const provider = await Provider.findById(providerId).session(session);
    if (!provider) throw new ApiError(404, 'Provider not found');


    // ── parseTimeToMinutes helper ───────────────────────────────────────────
    const parseTimeToMinutes = (timeStr) => {
      const [hours, minutes] = timeStr.split(':').map(Number);
      return hours * 60 + minutes;
    };

    const requestedMinutes = parseTimeToMinutes(schedule.time);

    // ── Conflict check — same provider same day 1hr gap ─────────────────────
    const scheduleDateOnly = new Date(schedule.date + 'T00:00:00');

    const samedayJobs = await Job.find({
      provider: providerId,
      status: { $in: ['pending', 'accepted', 'in_progress'] },
      'schedule.date': {
        $gte: scheduleDateOnly,
        $lt: new Date(scheduleDateOnly.getTime() + 24 * 60 * 60 * 1000),
      },
    })
      .select('schedule.time')
      .session(session)
      .lean();

    const conflictingJob = samedayJobs.find((job) => {
      const existingMinutes = parseTimeToMinutes(job.schedule.time);
      return Math.abs(requestedMinutes - existingMinutes) < 60;
    });

    if (conflictingJob) {
      throw new ApiError(
        409,
        'Provider is busy at this time. Minimum 1 hour gap required between bookings. Please choose a different time.'
      );
    }

    // ── Duplicate booking check ─────────────────────────────────────────────
    const existingJob = await Job.findOne({
      customer: userId,
      service: serviceId,
      provider: providerId,
      status: { $in: ['pending', 'accepted', 'in_progress'] },
      'schedule.date': scheduleDateTime, // same date
      'schedule.time': schedule.time,    // same time
    }).session(session);

    if (existingJob) throw new ApiError(408, 'Already have an active booking for this service at this time');
    // ── Price calculation ke baad, COD limit check ──────────────────────────
    if (paymentMethod === 'cod') {
      const pendingDues = await Payment.aggregate([
        {
          $match: {
            providerId: provider._id,
            paymentMethod: 'cod',
            escrowStatus: 'cod_pending',
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: '$returnToAdmin' }
          }
        }
      ]);

      const totalDues = pendingDues[0]?.total || 0;
      const COD_LIMIT = parseFloat(process.env.COD_DUES_LIMIT || '2000');

      if (totalDues >= COD_LIMIT) {
        throw new ApiError(
          400,
          `Provider has pending dues of BDT ${totalDues}. Cannot accept new COD bookings until dues are cleared.`
        );
      }
    }
    // ── Price calculation ───────────────────────────────────────────────────
    const servicePrice = service.price;
    const platformFeePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENTAGE || '10');
    const platformFee = parseFloat(((platformFeePercentage / 100) * servicePrice).toFixed(2));
    const providerAmount = parseFloat((servicePrice - platformFee).toFixed(2));

    // ── Generate order ID ───────────────────────────────────────────────────
    const orderId = await generateOrderId();

    // ── Create Job ──────────────────────────────────────────────────────────
    const job = await Job.create(
      [
        {
          orderId,
          provider: provider._id,
          customer: user._id,
          service: serviceId,
          amount: servicePrice,
          status: 'pending',
          paymentStatus: 'pending',
          paymentMethod,
          schedule: {
            date: scheduleDateTime,
            time: schedule.time,
          },
        },
      ],
      { session }
    );

    // ── Create Payment record ───────────────────────────────────────────────
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
          paymentMethod,
          paymentGateway: paymentMethod === 'card' ? 'sslcommerz' : 'cod',
          paymentStatus: 'pending',
          escrowStatus: paymentMethod === 'cod' ? 'cod_pending' : 'pending',
          returnToAdmin: paymentMethod === 'cod' ? platformFee : 0,
        },
      ],
      { session }
    );

    // ── Payment processing ──────────────────────────────────────────────────
    if (paymentMethod === 'card') {

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

      // ── Admin wallet escrow ─────────────────────────────────────────────
      const adminUser = await User.findOne({ role: 'admin' }).session(session);
      if (!adminUser) throw new ApiError(500, 'Admin not found');

      let adminWallet = await Wallet.findOne({ userId: adminUser._id, role: 'admin' }).session(session);

      if (!adminWallet) {
        [adminWallet] = await Wallet.create(
          [{
            userId: adminUser._id,
            role: 'admin',
            balance: 0,
            totalEarnings: 0,
            totalPlatformFees: 0,
            isActive: true,
          }],
          { session }
        );
      }

      adminWallet.balance += servicePrice;
      adminWallet.totalEarnings += platformFee;
      adminWallet.totalPlatformFees += platformFee;
      adminWallet.totalHeld = (adminWallet.totalHeld || 0) + servicePrice;
      adminWallet.transactionHistory.push(payment[0]._id);
      await adminWallet.save({ session });

      await session.commitTransaction();

      await createActivityLog({
        userId,
        action: 'JOB_BOOKED',
        entityType: 'Job',
        entityId: job[0]._id,
        details: { orderId, amount: servicePrice, paymentMethod: 'card' },
        req,
      });

      await createNotification({
        userId,
        title: 'Booking Confirmed',
        message: `Your booking for "${service.name}" (Order #${orderId}) has been placed successfully. Awaiting provider confirmation.`,
        type: 'job',
        referenceId: job[0]._id,
        metadata: { orderId, jobId: job[0]._id },
      });

      const providerUser = await User.findById(provider.userId);
      if (providerUser) {
        await createNotification({
          userId: providerUser._id,
          title: 'New Job Request',
          message: `You have a new job request for "${service.name}" (Order #${orderId}). Please accept or reject.`,
          type: 'job',
          referenceId: job[0]._id,
          metadata: { orderId, jobId: job[0]._id },
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Job booked successfully.',
        data: {
          job: job[0],
          payment: payment[0],
          gatewayUrl: sslResponse.GatewayPageURL,
        },
      });

    } else {
      // ── COD flow ──────────────────────────────────────────────────────────
      await session.commitTransaction();

      await createActivityLog({
        userId,
        action: 'JOB_BOOKED',
        entityType: 'Job',
        entityId: job[0]._id,
        details: { orderId, amount: servicePrice, paymentMethod: 'cod' },
        req,
      });

      await createNotification({
        userId,
        title: 'Booking Confirmed (Cash on Delivery)',
        message: `Your booking for "${service.name}" (Order #${orderId}) has been placed. You will pay BDT ${servicePrice} in cash to the provider.`,
        type: 'job',
        referenceId: job[0]._id,
        metadata: { orderId, jobId: job[0]._id },
      });

      const providerUser = await User.findById(provider.userId);
      if (providerUser) {
        await createNotification({
          userId: providerUser._id,
          title: 'New Job Request (Cash on Delivery)',
          message: `You have a new COD job request for "${service.name}" (Order #${orderId}). Customer will pay BDT ${servicePrice} in cash. Please accept or reject.`,
          type: 'job',
          referenceId: job[0]._id,
          metadata: { orderId, jobId: job[0]._id },
        });
      }

      return res.status(201).json({
        success: true,
        message: 'Job booked successfully. Payment will be collected in cash.',
        data: {
          job: job[0],
          payment: payment[0],
        },
      });
    }

  } catch (error) {
    await session.abortTransaction();
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
}


export async function acceptJob(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { jobId } = req.params;
    const providerId = req.body.providerId || req.user?._id;

    if (!mongoose.Types.ObjectId.isValid(jobId)) throw new ApiError(400, 'Invalid job ID');

    const job = await Job.findById(jobId).populate('service', 'name').session(session);
    if (!job) throw new ApiError(404, 'Job not found');

    if (job.provider.toString() !== providerId.toString()) {
      throw new ApiError(403, 'Not authorized to accept this job');
    }

    if (job.status !== 'pending') {
      throw new ApiError(400, `Job status must be pending. Current: ${job.status}`);
    }

    await job.save({ session });

    await session.commitTransaction();

    // Notify customer
    await createNotification({
      userId: job.customer,
      title: 'Booking Accepted',
      message: `Your booking for "${job.service?.name || 'the service'}" (Order #${job.orderId}) has been accepted by the provider!`,
      type: 'job',
      referenceId: job._id,
      metadata: { orderId: job.orderId, jobId: job._id },
    });

    return res.status(200).json({ success: true, message: 'Job accepted successfully', data: job });
  } catch (error) {
    await session.abortTransaction();
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
}


export async function confirmCompletionByCustomer(req, res) {
  const session = await mongoose.startSession();

  try {
    const { jobId } = req.params;
    const customerId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new ApiError(400, 'Invalid job ID');
    }

    session.startTransaction();

    const existingJob = await Job.findById(jobId);
    if (!existingJob) {
      throw new ApiError(404, 'Job not found');
    }

    if (existingJob.customer.toString() !== customerId.toString()) {
      throw new ApiError(403, 'Not authorized');
    }

    if (existingJob.status === 'confirmed_by_user') {
      return res.status(200).json({
        success: true,
        message: 'Job already confirmed',
      });
    }

    // ── STEP 1: Atomic job update ───────────────────────────────────────────
    const job = await Job.findOneAndUpdate(
      {
        _id: jobId,
        customer: customerId,
        status: 'completed_by_provider',
      },
      {
        $set: {
          status: 'confirmed_by_user',
          confirmedByUserAt: new Date(),
          paymentStatus: 'released_to_provider',
        },
      },
      { new: true, session }
    ).populate('service', 'name');

    if (!job) {
      const existingJob = await Job.findById(jobId);

      if (!existingJob) throw new ApiError(404, 'Job not found');

      if (existingJob.customer.toString() !== customerId.toString()) {
        throw new ApiError(403, 'Not authorized');
      }

      if (existingJob.status === 'confirmed_by_user') {
        return res.status(200).json({
          success: true,
          message: 'Job already confirmed',
        });
      }

      throw new ApiError(
        400,
        `Job not ready for confirmation. Current status: ${existingJob.status}`
      );
    }

    // ── STEP 2: Payment fetch ───────────────────────────────────────────────
    const payment = await Payment.findOne({ jobId }).session(session);
    if (!payment) throw new ApiError(404, 'Payment record not found');

    // ── COD FLOW ────────────────────────────────────────────────────────────
    if (payment.paymentMethod === 'cod') {

      if (payment.escrowStatus !== 'cod_pending') {
        throw new ApiError(400, 'COD payment is not pending');
      }

      payment.escrowStatus = 'cod_completed';
      payment.paymentStatus = 'completed';
      payment.releasedAt = new Date();
      await payment.save({ session });

      // Provider stats
      const provider = await Provider.findById(job.provider).session(session);
      if (provider) {
        await provider.incrementServiceOrderCount(job.service);
      }

      await session.commitTransaction();

      // Activity log
      try {
        await createActivityLog({
          userId: customerId,
          action: 'JOB_CONFIRMED',
          entityType: 'Job',
          entityId: job._id,
          details: {
            orderId: job.orderId,
            amount: payment.providerAmount,
            paymentMethod: 'cod',
          },
          req,
        });
      } catch (e) {
        console.error('Activity log failed:', e.message);
      }

      // Notifications
      try {
        if (provider) {
          await createNotification({
            userId: provider.userId,
            title: 'Job Completed (COD)',
            message: `Order #${job.orderId} confirmed by customer. Collect BDT ${payment.providerAmount} in cash and pay BDT ${payment.returnToAdmin} platform fee to admin.`,
            type: 'payment',
            referenceId: job._id,
          });
        }

        await createNotification({
          userId: customerId,
          title: 'Job Completed',
          message: `Order #${job.orderId} completed successfully.`,
          type: 'job',
          referenceId: job._id,
        });
      } catch (e) {
        console.error('Notification failed:', e.message);
      }

      return res.status(200).json({
        success: true,
        message: 'Job confirmed. Provider will collect cash payment.',
        data: {
          job,
          payment: {
            totalAmount: payment.totalAmount,
            platformFee: payment.platformFee,
            providerAmount: payment.providerAmount,
            returnToAdmin: payment.returnToAdmin,
            paymentMethod: 'cod',
            status: 'cod_completed',
          },
        },
      });
    }

    // ── CARD FLOW ───────────────────────────────────────────────────────────
    if (payment.escrowStatus !== 'held_in_admin_wallet') {
      throw new ApiError(400, 'Payment is not in escrow');
    }

    // STEP 3: Admin wallet
    const adminUser = await User.findOne({ role: 'admin' }).session(session);
    if (!adminUser) throw new ApiError(500, 'Admin not found');

    const adminWallet = await Wallet.findOne({
      userId: adminUser._id,
      role: 'admin',
    }).session(session);

    if (!adminWallet) throw new ApiError(500, 'Admin wallet not found');

    if (adminWallet.balance < payment.providerAmount) {
      throw new ApiError(400, 'Insufficient admin balance');
    }

    // STEP 4: Provider wallet
    let providerWallet = await Wallet.findOne({
      userId: payment.providerId,
      role: 'provider',
    }).session(session);

    if (!providerWallet) {
      [providerWallet] = await Wallet.create(
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
      );
    }

    // STEP 5: Wallet transactions
    adminWallet.balance -= payment.providerAmount;
    adminWallet.totalHeld = (adminWallet.totalHeld || 0) - payment.totalAmount;
    adminWallet.totalPlatformFees += payment.platformFee;
    await adminWallet.save({ session });

    providerWallet.balance += payment.providerAmount;
    providerWallet.totalEarnings += payment.providerAmount;
    providerWallet.totalPlatformFees += payment.platformFee;
    providerWallet.transactionHistory.push(payment._id);
    await providerWallet.save({ session });

    // STEP 6: Update payment
    payment.escrowStatus = 'released_to_provider';
    payment.releasedAt = new Date();
    await payment.save({ session });

    // STEP 7: Provider stats
    const provider = await Provider.findById(job.provider).session(session);
    if (provider) {
      await provider.incrementServiceOrderCount(job.service);
    }

    await session.commitTransaction();

    // STEP 8: Activity log
    try {
      await createActivityLog({
        userId: customerId,
        action: 'JOB_CONFIRMED',
        entityType: 'Job',
        entityId: job._id,
        details: {
          orderId: job.orderId,
          amount: payment.providerAmount,
          paymentMethod: 'card',
        },
        req,
      });
    } catch (e) {
      console.error('Activity log failed:', e.message);
    }

    // STEP 9: Notifications
    try {
      if (provider) {
        await createNotification({
          userId: provider.userId,
          title: 'Payment Released & Order Completed',
          message: `Order #${job.orderId} confirmed. BDT ${payment.providerAmount} has been credited to your wallet.`,
          type: 'payment',
          referenceId: job._id,
        });
      }

      await createNotification({
        userId: customerId,
        title: 'Job Completed',
        message: `Order #${job.orderId} completed successfully.`,
        type: 'job',
        referenceId: job._id,
      });
    } catch (e) {
      console.error('Notification failed:', e.message);
    }

    return res.status(200).json({
      success: true,
      message: 'Job confirmed. Payment released successfully.',
      data: {
        job,
        payment: {
          totalAmount: payment.totalAmount,
          platformFee: payment.platformFee,
          providerAmount: payment.providerAmount,
          paymentMethod: 'card',
          status: 'released_to_provider',
        },
        providerStats: provider
          ? {
            totalOrdersCompleted: provider.totalOrdersCompleted,
            serviceOrdersCount: Object.fromEntries(provider.serviceOrdersCount),
          }
          : null,
      },
    });

  } catch (error) {
    await session.abortTransaction();
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Internal server error',
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

    if (!mongoose.Types.ObjectId.isValid(jobId)) throw new ApiError(400, 'Invalid job ID');
    if (!reason) throw new ApiError(400, 'Dispute reason is required');

    const job = await Job.findById(jobId).populate('service', 'name').session(session);
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

    // ── Notifications ────────────────────────────────────────────────────────
    // Notify admin
    const adminUser = await User.findOne({ role: 'admin' });
    if (adminUser) {
      await createNotification({
        userId: adminUser._id,
        title: 'New Dispute Raised',
        message: `A dispute has been raised on Order #${job.orderId} for "${job.service?.name}". Reason: ${reason}`,
        type: 'dispute',
        referenceId: job._id,
        metadata: { orderId: job.orderId, jobId: job._id, reason },
      });
    }

    // Notify provider
    const provider = await Provider.findById(job.provider);
    if (provider) {
      await createNotification({
        userId: provider.userId,
        title: 'Dispute Raised on Your Job',
        message: `Customer has raised a dispute on Order #${job.orderId}. Admin will review and resolve.`,
        type: 'dispute',
        referenceId: job._id,
        metadata: { orderId: job.orderId, jobId: job._id },
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Dispute initiated. Admin will review and resolve.',
      data: job,
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
}


export const getMyOrders = async (req, res) => {
  try {
    const userId = req.user._id;

    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const { status } = req.query; // pending, accepted, in_progress, completed_by_provider, confirmed_by_user, disputed, cancelled

    // Build query
    let query = { customer: userId };

    // If status provided, filter by it, otherwise get all
    if (status && status !== 'all') {
      const validStatuses = [
        'pending',
        'accepted',
        'rejected_by_provider',
        'in_progress',
        'completed_by_provider',
        'confirmed_by_user',
        'disputed',
        'cancelled'
      ];
      if (!validStatuses.includes(status)) {
        throw new ApiError(400, 'Invalid status. Valid values: pending, accepted, in_progress, completed_by_provider, confirmed_by_user, disputed, cancelled, all');
      }
      query.status = status;
    }

    // Sorting
    const sortField = req.query.sortBy || 'createdAt';
    const sortOrder = req.query.sortOrder === 'asc' ? 1 : -1;
    const sort = { [sortField]: sortOrder };

    // Get orders with pagination
    const [orders, totalCount] = await Promise.all([
      Job.find(query)
        .populate('provider', 'userId')
        .populate({
          path: 'provider',
          populate: {
            path: 'userId',
            select: 'name email profilePicture phoneNumber'
          }
        })
        .populate('service', 'name icon price description averageRating')
        .populate('customer', 'name email profilePicture')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      Job.countDocuments(query)
    ]);

    // Get status counts for filters
    const statusCounts = await Job.aggregate([
      { $match: { customer: userId } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);

    const counts = {
      all: totalCount,
      pending: 0,
      accepted: 0,
      rejected_by_provider: 0,
      in_progress: 0,
      completed_by_provider: 0,
      confirmed_by_user: 0,
      disputed: 0,
      cancelled: 0
    };

    statusCounts.forEach(item => {
      if (counts.hasOwnProperty(item._id)) {
        counts[item._id] = item.count;
      }
    });

    // Format orders
    const formattedOrders = orders.map(order => ({
      _id: order._id,
      orderId: order.orderId,
      status: order.status,
      paymentStatus: order.paymentStatus,
      amount: order.amount,
      service: {
        _id: order.service?._id,
        name: order.service?.name,
        icon: order.service?.icon,
        price: order.service?.price,
        description: order.service?.description,
        averageRating: order.service?.averageRating || 0
      },
      provider: {
        _id: order.provider?._id,
        name: order.provider?.userId?.name,
        email: order.provider?.userId?.email,
        phone: order.provider?.userId?.phoneNumber,
        profilePicture: order.provider?.userId?.profilePicture
      },
      timestamps: {
        createdAt: order.createdAt,
        acceptedAt: order.acceptedAt,
        startedAt: order.startedAt,
        completedByProviderAt: order.completedByProviderAt,
        confirmedByUserAt: order.confirmedByUserAt,
        disputedAt: order.disputedAt,
        cancelledAt: order.cancelledAt
      },
      rejectionReason: order.rejectionReason,
      disputeReason: order.disputeReason
    }));

    const totalPages = Math.ceil(totalCount / limit);

    res.status(200).json(
      new ApiResponse(200, {
        orders: formattedOrders,
        counts: counts,
        pagination: {
          currentPage: page,
          totalPages,
          totalItems: totalCount,
          itemsPerPage: limit,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1
        },
        currentFilter: {
          status: status || 'all'
        }
      }, 'Orders retrieved successfully')
    );
  } catch (error) {
    console.error('Error getting orders:', error);
    if (error instanceof ApiError) {
      res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
    } else {
      res.status(500).json(new ApiResponse(500, null, error.message));
    }
  }
};

export const getOrderById = async (req, res) => {
  try {
    const { jobId } = req.params;
    const userId = req.user._id;
    console.log('Fetching order details for jobId:', jobId, 'userId:', userId);
    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new ApiError(400, 'Invalid job ID format');
    }

    // Find order by _id (not orderId field)
    const order = await Job.findOne({ _id: jobId, customer: userId })
      .populate('provider', 'userId')
      .populate({
        path: 'provider',
        populate: {
          path: 'userId',
          select: 'name email profilePicture phoneNumber'
        }
      })
      .populate('service', 'name icon price description averageRating')
      .populate('customer', 'name email profilePicture')
      .lean();

    if (!order) {
      throw new ApiError(404, 'Order not found');
    }

    // Get payment details
    const payment = await Payment.findOne({ jobId: order._id }).lean();

    const formattedOrder = {
      _id: order._id,
      orderId: order.orderId,
      status: order.status,
      paymentStatus: order.paymentStatus,
      amount: order.amount,
      service: {
        _id: order.service?._id,
        name: order.service?.name,
        icon: order.service?.icon,
        price: order.service?.price,
        description: order.service?.description,
        averageRating: order.service?.averageRating || 0
      },
      provider: {
        _id: order.provider?._id,
        name: order.provider?.userId?.name,
        email: order.provider?.userId?.email,
        phone: order.provider?.userId?.phoneNumber,
        profilePicture: order.provider?.userId?.profilePicture,
        location: order.provider?.location
      },
      customer: {
        _id: order.customer?._id,
        name: order.customer?.name,
        email: order.customer?.email,
        profilePicture: order.customer?.profilePicture
      },
      payment: payment ? {
        _id: payment._id,
        totalAmount: payment.totalAmount,
        platformFee: payment.platformFee,
        providerAmount: payment.providerAmount,
        paymentStatus: payment.paymentStatus,
        escrowStatus: payment.escrowStatus,
        createdAt: payment.createdAt
      } : null,
      timestamps: {
        createdAt: order.createdAt,
        acceptedAt: order.acceptedAt,
        startedAt: order.startedAt,
        completedByProviderAt: order.completedByProviderAt,
        confirmedByUserAt: order.confirmedByUserAt,
        disputedAt: order.disputedAt,
        cancelledAt: order.cancelledAt
      },
      rejectionReason: order.rejectionReason,
      disputeReason: order.disputeReason
    };

    res.status(200).json(
      new ApiResponse(200, formattedOrder, 'Order details retrieved successfully')
    );
  } catch (error) {
    console.error('Error getting order:', error);
    if (error instanceof ApiError) {
      res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
    } else {
      res.status(500).json(new ApiResponse(500, null, error.message));
    }
  }
};