import mongoose from 'mongoose';
import Job from '../../models/job.model.js';
import Payment from '../../models/payment.model.js';
import Wallet from '../../models/wallet.model.js';
import Provider from '../../models/provider/Provider.model.js';
import User from '../../models/User.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { createNotification } from '../../utils/notification.js';

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
        const { status, search, providerId, customerId } = req.query;

        let query = {};
        if (status) query.status = status;
        if (providerId) query.provider = providerId;
        if (customerId) query.customer = customerId;

        if (search) {
            query.$or = [
                { orderId: { $regex: search, $options: 'i' } }
            ];
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
    const { jobId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(jobId)) {
        throw new ApiError(400, 'Invalid job ID format');
    }

    const job = await Job.findById(jobId)
        .populate('service', 'name price icon description')
        .populate('customer', 'name email phoneNumber')
        .lean();

    if (!job) {
        throw new ApiError(404, 'Job not found');
    }

    if (!job.service) {
        throw new ApiError(400, 'Job service is missing');
    }

    const providers = await Provider.find({
        approvedServices: job.service._id || job.service,
        kycStatus: 'approved',
    })
        .populate({
            path: 'userId',
            select: 'name email phoneNumber profilePicture status',
            match: { status: 'approved' },
        })
        .lean();

    const availability = await getProviderAvailability(providers.filter((provider) => provider.userId), job);
    const availableProviders = availability
        .filter((item) => item.isAvailable && item.matchesService)
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
        }, 'Available providers retrieved successfully')
    );
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

        // Capture provider userId before cancellation clears status
        let providerUserId = null;
        if (job.provider && job.provider.userId) {
            providerUserId = getUserIdValue(job.provider.userId);
        }

        const { transferAmount, adminBalance, providerBalance } = await performJobCancellation(job, session);

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