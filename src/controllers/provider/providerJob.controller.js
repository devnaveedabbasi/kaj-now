import mongoose from 'mongoose';
import { Job } from '../../models/Job.model.js';
import { Wallet } from '../../models/Wallet.model.js';
import { Withdrawal } from '../../models/Withdrawal.model.js';

/**
 * Get provider's jobs
 */
export async function getMyJobs(req, res) {
  try {
    const providerId = req.user._id;
    const { status, page = 1, limit = 10 } = req.query;

    // Find provider profile
    const Provider = mongoose.model('Provider');
    const provider = await Provider.findOne({ userId: providerId });
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider profile not found.' });
    }

    const query = { provider: provider._id };
    if (status) {
      query.status = status;
    }

    const jobs = await Job.find(query)
      .populate({
        path: 'service',
        select: 'name price durationMinutes',
        populate: { path: 'serviceCategory', select: 'name' }
      })
      .populate({
        path: 'customer',
        select: 'name email phone'
      })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Job.countDocuments(query);

    return res.json({
      success: true,
      data: {
        provider: {
          _id: provider._id,
          fullName: provider.fullName,
          location: provider.location || null,
          city: provider.city,
          state: provider.state,
          country: provider.country,
        },
        jobs: jobs.map(job => ({
          _id: job._id,
          title: job.title,
          description: job.description,
          amount: job.amount,
          advancePayment: job.advancePayment,
          status: job.status,
          paymentStatus: job.paymentStatus,
          scheduledAt: job.scheduledAt,
          completedAt: job.completedAt,
          serviceLocation: job.serviceLocation,
          providerLocation: provider.location || null,
          createdAt: job.createdAt,
          service: {
            name: job.service?.name,
            price: job.service?.price,
            category: job.service?.serviceCategory?.name,
          },
          customer: {
            name: job.customer?.name,
            email: job.customer?.email,
            phone: job.customer?.phone,
          }
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
    console.error('getMyJobs:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to load jobs.' });
  }
}

/**
 * Accept a job booking (provider accepts the service from customer)
 */
export async function acceptJob(req, res) {
  try {
    const { jobId } = req.params;
    const providerId = req.user._id;

    // Find provider profile
    const Provider = mongoose.model('Provider');
    const provider = await Provider.findOne({ userId: providerId });
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider profile not found.' });
    }

    const job = await Job.findOne({ _id: jobId, provider: provider._id });
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found.' });
    }

    // Job must be pending to accept
    if (job.status !== 'pending') {
      return res.status(400).json({ 
        success: false, 
        message: `Cannot accept job with status '${job.status}'. Job must be in pending state.` 
      });
    }

    job.status = 'accepted';
    job.acceptedAt = new Date();
    await job.save();

    await job.populate([
      { path: 'service', select: 'name price durationMinutes' },
      { path: 'customer', select: 'name email phone' }
    ]);

    return res.json({
      success: true,
      message: 'Job accepted successfully. You can now start the job.',
      data: {
        job: {
          _id: job._id,
          title: job.title,
          status: job.status,
          acceptedAt: job.acceptedAt,
          amount: job.amount,
          customer: job.customer,
          service: job.service,
        }
      },
    });
  } catch (err) {
    console.error('acceptJob:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to accept job.' });
  }
}

/**
 * Update job status (provider can start job or mark as completed)
 */
export async function updateJobStatus(req, res) {
  try {
    const { jobId } = req.params;
    const { status, notes } = req.body;
    const providerId = req.user._id;

    if (!['in_progress', 'completed'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status. Must be in_progress or completed.' });
    }

    // Find provider profile
    const Provider = mongoose.model('Provider');
    const provider = await Provider.findOne({ userId: providerId });
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider profile not found.' });
    }

    const job = await Job.findOne({ _id: jobId, provider: provider._id });
    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found.' });
    }

    // Validate status transitions
    if (status === 'in_progress' && job.status !== 'accepted') {
      return res.status(400).json({ success: false, message: 'Job must be accepted first to start. Please accept the job from pending state.' });
    }

    if (status === 'completed' && job.status !== 'in_progress') {
      return res.status(400).json({ success: false, message: 'Job must be in progress to complete.' });
    }

    job.status = status;
    if (status === 'completed') {
      job.completedAt = new Date();

      // Add amount to provider's wallet
      const wallet = await Wallet.findOneAndUpdate(
        { userId: providerId },
        {
          $inc: { balance: job.amount },
          $push: {
            transactions: {
              type: 'credit',
              amount: job.amount,
              description: `Job completed: ${job.title}`,
              jobId: job._id,
            }
          }
        },
        { upsert: true, new: true }
      );
    }
    await job.save();

    return res.json({
      success: true,
      message: `Job ${status === 'in_progress' ? 'started' : 'completed'} successfully.`,
      data: {
        job: {
          _id: job._id,
          status: job.status,
          completedAt: job.completedAt,
        }
      },
    });
  } catch (err) {
    console.error('updateJobStatus:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update job status.' });
  }
}

