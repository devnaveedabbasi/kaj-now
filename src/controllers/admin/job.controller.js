import mongoose from 'mongoose';
import Job from '../../models/job.model.js';
import Payment from '../../models/payment.model.js';
import Wallet from '../../models/wallet.model.js';
import Provider from '../../models/provider/Provider.model.js';
import User from '../../models/User.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { createNotification } from '../../utils/notification.js';
import { createActivityLog } from '../../utils/createActivityLog.js';
import ServiceRequest from '../../models/admin/serviceRequest.model.js';
import {
  NON_CANCELLABLE_JOB_STATUSES,
  releaseEscrowForCancellation,
  markPaymentRefundCompleted,
} from '../../utils/jobCancellation.js';
const ACTIVE_JOB_STATUSES = ['pending', 'accepted', 'in_progress'];

function parseTimeToMinutes(timeValue) {
    if (!timeValue) return null;

    const normalized = String(timeValue).trim();
    const match = normalized.match(/^(\d{1,2}):(\d{2})(?:\s*([AP]M))?$/i);

    if (!match) return null;

    let hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const meridiem = match[3]?.toUpperCase();

    if (meridiem === 'PM' && hours !== 12) hours += 12;
    if (meridiem === 'AM' && hours === 12) hours = 0;

    if (hours > 23 || minutes > 59) return null;

    return hours * 60 + minutes;
}

function getDayBounds(dateValue) {
    const date = new Date(dateValue);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    return { startOfDay, endOfDay };
}

function getUserIdValue(user) {
    return user?._id || user || null;
}

async function ensureWallet(session, userId, role) {
    let wallet = await Wallet.findOne({ userId, role }).session(session);

    if (!wallet) {
        [wallet] = await Wallet.create(
            [{
                userId,
                role,
                balance: 0,
                totalEarnings: 0,
                totalWithdrawn: 0,
                totalPlatformFees: 0,
                isActive: true,
            }],
            { session }
        );
    }

    return wallet;
}

async function hasProviderConflict(providerId, scheduleDate, scheduleTime, session, excludedJobId = null) {
    const dayBounds = getDayBounds(scheduleDate);

    if (!dayBounds) {
        throw new ApiError(400, 'Invalid schedule date');
    }

    const requestedMinutes = parseTimeToMinutes(scheduleTime);

    if (requestedMinutes === null) {
        throw new ApiError(400, 'Invalid schedule time format');
    }

    const conflictingJobs = await Job.find({
        provider: providerId,
        status: { $in: ACTIVE_JOB_STATUSES },
        'schedule.date': { $gte: dayBounds.startOfDay, $lt: dayBounds.endOfDay },
        ...(excludedJobId ? { _id: { $ne: excludedJobId } } : {}),
    })
        .select('schedule.time')
        .session(session)
        .lean();

    return conflictingJobs.some((job) => {
        const existingMinutes = parseTimeToMinutes(job.schedule?.time);
        return existingMinutes !== null && Math.abs(requestedMinutes - existingMinutes) < 60;
    });
}

async function getProviderAvailability(providerIds, job, session = null) {
    const scheduleDate = job.schedule?.date;
    const scheduleTime = job.schedule?.time;
    const serviceId = job.service?._id?.toString?.() || job.service?.toString?.();

    if (!scheduleDate || !scheduleTime) {
        throw new ApiError(400, 'Job schedule is missing');
    }

    const availabilityChecks = providerIds.map(async (provider) => {
        const busy = await hasProviderConflict(provider._id, scheduleDate, scheduleTime, session, job._id);
        return {
            provider,
            isAvailable: !busy,
            matchesService: provider.approvedServices?.some((approvedServiceId) => approvedServiceId.toString() === serviceId),
        };
    });

    return Promise.all(availabilityChecks);
}
// Get all jobs with filtering and pagination
export const getAllJobs = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const { status, search, providerId, customerId, region } = req.query;

        let query = {};
        if (status) {
            if (status === 'confirmed_by_user') {
                query.status = { $in: ['confirmed_by_user', 'confirmed_by_admin'] };
            } else {
                query.status = status;
            }
        }
        if (providerId) query.provider = providerId;
        if (customerId) query.customer = customerId;

        if (search) {
            query.$or = [
                { orderId: { $regex: search, $options: 'i' } }
            ];
        }

        // Jobs have no region of their own — derive it from the customer who booked it.
        if (region && ['UK', 'BD'].includes(region)) {
            const regionCustomers = await User.find({ region }).select('_id').lean();
            query.customer = { $in: regionCustomers.map(u => u._id) };
        }

        const [jobs, totalCount] = await Promise.all([
            Job.find(query)
                .populate('customer', 'name email')
                .populate({
                    path: 'provider',
                    populate: { path: 'userId', select: 'name email' }
                })
                .populate('service', 'name')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit),
            Job.countDocuments(query)
        ]);

        const totalPages = Math.ceil(totalCount / limit);

        res.status(200).json(
            new ApiResponse(200, {
                jobs,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: totalCount,
                    itemsPerPage: limit
                }
            }, 'Jobs retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting jobs:', error);
        res.status(500).json(new ApiResponse(500, null, error.message));
    }
};

