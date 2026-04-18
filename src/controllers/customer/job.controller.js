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
import { processSSLCommerzPayment } from '../../utils/sslcommerz.js';
import { createNotification } from '../../utils/createNotification.js';


async function generateOrderId() {
  const count = await Job.countDocuments();
  const padded = String(count + 1).padStart(3, '0');
  return `OR-${padded}`;
}


// Card validation helper functions
const validateCardNumber = (cardNumber) => {
  // Remove spaces and dashes
  const cleaned = cardNumber.replace(/[\s-]/g, '');

  // Check length (13-19 digits)
  if (cleaned.length < 13 || cleaned.length > 19) {
    return { isValid: false, message: 'Card number must be between 13-19 digits' };
  }

  // Check if only numbers
  if (!/^\d+$/.test(cleaned)) {
    return { isValid: false, message: 'Card number must contain only digits' };
  }

  // Luhn algorithm (basic card validation)
  let sum = 0;
  let isEven = false;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    let digit = parseInt(cleaned.charAt(i), 10);
    if (isEven) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    isEven = !isEven;
  }

  if (sum % 10 !== 0) {
    return { isValid: false, message: 'Invalid card number' };
  }

  // Detect card type
  let cardType = 'unknown';
  if (/^4/.test(cleaned)) cardType = 'visa';
  else if (/^5[1-5]/.test(cleaned)) cardType = 'mastercard';
  else if (/^3[47]/.test(cleaned)) cardType = 'amex';
  else if (/^6(?:011|5)/.test(cleaned)) cardType = 'discover';

  return { isValid: true, cardType, cleaned };
};

const validateExpiryDate = (expiryDate) => {
  // Check format MM/YY or MM/YYYY
  const patterns = [
    /^(0[1-9]|1[0-2])\/(\d{2})$/,
    /^(0[1-9]|1[0-2])\/(\d{4})$/
  ];

  let match = null;
  for (const pattern of patterns) {
    match = expiryDate.match(pattern);
    if (match) break;
  }

  if (!match) {
    return { isValid: false, message: 'Invalid expiry date format. Use MM/YY or MM/YYYY' };
  }

  const month = parseInt(match[1], 10);
  let year = parseInt(match[2], 10);

  // Convert 2-digit year to 4-digit
  if (year < 100) year += 2000;

  // Check month range
  if (month < 1 || month > 12) {
    return { isValid: false, message: 'Invalid month' };
  }

  // Check if card is expired
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  if (year < currentYear || (year === currentYear && month < currentMonth)) {
    return { isValid: false, message: 'Card has expired' };
  }

  // Check if expiry is too far (max 10 years)
  if (year > currentYear + 10) {
    return { isValid: false, message: 'Invalid expiry date' };
  }

  return { isValid: true, month, year };
};

const validateCVV = (cvv, cardType = null) => {
  // Remove spaces
  const cleaned = cvv.replace(/\s/g, '');

  // Check if only numbers
  if (!/^\d+$/.test(cleaned)) {
    return { isValid: false, message: 'CVV must contain only digits' };
  }

  // Amex has 4-digit CVV, others have 3-digit
  const expectedLength = cardType === 'amex' ? 4 : 3;

  if (cleaned.length !== expectedLength) {
    return {
      isValid: false,
      message: `CVV must be ${expectedLength} digits for ${cardType === 'amex' ? 'American Express' : 'this card type'}`
    };
  }

  return { isValid: true, cvv: cleaned };
};

const validateCardHolderName = (name) => {
  if (!name || name.trim().length < 3) {
    return { isValid: false, message: 'Card holder name is required (min 3 characters)' };
  }

  if (name.trim().length > 50) {
    return { isValid: false, message: 'Card holder name is too long' };
  }

  // Allow letters, spaces, dots, and hyphens
  if (!/^[a-zA-Z\s\.\-]+$/.test(name.trim())) {
    return { isValid: false, message: 'Invalid card holder name' };
  }

  return { isValid: true, name: name.trim() };
};