/**
 * Get provider's wallet
 */
export async function getWallet(req, res) {
  try {
    const providerId = req.user._id;

    const wallet = await Wallet.findOne({ userId: providerId }).lean();
    if (!wallet) {
      return res.json({
        success: true,
        data: {
          balance: 0,
          transactions: [],
        },
      });
    }

    return res.json({
      success: true,
      data: {
        balance: wallet.balance,
        transactions: wallet.transactions?.slice(-20) || [], // Last 20 transactions
      },
    });
  } catch (err) {
    console.error('getWallet:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to load wallet.' });
  }
}

/**
 * Get detailed job information
 */
export async function getJobDetails(req, res) {
  try {
    const { jobId } = req.params;
    const providerId = req.user._id;

    // Find provider profile
    const Provider = mongoose.model('Provider');
    const provider = await Provider.findOne({ userId: providerId });
    if (!provider) {
      return res.status(404).json({ success: false, message: 'Provider profile not found.' });
    }

    // Get job with all related data
    const job = await Job.findOne({ _id: jobId, provider: provider._id })
      .populate({
        path: 'service',
        select: 'name price durationMinutes description',
        populate: [
          { path: 'serviceCategory', select: 'name icon' },
          { path: 'serviceSubcategories', select: 'name icon' }
        ]
      })
      .populate({
        path: 'customer',
        select: 'name email phone',
        populate: {
          path: 'customerProfile',
          select: 'totalBookings permanentAddress city state country location'
        }
      })
      .populate({
        path: 'provider',
        select: 'fullName rating isAvailable isProfileComplete permanentAddress city state country location',
        populate: { path: 'userId', select: 'name email phone' }
      });

    if (!job) {
      return res.status(404).json({ success: false, message: 'Job not found.' });
    }

    // Format the response with comprehensive details
    const jobDetails = {
      _id: job._id,
      title: job.title,
      description: job.description,
      amount: job.amount,
      status: job.status,
      paymentStatus: job.paymentStatus,
      scheduledAt: job.scheduledAt,
      completedAt: job.completedAt,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,

      // Service details
      service: job.service ? {
        _id: job.service._id,
        name: job.service.name,
        price: job.service.price,
        durationMinutes: job.service.durationMinutes,
        description: job.service.description,
        category: job.service.serviceCategory,
        subcategories: job.service.serviceSubcategories,
      } : null,

      // Customer details
      customer: job.customer ? {
        _id: job.customer._id,
        name: job.customer.name,
        email: job.customer.email,
        phone: job.customer.phone,
        totalBookings: job.customer.customerProfile?.totalBookings || 0,
        address: {
          permanentAddress: job.customer.customerProfile?.permanentAddress,
          city: job.customer.customerProfile?.city,
          state: job.customer.customerProfile?.state,
          country: job.customer.customerProfile?.country,
        },
        location: job.customer.customerProfile?.location ? {
          type: job.customer.customerProfile.location.type,
          coordinates: job.customer.customerProfile.location.coordinates,
          // Convert to lat/lng format for easier use
          latitude: job.customer.customerProfile.location.coordinates?.[1] || null,
          longitude: job.customer.customerProfile.location.coordinates?.[0] || null,
        } : null,
      } : null,

      // Provider details (current user)
      provider: job.provider ? {
        _id: job.provider._id,
        fullName: job.provider.fullName,
        rating: job.provider.rating,
        isAvailable: job.provider.isAvailable,
        isProfileComplete: job.provider.isProfileComplete,
        user: {
          name: job.provider.userId?.name,
          email: job.provider.userId?.email,
          phone: job.provider.userId?.phone,
        },
        address: {
          permanentAddress: job.provider.permanentAddress,
          city: job.provider.city,
          state: job.provider.state,
          country: job.provider.country,
        },
        location: job.provider.location ? {
          type: job.provider.location.type,
          coordinates: job.provider.location.coordinates,
          // Convert to lat/lng format for easier use
          latitude: job.provider.location.coordinates?.[1] || null,
          longitude: job.provider.location.coordinates?.[0] || null,
        } : null,
      } : null,

      // Job timeline
      timeline: {
        created: job.createdAt,
        scheduled: job.scheduledAt,
        completed: job.completedAt,
      },

      // Service location (where to provide the service)
      serviceLocation: job.serviceLocation ? {
        name: job.serviceLocation.name,
        phoneNumber: job.serviceLocation.phoneNumber,
        houseNumber: job.serviceLocation.houseNumber,
        address: job.serviceLocation.address,
        city: job.serviceLocation.city,
        postalCode: job.serviceLocation.postalCode,
        coordinates: {
          latitude: job.serviceLocation.coordinates.latitude,
          longitude: job.serviceLocation.coordinates.longitude,
        },
      } : null,

      // Payment info
      payment: {
        amount: job.amount,
        status: job.paymentStatus,
        currency: job.currency || 'PKR',
      },
    };

    return res.json({
      success: true,
      data: jobDetails,
    });
  } catch (err) {
    console.error('getJobDetails:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to load job details.' });
  }
}