export const getAvailableProviders = async (req, res) => {
    try {
        const { jobId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(jobId)) {
            throw new ApiError(400, 'Invalid job ID format');
        }

        // Step 1: Job fetch karo with service
        const job = await Job.findById(jobId)
            .populate('service', 'name price icon description')
            .populate('customer', 'name email phoneNumber')
            .lean();

        if (!job) throw new ApiError(404, 'Job not found');
        if (!job.service) throw new ApiError(400, 'Job service is missing');

        const serviceId = job.service._id;

        // Step 2: Providers jo is service ko approvedServices mein rakhte hain
        // aur jinki KYC approved hai aur user account bhi approved hai
        const providers = await Provider.find({
            approvedServices: serviceId,
            kycStatus: 'approved',
        })
            .populate({
                path: 'userId',
                select: 'name email phoneNumber profilePicture status',
                match: { status: 'approved' }, // sirf active users
            })
            .lean();

        // Step 3: userId null wale filter out karo (jo match nahi hue)
        const activeProviders = providers.filter((p) => p.userId !== null);

        // Step 4: ServiceRequest model se double check — provider ka service
        // request approved hona chahiye is serviceId ke liye
        const approvedRequests = await ServiceRequest.find({
            providerId: { $in: activeProviders.map((p) => p._id) },
            serviceId: serviceId,
            status: 'approved',
        }).lean();

        const approvedProviderIds = new Set(
            approvedRequests.map((r) => r.providerId.toString())
        );

        const verifiedProviders = activeProviders.filter((p) =>
            approvedProviderIds.has(p._id.toString())
        );

        // Step 5: Schedule conflict check — koi active job nahi honi chahiye
        // same time slot mein
        const scheduleDate = job.schedule?.date;
        const scheduleTime = job.schedule?.time;

        if (!scheduleDate || !scheduleTime) {
            throw new ApiError(400, 'Job schedule is missing');
        }

        const availabilityResults = await Promise.all(
            verifiedProviders.map(async (provider) => {
                const busy = await hasProviderConflict(
                    provider._id,
                    scheduleDate,
                    scheduleTime,
                    null,       // session nahi chahiye yahan
                    job._id     // current job exclude karo
                );
                return { provider, isAvailable: !busy };
            })
        );

        const availableProviders = availabilityResults
            .filter((item) => item.isAvailable)
            .map(({ provider }) => ({
                _id: provider._id,
                userId: provider.userId,
                location: provider.location || null,
                gender: provider.gender || '',
                kycStatus: provider.kycStatus,
                approvedServices: provider.approvedServices || [],
            }));

        return res.status(200).json(
            new ApiResponse(200, {
                job: {
                    _id: job._id,
                    orderId: job.orderId,
                    status: job.status,
                    schedule: job.schedule,
                    service: job.service,
                },
                availableProviders,
                total: availableProviders.length,
            }, 'Available providers retrieved successfully')
        );

    } catch (error) {
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(
                new ApiResponse(error.statusCode, null, error.message)
            );
        }
        console.error('Error getting available providers:', error);
        return res.status(500).json(new ApiResponse(500, null, error.message));
    }
};

