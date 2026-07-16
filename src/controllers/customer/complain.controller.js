import Complaint from '../../models/complaint.model.js';
import User from '../../models/User.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { sendComplaintReplyEmail } from '../../service/emailService.js';

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