// Main validation function
const validateCardDetails = (cardDetails) => {
  const errors = [];

  // Check if cardDetails exists
  if (!cardDetails) {
    throw new ApiError(400, 'Card details are required');
  }

  // Validate card number
  const cardNumberValidation = validateCardNumber(cardDetails.cardNumber);
  if (!cardNumberValidation.isValid) {
    errors.push(cardNumberValidation.message);
  }

  // Validate expiry date
  const expiryValidation = validateExpiryDate(cardDetails.expiryDate);
  if (!expiryValidation.isValid) {
    errors.push(expiryValidation.message);
  }

  // Validate CVV (with card type from card number validation)
  const cvvValidation = validateCVV(cardDetails.cvv, cardNumberValidation.cardType);
  if (!cvvValidation.isValid) {
    errors.push(cvvValidation.message);
  }

  // Validate card holder name
  const nameValidation = validateCardHolderName(cardDetails.cardHolderName);
  if (!nameValidation.isValid) {
    errors.push(nameValidation.message);
  }

  if (errors.length > 0) {
    throw new ApiError(400, errors.join('. '));
  }

  return {
    isValid: true,
    cardNumber: cardNumberValidation.cleaned,
    cardType: cardNumberValidation.cardType,
    expiryMonth: expiryValidation.month,
    expiryYear: expiryValidation.year,
    cvv: cvvValidation.cvv,
    cardHolderName: nameValidation.name
  };
};