// Get job details by ID
export const getJobById = async (req, res) => {
    try {
        const { jobId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(jobId)) {
            throw new ApiError(400, 'Invalid job ID format');
        }

        const job = await Job.findById(jobId)
            .populate('customer', 'name email phoneNumber profilePicture')
            .populate({
                path: 'provider',
                populate: { path: 'userId', select: 'name email phoneNumber profilePicture' }
            })
            .populate('service', 'name price icon description')
            .populate('serviceRequestId');

        if (!job) {
            throw new ApiError(404, 'Job not found');
        }

        res.status(200).json(
            new ApiResponse(200, job, 'Job details retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting job details:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, error.message));
        }
    }
};

// Admin action to update job status (e.g., cancel or force complete)
export const updateJobStatus = async (req, res) => {
    try {
        const { jobId } = req.params;
        const { status } = req.body;

        if (!mongoose.Types.ObjectId.isValid(jobId)) {
            throw new ApiError(400, 'Invalid job ID format');
        }

        const job = await Job.findById(jobId);
        if (!job) {
            throw new ApiError(404, 'Job not found');
        }

        job.status = status;
        if (status === 'cancelled') job.cancelledAt = new Date();
        if (status === 'confirmed_by_user') job.confirmedByUserAt = new Date();

        await job.save();

        res.status(200).json(
            new ApiResponse(200, job, `Job status updated to ${status} successfully`)
        );
    } catch (error) {
        console.error('Error updating job status:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, error.message));
        }
    }
};

export const markJobAsCompleted = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { jobId } = req.params;

        if (!mongoose.Types.ObjectId.isValid(jobId)) {
            throw new ApiError(400, 'Invalid job ID format');
        }

   const job = await Job.findOneAndUpdate(
    {
        _id: jobId,
        status: {
            $nin: [
                'confirmed_by_admin',
                'confirmed_by_user',
                'cancelled'
            ]
        },
    },
    {
        $set: {
            status: 'confirmed_by_admin',
            confirmedByAdminAt: new Date(),
            paymentStatus: 'released_to_provider',
        },
    },
    { new: true, session }
);

        const blockedStatuses = [
            'confirmed_by_admin',
            'confirmed_by_user',
            'cancelled'
        ];

        if (!job) {
            const existingJob = await Job.findById(jobId);

            if (!existingJob) {
                throw new ApiError(404, 'Job not found');
            }

            if (blockedStatuses.includes(existingJob.status)) {
                throw new ApiError(
                    400,
                    `Job cannot be completed. Current status: ${existingJob.status}`
                );
            }

            throw new ApiError(
                400,
                `Job is not eligible for completion. Current status: ${existingJob.status}`
            );
        }

        // primary STEP 2: Payment validation
        const payment = await Payment.findOne({ jobId }).session(session);
        if (!payment) throw new ApiError(404, 'Payment record not found');

        if (payment.escrowStatus !== 'held_in_admin_wallet') {
            throw new ApiError(400, 'Payment is not in escrow');
        }

        // primary STEP 3: Admin wallet
        const adminUser = await User.findOne({ role: 'admin' }).session(session);
        if (!adminUser) throw new ApiError(500, 'Admin not found');

        const adminWallet = await Wallet.findOne({
            userId: adminUser._id,
            role: 'admin',
        }).session(session);

        if (!adminWallet) throw new ApiError(500, 'Admin wallet not found');

        // primary FIXED: correct balance check
        if (adminWallet.balance < payment.providerAmount) {
            throw new ApiError(400, 'Insufficient admin balance');
        }

        // primary STEP 4: Provider wallet
        let providerWallet = await Wallet.findOne({
            userId: payment.providerId,
            role: 'provider',
        }).session(session);

        if (!providerWallet) {
            [providerWallet] = await Wallet.create(
                [{
                    userId: payment.providerId,
                    role: 'provider',
                    balance: 0,
                    totalEarnings: 0,
                    totalWithdrawn: 0,
                    totalPlatformFees: 0,
                    isActive: true,
                }],
                { session }
            );
        }

        // primary STEP 5: Wallet transactions
        adminWallet.balance -= payment.providerAmount;
        adminWallet.totalHeld = (adminWallet.totalHeld || 0) - payment.totalAmount;
        adminWallet.totalPlatformFees += payment.platformFee;
        await adminWallet.save({ session });

        providerWallet.balance += payment.providerAmount;
        providerWallet.totalEarnings += payment.providerAmount;
        providerWallet.totalPlatformFees += payment.platformFee;
        providerWallet.transactionHistory.push(payment._id);
        await providerWallet.save({ session });

        // primary STEP 6: Update payment
        payment.escrowStatus = 'released_to_provider';
        payment.releasedAt = new Date();
        await payment.save({ session });

        // primary STEP 7: Provider stats
        const provider = await Provider.findById(job.provider).session(session);
        if (provider) {
            await provider.incrementServiceOrderCount(job.service);
        }

        await session.commitTransaction();
        session.endSession();

        // Activity log and Notifications (non-blocking)
        try {
            await createNotification({
                userId: payment.providerId,
                title: 'Payment Released & Order Completed',
                message: `Order #${job.orderId} confirmed by Admin. Amount credited.`,
                type: 'payment',
                referenceId: job._id,
            });
            await createNotification({
                userId: job.customer,
                title: 'Job Completed',
                message: `Order #${job.orderId} confirmed and completed successfully.`,
                type: 'job',
                referenceId: job._id,
            });
        } catch (e) {
            console.error('Notification failed:', e.message);
        }

        res.status(200).json(
            new ApiResponse(200, job, 'Job marked as completed successfully, payment released to provider')
        );
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        console.error('Error marking job as completed:', error);
        if (error instanceof ApiError) {
            res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        } else {
            res.status(500).json(new ApiResponse(500, null, error.message));
        }
    }
};

