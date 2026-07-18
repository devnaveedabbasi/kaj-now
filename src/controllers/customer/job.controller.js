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
import { processSSLCommerzCardPayment, initiateSSLCommerzPayment } from '../../service/sslcommerz.js';
import { createStripePaymentIntent } from '../../service/stripe.js';
import { createNotification } from '../../utils/notification.js';
import { createActivityLog } from '../../utils/createActivityLog.js';
import { validateCardDetails } from '../../utils/validateCardDetails.js';
import BookingIntent from '../../models/bookingIntent.model.js';
import {
  NON_CANCELLABLE_JOB_STATUSES,
  applyCancellationMetadata,
  releaseEscrowForCancellation,
} from '../../utils/jobCancellation.js';

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
    const {
      serviceId,
      providerId,
      cardDetails,
      schedule,
      paymentMethod,
      subServices,
      totalPrice,
    } = req.body;

    // ── Supported Methods ────────────────────────────────────────────
    const SUPPORTED_METHODS = ['card', 'cod', 'bkash', 'nagad', 'rocket', 'bank'];
    if (!paymentMethod || !SUPPORTED_METHODS.includes(paymentMethod)) {
      throw new ApiError(400, `paymentMethod must be one of: ${SUPPORTED_METHODS.join(', ')}`);
    }

    // ── Schedule Validation ──────────────────────────────────────────
    if (!schedule?.date || !schedule?.time) {
      throw new ApiError(400, 'Schedule date and time required');
    }

    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(schedule.date)) {
      throw new ApiError(400, 'Invalid date format. Use YYYY-MM-DD');
    }

    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(schedule.time)) {
      throw new ApiError(400, 'Invalid time format. Use HH:MM in 24-hour format');
    }

    const scheduleDateTime = new Date(`${schedule.date}T${schedule.time}:00`);
    if (isNaN(scheduleDateTime.getTime())) {
      throw new ApiError(400, 'Invalid schedule date or time');
    }

    const now = new Date();
    const todayDateStr = now.toISOString().split('T')[0];
    const isToday = schedule.date === todayDateStr;
    const scheduleMidnight = new Date(schedule.date + 'T00:00:00');
    const todayMidnight = new Date(todayDateStr + 'T00:00:00');

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
   // ── Fetch Documents ──────────────────────────────────────────────
    const user = await User.findById(userId).session(session);
    if (!user) throw new ApiError(404, 'User not found');

    // ── Method-specific validation ───────────────────────────────────
    if (paymentMethod === 'card' && user.region === "BD") {
      if (
        !cardDetails?.cardNumber ||
        !cardDetails?.expiryDate ||
        !cardDetails?.cvv ||
        !cardDetails?.cardHolderName
      ) {
        throw new ApiError(
          400,
          'Complete card details required: cardNumber, expiryDate, cvv, cardHolderName'
        );
      }
      validateCardDetails(cardDetails);
    }

 
    const service = await Service.findById(serviceId).session(session);
    if (!service || !service.isActive) throw new ApiError(404, 'Service not available');

    const serviceRequest = await ServiceRequest.findOne({
      serviceId,
      providerId,
      status: 'approved',
    }).session(session);
    if (!serviceRequest) throw new ApiError(400, 'Provider not found for this service');

    const provider = await Provider.findById(providerId).session(session);
    if (!provider) throw new ApiError(404, 'Provider not found');

    // ── Schedule conflict check — ALL payment methods ──────────────────
    // Block booking if an active job already exists within ±1 hour of the
    // requested schedule. This runs BEFORE payment so money is never taken
    // for a booking that will fail.
    const CONFLICT_WINDOW_MS = 60 * 60 * 1000; // 1 hour in milliseconds
    const existingJob = await Job.findOne({
      customer: userId,
      service: serviceId,
      provider: providerId,
      status: { $in: ['pending', 'accepted', 'in_progress'] },
      'schedule.date': {
        $gte: new Date(scheduleDateTime.getTime() - CONFLICT_WINDOW_MS),
        $lte: new Date(scheduleDateTime.getTime() + CONFLICT_WINDOW_MS),
      },
    }).session(session);

    if (existingJob) {
      const existingTime = existingJob.schedule?.time || 'N/A';
      throw new ApiError(
        409,
        `You already have an active booking (Order #${existingJob.orderId}) scheduled at ${existingTime}. ` +
        `Please choose a time at least 1 hour before or after your existing booking.`
      );
    }

    // ── COD: provider dues check ─────────────────────────────────────
    if (paymentMethod === 'cod') {
      const pendingDues = await Payment.aggregate([
        {
          $match: {
            providerId: provider._id,
            paymentMethod: 'cod',
            escrowStatus: 'cod_pending',
          },
        },
        { $group: { _id: null, total: { $sum: '$returnToAdmin' } } },
      ]);
      const totalDues = pendingDues[0]?.total || 0;
      const COD_LIMIT = parseFloat(process.env.COD_DUES_LIMIT || '2000');
      if (totalDues >= COD_LIMIT) {
        throw new ApiError(
          400,
          `Provider has pending dues of BDT ${totalDues}. Cannot accept new COD bookings.`
        );
      }
    }

    // ── Price Calculation ────────────────────────────────────────────
    let servicePrice = totalPrice || service.price;
    if (user.region === 'UK' && !servicePrice) {
      servicePrice = serviceRequest?.ukService?.price;
    }

    if (servicePrice === undefined || servicePrice === null || isNaN(servicePrice)) {
      throw new ApiError(400, 'Invalid service price.');
    }

    const platformFeePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENTAGE || '10');
    const platformFee = parseFloat(((platformFeePercentage / 100) * servicePrice).toFixed(2));
    const providerAmount = parseFloat((servicePrice - platformFee).toFixed(2));
    const orderId = await generateOrderId();

    // ────────────────────────────────────────────────────────────────
    // COD FLOW — Job created immediately, no payment upfront
    // ────────────────────────────────────────────────────────────────
    if (paymentMethod === 'cod') {
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
            paymentMethod: 'cod',
            schedule: { date: scheduleDateTime, time: schedule.time },
            subServices: subServices || [],
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
            paymentMethod: 'cod',
            paymentGateway: 'cod',
            paymentStatus: 'pending',
            escrowStatus: 'cod_pending',
            returnToAdmin: 0,
          },
        ],
        { session }
      );

      await session.commitTransaction();

      await createNotifications(
        user._id,
        provider.userId,
        service.name,
        orderId,
        job[0]._id,
        servicePrice,
        'cod'
      );

      return res.status(201).json(
        new ApiResponse(
          201,
          { job: job[0], payment: payment[0] },
          'Job booked successfully. Payment will be collected in cash.'
        )
      );
    }

    // ────────────────────────────────────────────────────────────────
    // ALL ONLINE PAYMENTS — Shared SSLCommerz payload
    // ────────────────────────────────────────────────────────────────

    // ── Prevent duplicate concurrent payment sessions ────────────────
    // If a pending BookingIntent already exists for same user+service+provider
    // AND within ±1 hour of the new requested time, block it.
    // This allows the user to book different schedules without waiting for intent expiry.
    const pendingIntent = await BookingIntent.findOne({
      userId,
      serviceId,
      providerId,
      status: 'pending',
      'schedule.date': {
        $gte: new Date(scheduleDateTime.getTime() - CONFLICT_WINDOW_MS),
        $lte: new Date(scheduleDateTime.getTime() + CONFLICT_WINDOW_MS),
      },
    });

    if (pendingIntent) {
      // Calculate remaining time so user knows when to retry
      const expiresIn = Math.max(
        0,
        Math.floor((new Date(pendingIntent.expiresAt) - Date.now()) / 1000 / 60)
      );
      const pendingTime = pendingIntent.schedule?.time || 'N/A';
      throw new ApiError(
        409,
        `A payment session is already in progress for this service at ${pendingTime}. ` +
        `Complete the previous payment or wait ${expiresIn} minute(s) for it to expire.`
      );
    }

    const tranId = `${paymentMethod.toUpperCase()}_${userId}_${Date.now()}_${Math.random()
      .toString(36)
      .substr(2, 6)}`;

    // ────────────────────────────────────────────────────────────────
    // UK REGION — Stripe Payment Flow
    // ────────────────────────────────────────────────────────────────
    if (user.region === 'UK') {
      if (paymentMethod !== 'card') {
        throw new ApiError(400, 'Only card payments are supported in the UK region.');
      }

      const paymentIntent = await createStripePaymentIntent(servicePrice, 'gbp', {
        tranId,
        orderId,
        userId: user._id.toString(),
        providerId: provider._id.toString(),
        serviceId: service._id.toString(),
      });

      await BookingIntent.create(
        [
          {
            tranId,
            orderId,
            userId: user._id,
            providerId: provider._id,
            serviceId: service._id,
            servicePrice,
            platformFee,
            providerAmount,
            paymentMethod: 'card',
            paymentGateway: 'stripe',
            schedule: { date: scheduleDateTime, time: schedule.time },
          },
        ],
        { session }
      );

      await session.commitTransaction();
 console.log('Stripe PaymentIntent created:', paymentIntent.id, 'Client Secret:', paymentIntent.client_secret, 'intent:', paymentIntent); 
      return res.status(201).json(
        new ApiResponse(
          201,
          {
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            tranId,
            paymentMethod: 'card',
            paymentGateway: 'stripe',
            expiresIn: 3600,
          },
          'Stripe payment session created. Complete payment to confirm booking.'
        )
      );
    }

    // ────────────────────────────────────────────────────────────────
    // BD REGION — SSLCommerz MUST communicate with the backend server
    // ────────────────────────────────────────────────────────────────
    // So we use BASE_URL (the backend's URL) for success_url, fail_url, etc.
    // The backend will process the callback and THEN redirect to APP_BASE_URL.
    const BASE_URL = process.env.BASE_URL;
    console.log(BASE_URL, process.env.BASE_URL, 'BASE_URL for SSLCommerz callbacks');
    const paymentData = {
      total_amount: servicePrice,
      currency: 'BDT',
      tran_id: tranId,
      success_url: `${BASE_URL}/api/payments/success`,
      fail_url: `${BASE_URL}/api/payments/fail`,
      cancel_url: `${BASE_URL}/api/payments/cancel`,
      ipn_url: `${BASE_URL}/api/payments/ipn`,
      cus_name: user.name,
      cus_email: user.email,
      cus_phone: user.phone || user.phoneNumber || '01700000000',
      cus_add1: user.location?.locationName || 'Dhaka',
      cus_city: 'Dhaka',
      cus_country: 'Bangladesh',
      shipping_method: 'NO',
      product_name: service.name,
      product_category: 'Service',
      product_profile: 'general',
      // multi_card_name restricts SSLCommerz hosted page to ONLY the chosen method.
      // This prevents user from switching to a different method on the gateway page.
      payment_method: paymentMethod !== 'card' ? paymentMethod : undefined,
    };

    // ────────────────────────────────────────────────────────────────
    // CARD FLOW — Direct API with card credentials
    // Job created immediately if SSL charges directly (no GatewayPageURL)
    // Falls back to BookingIntent + hosted redirect if 3DS is required
    // ────────────────────────────────────────────────────────────────
    if (paymentMethod === 'card') {
      let sslResponse;
      try {
        sslResponse = await processSSLCommerzCardPayment(paymentData, cardDetails);
      } catch (err) {
        throw new ApiError(502, `Card payment gateway error: ${err.message}`);
      }

      // Card payment must return SUCCESS — any other status is a failure
      if (!sslResponse || sslResponse.status !== 'SUCCESS') {
        throw new ApiError(
          400,
          `Card payment failed: ${sslResponse?.failedreason || 'Payment declined by gateway'}`
        );
      }

      // ── Create Job + Payment immediately on SUCCESS ───────────────
      // We trust the SUCCESS status from SSLCommerz directly.
      // In sandbox, GatewayPageURL may be returned alongside SUCCESS — we
      // ignore it and always create the job right here so the user never
      // has to visit a hosted page when paying by card.
      const job = await Job.create(
        [
          {
            orderId,
            provider: provider._id,
            customer: user._id,
            service: serviceId,
            amount: servicePrice,
            status: 'pending',
            paymentStatus: 'held_in_escrow',
            paymentMethod: 'card',
            schedule: { date: scheduleDateTime, time: schedule.time },
            subServices: subServices || [],
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
            paymentMethod: 'card',
            paymentGateway: 'sslcommerz',
            paymentStatus: 'completed',
            escrowStatus: 'held_in_admin_wallet',
            sslCommerzTransactionId: sslResponse.tran_id || tranId,
            sslCommerzValidation: true,
          },
        ],
        { session }
      );

      await updateAdminWallet(session, servicePrice, platformFee, payment[0]._id);
      await session.commitTransaction();

      await createNotifications(
        user._id,
        provider.userId,
        service.name,
        orderId,
        job[0]._id,
        servicePrice,
        'card'
      );

      return res.status(201).json(
        new ApiResponse(
          201,
          { job: job[0], payment: payment[0] },
          'Job booked and card payment confirmed successfully.'
        )
      );
    }

    // ────────────────────────────────────────────────────────────────
    // MFS (bKash / Nagad / Rocket) & BANK (Internet Banking) FLOW
    // Redirects to SSLCommerz hosted page locked to chosen method
    // Job is created ONLY after successful payment callback
    // BookingIntent is auto-deleted by MongoDB TTL on expiry
    // ────────────────────────────────────────────────────────────────
    let sslResponse;
    try {
      sslResponse = await initiateSSLCommerzPayment(paymentData);
    } catch (err) {
      throw new ApiError(502, `Payment gateway error: ${err.message}`);
    }

    if (!sslResponse || sslResponse.status !== 'SUCCESS') {
      throw new ApiError(
        400,
        `Failed to initiate ${paymentMethod} payment: ${sslResponse?.failedreason || 'Gateway error'}`
      );
    }

    // Create BookingIntent — holds booking data until callback confirms payment
    await BookingIntent.create({
      tranId,
      orderId,
      userId: user._id,
      providerId: provider._id,
      serviceId: service._id,
      servicePrice,
      platformFee,
      providerAmount,
      paymentMethod,
      schedule: { date: scheduleDateTime, time: schedule.time },
    });

    await session.commitTransaction();

    const methodLabels = {
      bkash: 'bKash',
      nagad: 'Nagad',
      rocket: 'Rocket',
      bank: 'Internet Banking (Bank Transfer)',
    };

    return res.status(201).json(
      new ApiResponse(
        201,
        {
          gatewayUrl: sslResponse.GatewayPageURL,
          tranId,
          paymentMethod,
          expiresIn: 3600,
        },
        `${methodLabels[paymentMethod] || paymentMethod.toUpperCase()} payment session created. Complete payment to confirm booking.`
      )
    );
  } catch (error) {
    await session.abortTransaction();
    console.error('[bookJob] Error:', error);
    return res
      .status(error.statusCode || 500)
      .json(new ApiResponse(error.statusCode || 500, null, error.message));
  } finally {
    session.endSession();
  }
}