/**
 * Request withdrawal
 */
export async function requestWithdrawal(req, res) {
  try {
    const providerId = req.user._id;
    const { amount, paymentMethod, accountDetails } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ success: false, message: 'Valid amount is required.' });
    }

    if (!paymentMethod || !['bank_transfer', 'other'].includes(paymentMethod)) {
      return res.status(400).json({ success: false, message: 'Valid payment method is required.' });
    }

    const wallet = await Wallet.findOne({ userId: providerId });
    if (!wallet || wallet.balance < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient wallet balance.' });
    }

    // Create withdrawal request
    const withdrawal = new Withdrawal({
      userId: providerId,
      amount,
      paymentMethod: {
        type: paymentMethod,
        accountDetails: accountDetails || '',
      },
    });

    await withdrawal.save();

    // Deduct from wallet
    wallet.balance -= amount;
    wallet.transactions.push({
      type: 'debit',
      amount,
      description: `Withdrawal request: ${amount}`,
      withdrawalId: withdrawal._id,
    });
    await wallet.save();

    return res.status(201).json({
      success: true,
      message: 'Withdrawal request submitted successfully.',
      data: {
        withdrawal: {
          _id: withdrawal._id,
          amount: withdrawal.amount,
          status: withdrawal.status,
          paymentMethod: withdrawal.paymentMethod,
          createdAt: withdrawal.createdAt,
        },
        wallet: {
          balance: wallet.balance,
        }
      },
    });
  } catch (err) {
    console.error('requestWithdrawal:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to request withdrawal.' });
  }
}

/**
 * Get provider's withdrawal requests
 */
export async function getMyWithdrawals(req, res) {
  try {
    const providerId = req.user._id;
    const { page = 1, limit = 10 } = req.query;

    const withdrawals = await Withdrawal.find({ userId: providerId })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Withdrawal.countDocuments({ userId: providerId });

    return res.json({
      success: true,
      data: {
        withdrawals: withdrawals.map(w => ({
          _id: w._id,
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
    console.error('getMyWithdrawals:', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to load withdrawals.' });
  }
}