async function performJobCancellation(job, session) {
    if (job.status === 'cancelled') {
        return { transferAmount: 0 };
    }

    if (job.status === 'in_progress' || job.startedAt) {
        throw new ApiError(400, 'Job cannot be cancelled after it has started');
    }

    let transferAmount = 0;
    let adminWallet = null;
    let providerWallet = null;

    if (job.provider) {
        const adminUser = await User.findOne({ role: 'admin' }).session(session);
        if (!adminUser) {
            throw new ApiError(500, 'Admin user not found');
        }

        const payment = await Payment.findOne({ jobId: job._id }).session(session);
        adminWallet = await ensureWallet(session, adminUser._id, 'admin');

        // Ensure we handle provider as ObjectId or populated object
        const providerId = job.provider._id || job.provider;
        providerWallet = await ensureWallet(session, providerId, 'provider');

        // Note: Transferring the entire balance as per original logic. 
        // Could be changed to job amount if that was intended.
        transferAmount = Number(providerWallet.balance || 0);

        if (transferAmount > 0) {
            providerWallet.balance = 0;
            adminWallet.balance += transferAmount;
            adminWallet.totalEarnings += transferAmount;
        }

        if (payment) {
            adminWallet.transactionHistory.push(payment._id);
            providerWallet.transactionHistory.push(payment._id);
        }

        await adminWallet.save({ session });
        await providerWallet.save({ session });
    }

    job.status = 'cancelled';
    job.cancelledAt = new Date();
    await job.save({ session });

    return {
        transferAmount,
        adminBalance: adminWallet?.balance || 0,
        providerBalance: providerWallet?.balance || 0
    };
}

export const cancelJob = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { jobId } = req.params;
        const { reason } = req.body;

        if (!mongoose.Types.ObjectId.isValid(jobId)) {
            throw new ApiError(400, 'Invalid job ID format');
        }

        const job = await Job.findById(jobId)
            .populate('service', 'name')
            .populate({ path: 'provider', populate: { path: 'userId', select: 'name email' } })
            .session(session);

        if (!job) {
            throw new ApiError(404, 'Job not found');
        }

        if (job.status === 'cancelled') {
            throw new ApiError(400, 'Job is already cancelled');
        }

        if (NON_CANCELLABLE_JOB_STATUSES.includes(job.status)) {
            throw new ApiError(400, `Job cannot be cancelled. Current status: ${job.status}`);
        }

        // Capture provider userId before cancellation clears status
        let providerUserId = null;
        if (job.provider && job.provider.userId) {
            providerUserId = getUserIdValue(job.provider.userId);
        }

        // Stamp unified cancellation metadata BEFORE performJobCancellation saves
        // the job, so it persists in the same write.
        job.cancelledBy = 'admin';
        job.cancelledByUserId = req.user._id;
        job.cancellationReason = reason?.trim() || 'Cancelled by admin';

        const { transferAmount, adminBalance, providerBalance } = await performJobCancellation(job, session);

        // Release the payment's escrow hold for manual refund tracking — this
        // is separate from performJobCancellation() because that helper is
        // also reused by assignProvider() for reassignment, where the
        // customer's payment must stay held (job continues with a new provider).
        const payment = await Payment.findOne({ jobId: job._id }).session(session);
        await releaseEscrowForCancellation(session, payment);

        await session.commitTransaction();

        // Notify provider about cancellation
        if (providerUserId) {
            await createNotification({
                userId: providerUserId,
                title: 'Job Cancelled',
                message: `Your job ${job.orderId ? `#${job.orderId}` : ''} has been cancelled by admin.`,
                type: 'job',
                referenceId: job._id,
                metadata: { action: 'job_cancelled', orderId: job.orderId }
            });
        }

        // Notify customer about cancellation
        const customerUserId = getUserIdValue(job.customer);
        if (customerUserId) {
            await createNotification({
                userId: customerUserId,
                title: 'Job Cancelled',
                message: `Your booking ${job.orderId ? `#${job.orderId}` : ''} has been cancelled by admin.`,
                type: 'job',
                referenceId: job._id,
                metadata: { action: 'job_cancelled', orderId: job.orderId }
            });
        }

        return res.status(200).json(
            new ApiResponse(200, {
                job,
                payment,
                transferAmount,
                adminBalance,
                providerBalance,
            }, 'Job cancelled successfully')
        );
    } catch (error) {
        await session.abortTransaction();

        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }

        console.error('Error cancelling job:', error);
        return res.status(500).json(new ApiResponse(500, null, error.message));
    } finally {
        session.endSession();
    }
};

