import Job from "../../models/job.model.js";
import { ApiError } from "../../utils/errorHandler.js";
import { ApiResponse } from "../../utils/apiResponse.js";
import mongoose from "mongoose";

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