// ─────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────
async function updateAdminWallet(session, totalAmount, platformFee, paymentId) {
  const adminUser = await User.findOne({ role: 'admin' }).session(session);
  if (!adminUser) throw new Error('Admin not found');

  let adminWallet = await Wallet.findOne({ userId: adminUser._id, role: 'admin' }).session(session);

  if (!adminWallet) {
    [adminWallet] = await Wallet.create([{
      userId: adminUser._id,
      role: 'admin',
      balance: 0,
      totalEarnings: 0,
      totalPlatformFees: 0,
      isActive: true,
      totalHeld: 0,
      transactionHistory: []
    }], { session });
  }

  adminWallet.balance += totalAmount;
  adminWallet.totalEarnings += platformFee;
  adminWallet.totalPlatformFees += platformFee;
  adminWallet.totalHeld = (adminWallet.totalHeld || 0) + totalAmount;
  adminWallet.transactionHistory.push(paymentId);
  await adminWallet.save({ session });
}

async function createNotifications(customerId, providerUserId, serviceName, orderId, jobId, amount, method) {


  await createNotification({
    userId: customerId,
    title: 'Booking Confirmed',
    message: `Your booking for "${serviceName}" (Order #${orderId}) has been confirmed. Payment of BDT ${amount} via ${method.toUpperCase()} successful.`,
    type: 'job',
    referenceId: jobId,
    metadata: { orderId, jobId, amount, method },
  });

  if (providerUserId) {
    await createNotification({
      userId: providerUserId,
      title: 'New Job Confirmed',
      message: `New job for "${serviceName}" (Order #${orderId}) has been confirmed. Payment verified.`,
      type: 'job',
      referenceId: jobId,
      metadata: { orderId, jobId, amount, method },
    });
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
    console.log('Payment record found for Job ID:', jobId, payment);

    // ── COD FLOW ────────────────────────────────────────────────────────────
    if (payment.paymentMethod === 'cod') {
      console.log('Processing COD confirmation for Job ID:', jobId);
      if (payment.escrowStatus !== 'cod_pending') {
        throw new ApiError(400, 'COD payment is not pending');
      }

      const wallet = await Wallet.findOne({ userId: payment.providerId, role: 'provider' }).session(session);
      if (!wallet) {
        wallet = await Wallet.create([{
          userId: payment.providerId,
          role: 'provider',
        }], { session });
      }
      wallet.totalEarnings += payment.providerAmount;
      wallet.totalPlatformFees += payment.platformFee;
      wallet.transactionHistory.push(payment._id);
      await wallet.save({ session });

      payment.escrowStatus = 'cod_completed';
      payment.paymentStatus = 'completed';
      payment.returnToAdmin = (payment.returnToAdmin || 0) + payment.platformFee;
      payment.confirmedAt = new Date();
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

    // Bulk-fetch payment refund info for cancelled/rejected orders in this page
    const paymentsByJobId = new Map();
    const orderIdsForPayment = orders
      .filter(o => ['cancelled', 'rejected_by_provider'].includes(o.status))
      .map(o => o._id);
    if (orderIdsForPayment.length > 0) {
      const relatedPayments = await Payment.find({ jobId: { $in: orderIdsForPayment } })
        .select('jobId totalAmount refundStatus refundedAt refundMarkedAt refundNote paymentStatus')
        .lean();
      relatedPayments.forEach(p => paymentsByJobId.set(p.jobId.toString(), p));
    }

    // Format orders
    const formattedOrders = orders.map(order => {
      const payment = paymentsByJobId.get(order._id.toString()) || null;
      return {
        _id: order._id,
        orderId: order.orderId,
        status: order.status,
        paymentStatus: order.paymentStatus,
        amount: order.amount,
        schedule: order.schedule,
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
          userId: order.provider?.userId?._id,
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
        subServices: order.subServices || [],
        rejectionReason: order.rejectionReason,
        disputeReason: order.disputeReason,
        cancellation: ['cancelled', 'rejected_by_provider'].includes(order.status) ? {
          cancelledBy: order.cancelledBy || (order.status === 'rejected_by_provider' ? 'provider' : 'system'),
          cancellationReason: order.cancellationReason || order.rejectionReason || null,
          cancelledAt: order.cancelledAt,
          refundStatus: payment?.refundStatus || 'not_applicable',
          refundedAt: payment?.refundedAt || null,
        } : null,
      };
    });

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
      schedule: order.schedule,

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
        userId: order.provider?.userId?._id,
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
        refundStatus: payment.refundStatus,
        refundedAt: payment.refundedAt,
        refundMarkedAt: payment.refundMarkedAt,
        refundNote: payment.refundNote,
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
      subServices: order.subServices || [],
      rejectionReason: order.rejectionReason,
      disputeReason: order.disputeReason,
      cancellation: ['cancelled', 'rejected_by_provider'].includes(order.status) ? {
        cancelledBy: order.cancelledBy || (order.status === 'rejected_by_provider' ? 'provider' : 'system'),
        cancellationReason: order.cancellationReason || order.rejectionReason || null,
        cancelledAt: order.cancelledAt,
      } : null,
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


// ─────────────────────────────────────────────────────────────
// PATCH /api/customer/job/:jobId/cancel
// Customer cancels a booking — only allowed before the job has started
// (status must still be 'pending' or 'accepted'). Any money already held
// in the admin wallet is flagged for manual refund by the admin; nothing
// is auto-credited to the customer's wallet.
// ─────────────────────────────────────────────────────────────
export async function cancelJobByCustomer(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { jobId } = req.params;
    const { reason } = req.body;
    const customerId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
      throw new ApiError(400, 'Invalid job ID');
    }

    const job = await Job.findById(jobId).populate('service', 'name').session(session);
    if (!job) {
      throw new ApiError(404, 'Job not found');
    }

    if (job.customer.toString() !== customerId.toString()) {
      throw new ApiError(403, 'Not authorized to cancel this job');
    }

    if (NON_CANCELLABLE_JOB_STATUSES.includes(job.status)) {
      throw new ApiError(400, `Job cannot be cancelled. Current status: ${job.status}`);
    }

    if (job.status !== 'pending' && job.status !== 'accepted') {
      throw new ApiError(400, `Job cannot be cancelled once it has started. Current status: ${job.status}`);
    }

    const payment = await Payment.findOne({ jobId: job._id }).session(session);

    applyCancellationMetadata(job, {
      source: 'customer',
      byUserId: customerId,
      reason: reason?.trim() || 'Cancelled by customer',
    });
    await job.save({ session });

    await releaseEscrowForCancellation(session, payment);

    await session.commitTransaction();

    // ── Activity Log ──────────────────────────────────────────────────
    try {
      await createActivityLog({
        userId: customerId,
        action: 'JOB_CANCELLED_BY_CUSTOMER',
        entityType: 'Job',
        entityId: job._id,
        details: { orderId: job.orderId, reason: job.cancellationReason },
        req,
      });
    } catch (e) {
      console.error('Activity log failed:', e.message);
    }

    // ── Notifications ─────────────────────────────────────────────────
    try {
      const provider = await Provider.findById(job.provider);
      if (provider?.userId) {
        await createNotification({
          userId: provider.userId,
          title: 'Booking Cancelled by Customer',
          message: `Order #${job.orderId} for "${job.service?.name || 'the service'}" was cancelled by the customer.`,
          type: 'job',
          referenceId: job._id,
          metadata: { orderId: job.orderId, jobId: job._id },
        });
      }

      const adminUser = await User.findOne({ role: 'admin' });
      if (adminUser) {
        await createNotification({
          userId: adminUser._id,
          title: 'Job Cancelled by Customer',
          message: `Order #${job.orderId} was cancelled by the customer.${payment?.refundStatus === 'pending' ? ` A refund of ${payment.totalAmount} is pending admin action.` : ''}`,
          type: 'admin',
          referenceId: job._id,
          metadata: { orderId: job.orderId, jobId: job._id, refundStatus: payment?.refundStatus },
        });
      }
    } catch (e) {
      console.error('Notification failed:', e.message);
    }

    return res.status(200).json(
      new ApiResponse(200, { job, payment }, 'Job cancelled successfully')
    );
  } catch (error) {
    await session.abortTransaction();
    console.error('Error cancelling job:', error);
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
    }
    return res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
  } finally {
    session.endSession();
  }
}