export const assignProvider = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { jobId } = req.params;
        const { providerId } = req.body;

        if (!mongoose.Types.ObjectId.isValid(jobId)) {
            throw new ApiError(400, 'Invalid job ID format');
        }

        if (!mongoose.Types.ObjectId.isValid(providerId)) {
            throw new ApiError(400, 'Invalid provider ID format');
        }

        const job = await Job.findById(jobId)
            .populate('service', 'name')
            .populate({ path: 'provider', select: 'userId' })
            .session(session);

        if (!job) {
            throw new ApiError(404, 'Job not found');
        }

        let cancelledProviderUserId = null;
        if (job.status !== 'cancelled') {
            if (job.provider && job.provider.userId) {
                cancelledProviderUserId = getUserIdValue(job.provider.userId);
            }
            await performJobCancellation(job, session);
        }

        const provider = await Provider.findById(providerId)
            .populate({ path: 'userId', select: 'name email phoneNumber profilePicture status' })
            .session(session);

        if (!provider) {
            throw new ApiError(404, 'Provider not found');
        }

        if (provider.kycStatus !== 'approved') {
            throw new ApiError(400, 'Provider is not approved');
        }

        if (!provider.userId || provider.userId.status !== 'approved') {
            throw new ApiError(400, 'Provider account is not active');
        }

        const serviceId = job.service?._id?.toString?.() || job.service?.toString?.();
        const approvedServiceIds = (provider.approvedServices || []).map((service) => service.toString());

        if (!approvedServiceIds.includes(serviceId)) {
            throw new ApiError(400, 'Provider is not approved for this service');
        }

        const isBusy = await hasProviderConflict(provider._id, job.schedule?.date, job.schedule?.time, session, job._id);

        if (isBusy) {
            throw new ApiError(409, 'Provider is not available for this time slot');
        }

        job.provider = provider._id;
        job.status = 'pending';
        job.cancelledAt = null;
        job.rejectionReason = null;

        await job.save({ session });
        await session.commitTransaction();

        if (cancelledProviderUserId) {
            await createNotification({
                userId: cancelledProviderUserId,
                title: 'Job Cancelled',
                message: `Your booking ${job.orderId ? `#${job.orderId}` : ''} has been cancelled by admin before reassignment.`,
                type: 'job',
                referenceId: job._id,
                metadata: { action: 'job_cancelled', orderId: job.orderId }
            });
        }

        if (provider.userId) {
            const assignedProviderUserId = getUserIdValue(provider.userId);
            if (assignedProviderUserId) {
                await createNotification({
                    userId: assignedProviderUserId,
                    title: 'New Job Assigned',
                    message: `A new job ${job.orderId ? `#${job.orderId}` : ''} has been assigned to you.`,
                    type: 'job',
                    referenceId: job._id,
                    metadata: { action: 'job_assigned', orderId: job.orderId }
                });
            }
        }

        const customerUserId = getUserIdValue(job.customer);
        if (customerUserId) {
            await createNotification({
                userId: customerUserId,
                title: 'Job Reassigned',
                message: `Your booking ${job.orderId ? `#${job.orderId}` : ''} has been reassigned to a new provider.`,
                type: 'job',
                referenceId: job._id,
                metadata: { action: 'job_assigned', orderId: job.orderId }
            });
        }

        const populatedJob = await Job.findById(job._id)
            .populate('customer', 'name email phoneNumber profilePicture')
            .populate({
                path: 'provider',
                populate: { path: 'userId', select: 'name email phoneNumber profilePicture' },
            })
            .populate('service', 'name price icon description');

        return res.status(200).json(
            new ApiResponse(200, populatedJob, 'Provider assigned successfully')
        );
    } catch (error) {
        await session.abortTransaction();

        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }

        console.error('Error assigning provider:', error);
        return res.status(500).json(new ApiResponse(500, null, error.message));
    } finally {
        session.endSession();
    }
};

