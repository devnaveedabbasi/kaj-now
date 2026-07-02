import Complaint from '../models/complaint.model.js';
import User from '../models/User.model.js';
import { ApiError } from '../utils/errorHandler.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { sendComplaintReplyEmail } from '../service/emailService.js';

const VALID_TYPES = ['provider_behavior', 'provider_issue', 'technical_issue',
        'service_quality', 'late_arrival', 'payment_issue', 'other'];

// ─────────────────────────────────────────────────────────────
// POST /api/complaint
// Customer complaint submit karta hai
// ─────────────────────────────────────────────────────────────
export async function submitComplaint(req, res) {
  try {
    const { type, description } = req.body;
    const userId = req.user._id;

    if (!type || !VALID_TYPES.includes(type)) {
      throw new ApiError(400, `Invalid type. Must be one of: ${VALID_TYPES.join(', ')}`);
    }
    if (!description?.trim()) {
      throw new ApiError(400, 'Description is required');
    }

    const complaint = await Complaint.create({
      userId,
      type,
      description: description.trim(),
    });

    return res.status(201).json(
      new ApiResponse(201, complaint, 'Complaint submitted successfully')
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, 'Failed to submit complaint');
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/complaint
// Customer apni complaints dekhta hai
// ─────────────────────────────────────────────────────────────
export async function getMyComplaints(req, res) {
  try {
    const userId = req.user._id;

    const complaints = await Complaint.find({ userId })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json(
      new ApiResponse(200, complaints, 'Complaints fetched')
    );
  } catch (error) {
    throw new ApiError(500, 'Failed to fetch complaints');
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN: GET /api/complaint/all
// Sab complaints — filter: ?status=pending&type=technical_issue
// ─────────────────────────────────────────────────────────────
export async function getAllComplaints(req, res) {
  try {
    const { status, type } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;

    const complaints = await Complaint.find(filter)
      .populate('userId', 'name email phone profilePicture role')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json(
      new ApiResponse(200, complaints, 'All complaints fetched')
    );
  } catch (error) {
    throw new ApiError(500, 'Failed to fetch complaints');
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN: GET /api/complaint/:id
// Single complaint detail
// ─────────────────────────────────────────────────────────────
export async function getComplaintById(req, res) {
  try {
    const complaint = await Complaint.findById(req.params.id)
      .populate('userId', 'name email phone profilePicture role')
      .lean();

    if (!complaint) throw new ApiError(404, 'Complaint not found');

    return res.status(200).json(
      new ApiResponse(200, complaint, 'Complaint fetched')
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, 'Failed to fetch complaint');
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN: POST /api/complaint/:id/reply
// Admin reply karta hai — email bhi jata hai user ko
// ─────────────────────────────────────────────────────────────
export async function replyToComplaint(req, res) {
  try {
    const { reply } = req.body;
    if (!reply?.trim()) throw new ApiError(400, 'Reply text is required');

    const complaint = await Complaint.findById(req.params.id)
      .populate('userId', 'name email');

    if (!complaint) throw new ApiError(404, 'Complaint not found');

    // Save reply
    complaint.adminReply = reply.trim();
    complaint.repliedAt = new Date();
    complaint.status = 'seen';
    await complaint.save();

    // Email bhejo user ko
    await sendComplaintReplyEmail(complaint.userId.email, {
      userName: complaint.userId.name,
      complaintType: complaint.type,
      complaintDescription: complaint.description,
      adminReply: reply.trim(),
    });

    return res.status(200).json(
      new ApiResponse(200, complaint, 'Reply sent and email delivered to user')
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, 'Failed to send reply');
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN: PATCH /api/complaint/:id/status
// Status update: pending → in_progress → resolved
// ─────────────────────────────────────────────────────────────
export async function updateComplaintStatus(req, res) {
  try {
    const { status } = req.body;
    if (!['pending', 'seen'].includes(status)) {
      throw new ApiError(400, 'Invalid status');
    }

    const complaint = await Complaint.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    );

    if (!complaint) throw new ApiError(404, 'Complaint not found');

    return res.status(200).json(
      new ApiResponse(200, complaint, 'Status updated')
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, 'Failed to update status');
  }
}