export async function bookJob(req, res) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const userId = req.user._id;
    const { serviceId, providerId, cardDetails } = req.body;

    // ── Validation ──────────────────────────────────────────────────────────
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

    const validatedCard = validateCardDetails(cardDetails);


    // ── Fetch documents ─────────────────────────────────────────────────────
    const user = await User.findById(userId).session(session);
    if (!user) throw new ApiError(404, 'User not found');

    const service = await Service.findById(serviceId).session(session);
    if (!service || !service.isActive) throw new ApiError(404, 'Service not available');

    const provider = await Provider.findById(providerId).session(session);
    if (!provider) throw new ApiError(404, 'Provider not found');

    const serviceRequest = await ServiceRequest.findOne({
      serviceId,
      providerId,
      status: 'approved',
    }).session(session);

    if (!serviceRequest) throw new ApiError(400, 'Provider not approved for this service');

    // ── Duplicate check ─────────────────────────────────────────────────────
    const existingJob = await Job.findOne({
      customer: userId,
      service: serviceId,
      provider: providerId,
      status: { $in: ['pending', 'accepted', 'in_progress'] },
    }).session(session);

    if (existingJob) throw new ApiError(408, 'Already have an active booking for this service');

    // ── Price calculation ───────────────────────────────────────────────────
    const servicePrice = service.price;
    const platformFeePercentage = parseFloat(process.env.PLATFORM_FEE_PERCENTAGE || '10');
    // Platform fee is deducted at withdrawal time, not at booking time.
    // providerAmount is calculated properly at withdrawal.
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
          paymentGateway: 'sslcommerz',
          paymentStatus: 'pending',
          escrowStatus: 'pending',
        },
      ],
      { session }
    );

    // ── SSLCommerz payment ──────────────────────────────────────────────────
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

    // ── Update payment & job after gateway success ──────────────────────────
    payment[0].paymentStatus = 'completed';
    payment[0].escrowStatus = 'held_in_admin_wallet';
    payment[0].sslCommerzTransactionId = paymentData.tran_id;
    payment[0].sslCommerzReference = sslResponse.sessionkey;
    await payment[0].save({ session });

    job[0].paymentStatus = 'held_in_escrow';
    await job[0].save({ session });

    // ── Admin wallet (escrow) ───────────────────────────────────────────────
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
          totalHeld: 0,  // NEW: Track held amount
          isActive: true
        }],
        { session }
      );
    }

    // ONLY HOLD the amount, NOT add to earnings
    adminWallet.balance += servicePrice;  // Held in escrow
    adminWallet.totalHeld = (adminWallet.totalHeld || 0) + servicePrice;  // Track held amount
    adminWallet.transactionHistory.push(payment[0]._id);
    await adminWallet.save({ session });

    await session.commitTransaction();

    // ── Notifications (outside transaction — non-critical) ──────────────────
    // Notify customer
    await createNotification({
      userId: userId,
      title: 'Booking Confirmed',
      message: `Your booking for "${service.name}" (Order #${orderId}) has been placed successfully. Awaiting provider confirmation.`,
      type: 'job',
      referenceId: job[0]._id,
      metadata: { orderId, jobId: job[0]._id },
    });

    // Notify provider's user account
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

    job.status = 'accepted';
    job.acceptedAt = new Date();
    await job.save({ session });

    await session.commitTransaction();

    // ── Notifications ────────────────────────────────────────────────────────
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
  session.startTransaction();

  try {
    const { jobId } = req.params;
    const customerId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(jobId)) throw new ApiError(400, 'Invalid job ID');

    const job = await Job.findById(jobId).populate('service', 'name').session(session);
    if (!job) throw new ApiError(404, 'Job not found');

    if (job.customer.toString() !== customerId.toString()) {
      throw new ApiError(403, 'Not authorized to confirm this job');
    }

    if (job.status !== 'completed_by_provider') {
      throw new ApiError(400, `Job must be completed by provider first. Current: ${job.status}`);
    }

    const payment = await Payment.findOne({ jobId }).session(session);
    if (!payment) throw new ApiError(404, 'Payment record not found');

    if (payment.escrowStatus !== 'held_in_admin_wallet') {
      throw new ApiError(400, 'Payment is not in escrow');
    }

    const adminUser = await User.findOne({ role: 'admin' }).session(session);
    if (!adminUser) throw new ApiError(500, 'Admin not found');

    const adminWallet = await Wallet.findOne({ userId: adminUser._id, role: 'admin' }).session(session);
    if (!adminWallet) throw new ApiError(500, 'Admin wallet not found');

    if (adminWallet.balance < payment.totalAmount) {
      throw new ApiError(400, 'Insufficient balance in admin wallet');
    }

    // ── Get / create provider wallet ─────────────────────────────────────────
    let providerWallet = await Wallet.findOne({ userId: payment.providerId, role: 'provider' }).session(session);

    if (!providerWallet) {
      [providerWallet] = await Wallet.create(
        [{ userId: payment.providerId, role: 'provider', balance: 0, totalEarnings: 0, totalWithdrawn: 0, totalPlatformFees: 0, isActive: true }],
        { session }
      );
    }

    // ── Deduct from admin wallet ─────────────────────────────────────────────
    adminWallet.balance -= payment.totalAmount;
    adminWallet.totalPlatformFees += payment.platformFee;
    await adminWallet.save({ session });

    // ── Credit provider wallet with FULL amount ──────────────────────────────
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

    // ── INCREMENT SERVICE ORDER COUNT FOR PROVIDER ──────────────────────────
    const provider = await Provider.findById(job.provider).session(session);
    if (provider) {
      await provider.incrementServiceOrderCount(job.service);
    }

    await session.commitTransaction();

    // ── Notifications ────────────────────────────────────────────────────────
    if (provider) {
      await createNotification({
        userId: provider.userId,
        title: 'Payment Released & Order Completed',
        message: `Customer confirmed job completion for Order #${job.orderId}. BDT ${payment.providerAmount} has been credited to your wallet. Total orders completed: ${provider.totalOrdersCompleted}`,
        type: 'payment',
        referenceId: job._id,
        metadata: { orderId: job.orderId, jobId: job._id, amount: payment.providerAmount },
      });
    }

    await createNotification({
      userId: customerId,
      title: 'Job Completed',
      message: `Thank you! Order #${job.orderId} has been marked as complete. We hope you enjoyed the service.`,
      type: 'job',
      referenceId: job._id,
      metadata: { orderId: job.orderId, jobId: job._id },
    });

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
        providerStats: provider ? {
          totalOrdersCompleted: provider.totalOrdersCompleted,
          serviceOrdersCount: Object.fromEntries(provider.serviceOrdersCount)
        } : null
      },
    });
  } catch (error) {
    await session.abortTransaction();
    return res.status(error.statusCode || 500).json({ success: false, message: error.message });
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