// ─────────────────────────────────────────────────────────────
// GET /api/admin/jobs/cancelled
// Unified view of every cancelled job — regardless of whether it was
// cancelled by the customer, the provider (cancel or reject), the admin,
// or automatically by the system (cron timeout).
// ─────────────────────────────────────────────────────────────
export const getCancelledJobs = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        const { cancelledBy, refundStatus, region, search } = req.query;

        const query = { status: { $in: ['cancelled', 'rejected_by_provider'] } };

        if (cancelledBy && ['customer', 'provider', 'admin', 'system'].includes(cancelledBy)) {
            query.cancelledBy = cancelledBy;
        }

        if (search) {
            query.orderId = { $regex: search, $options: 'i' };
        }

        // Jobs have no region of their own — derive it from the customer who booked it.
        if (region && ['UK', 'BD'].includes(region)) {
            const regionCustomers = await User.find({ region }).select('_id').lean();
            query.customer = { $in: regionCustomers.map((u) => u._id) };
        }

        if (refundStatus && ['not_applicable', 'pending', 'completed'].includes(refundStatus)) {
            const matchingPayments = await Payment.find({ refundStatus }).select('jobId').lean();
            query._id = { $in: matchingPayments.map((p) => p.jobId) };
        }

        const [jobs, totalCount] = await Promise.all([
            Job.find(query)
                .populate('customer', 'name email phone')
                .populate({ path: 'provider', populate: { path: 'userId', select: 'name email' } })
                .populate('service', 'name')
                .populate('cancelledByUserId', 'name email role')
                .sort({ cancelledAt: -1, createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            Job.countDocuments(query),
        ]);

        const payments = await Payment.find({ jobId: { $in: jobs.map((j) => j._id) } }).lean();
        const paymentByJobId = new Map(payments.map((p) => [p.jobId.toString(), p]));

        const formattedJobs = jobs.map((job) => {
            const payment = paymentByJobId.get(job._id.toString()) || null;
            return {
                _id: job._id,
                orderId: job.orderId,
                status: job.status,
                service: job.service ? { _id: job.service._id, name: job.service.name } : null,
                customer: job.customer
                    ? { _id: job.customer._id, name: job.customer.name, email: job.customer.email, phone: job.customer.phone }
                    : null,
                provider: job.provider
                    ? { _id: job.provider._id, name: job.provider.userId?.name, email: job.provider.userId?.email }
                    : null,
                amount: job.amount,
                // Legacy jobs cancelled before this feature shipped have no cancelledBy —
                // they could only have come from the automatic cron timeout.
                cancelledBy: job.cancelledBy || 'system',
                cancelledByUser: job.cancelledByUserId
                    ? { _id: job.cancelledByUserId._id, name: job.cancelledByUserId.name, email: job.cancelledByUserId.email }
                    : null,
                cancellationReason: job.cancellationReason || job.rejectionReason || null,
                cancelledAt: job.cancelledAt,
                createdAt: job.createdAt,
                payment: payment
                    ? {
                        _id: payment._id,
                        totalAmount: payment.totalAmount,
                        platformFee: payment.platformFee,
                        paymentStatus: payment.paymentStatus,
                        escrowStatus: payment.escrowStatus,
                        refundStatus: payment.refundStatus,
                        refundMarkedAt: payment.refundMarkedAt,
                        refundNote: payment.refundNote,
                        refundedAt: payment.refundedAt,
                    }
                    : null,
            };
        });

        const [bySourceAgg, byRefundAgg, total] = await Promise.all([
            Job.aggregate([
                { $match: { status: { $in: ['cancelled', 'rejected_by_provider'] } } },
                { $group: { _id: '$cancelledBy', count: { $sum: 1 } } },
            ]),
            Payment.aggregate([
                { $match: { refundStatus: { $in: ['pending', 'completed'] } } },
                { $group: { _id: '$refundStatus', count: { $sum: 1 } } },
            ]),
            Job.countDocuments({ status: { $in: ['cancelled', 'rejected_by_provider'] } }),
        ]);

        const stats = {
            total,
            byCustomer: 0,
            byProvider: 0,
            byAdmin: 0,
            bySystem: 0,
            refundPending: 0,
            refundCompleted: 0,
        };

        bySourceAgg.forEach((s) => {
            if (s._id === 'customer') stats.byCustomer = s.count;
            else if (s._id === 'provider') stats.byProvider = s.count;
            else if (s._id === 'admin') stats.byAdmin = s.count;
            else stats.bySystem += s.count; // 'system' or legacy null
        });

        byRefundAgg.forEach((r) => {
            if (r._id === 'pending') stats.refundPending = r.count;
            if (r._id === 'completed') stats.refundCompleted = r.count;
        });

        const totalPages = Math.ceil(totalCount / limit);

        return res.status(200).json(
            new ApiResponse(200, {
                jobs: formattedJobs,
                stats,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems: totalCount,
                    itemsPerPage: limit,
                },
            }, 'Cancelled jobs retrieved successfully')
        );
    } catch (error) {
        console.error('Error getting cancelled jobs:', error);
        return res.status(500).json(new ApiResponse(500, null, error.message));
    }
};

// ─────────────────────────────────────────────────────────────
// PATCH /api/admin/jobs/cancelled/:jobId/refund
// Admin has manually sent the refund to the customer OUTSIDE the system
// (bank transfer, mobile wallet, etc.) and marks it as done here. This is
// the only step that actually reduces the admin wallet balance for a
// cancellation — nothing is auto-sent to the customer.
// ─────────────────────────────────────────────────────────────
export const markRefundStatus = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { jobId } = req.params;
        const { note } = req.body;

        if (!mongoose.Types.ObjectId.isValid(jobId)) {
            throw new ApiError(400, 'Invalid job ID format');
        }

        const job = await Job.findById(jobId).session(session);
        if (!job) throw new ApiError(404, 'Job not found');

        if (!['cancelled', 'rejected_by_provider'].includes(job.status)) {
            throw new ApiError(400, 'Refunds can only be marked for cancelled jobs');
        }

        const payment = await Payment.findOne({ jobId: job._id }).session(session);
        if (!payment) throw new ApiError(404, 'Payment record not found');

        if (payment.refundStatus !== 'pending') {
            throw new ApiError(400, `Refund cannot be marked. Current refund status: ${payment.refundStatus}`);
        }

        await markPaymentRefundCompleted(session, payment, {
            adminUserId: req.user._id,
            note: note?.trim() || null,
        });

        job.paymentStatus = 'refunded_to_customer';
        await job.save({ session });

        await session.commitTransaction();

        try {
            await createActivityLog({
                userId: req.user._id,
                action: 'JOB_REFUND_MARKED_SENT',
                entityType: 'Payment',
                entityId: payment._id,
                details: { jobId: job._id, orderId: job.orderId, amount: payment.totalAmount, note },
                req,
            });
        } catch (e) {
            console.error('Activity log failed:', e.message);
        }

        try {
            await createNotification({
                userId: job.customer,
                title: 'Refund Sent',
                message: `Your refund of ${payment.totalAmount} for Order #${job.orderId} has been sent.`,
                type: 'payment',
                referenceId: job._id,
                metadata: { orderId: job.orderId, jobId: job._id, amount: payment.totalAmount },
            });
        } catch (e) {
            console.error('Notification failed:', e.message);
        }

        return res.status(200).json(
            new ApiResponse(200, { job, payment }, 'Refund marked as sent successfully')
        );
    } catch (error) {
        await session.abortTransaction();

        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
        }

        console.error('Error marking refund status:', error);
        return res.status(500).json(new ApiResponse(500, null, error.message));
    } finally {
        session.endSession();
    }
};