import Complaint from '../../models/complaint.model.js';
import ComplaintType from '../../models/complaintType.model.js';
import User from '../../models/User.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { sendComplaintReplyEmail } from '../../service/emailService.js';


export async function submitComplaint(req, res) {
  try {
    const { complaintTypeId, description } = req.body;
    const userId = req.user._id;

    if (!complaintTypeId) {
      throw new ApiError(400, "Complaint type is required");
    }

    // Check if complaint type exists
    const complaintType = await ComplaintType.findById(complaintTypeId);

    if (!complaintType) {
      throw new ApiError(400, "Invalid complaint type");
    }

    if (!description?.trim()) {
      throw new ApiError(400, "Description is required");
    }

    const complaint = await Complaint.create({
      userId,
      complaintType: complaintTypeId,
      description: description.trim(),
    });

    const populatedComplaint = await Complaint.findById(complaint._id)
      .populate("complaintType")
      .populate("userId", "name email")
      .lean();

    return res.status(201).json(
      new ApiResponse(201, populatedComplaint, "Complaint submitted successfully")
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, "Failed to submit complaint");
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
      .populate("complaintType")
      .populate("userId", "name email")
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json(
      new ApiResponse(200, complaints, "Complaints fetched")
    );


  } catch (error) {
    throw new ApiError(500, 'Failed to fetch complaints');
  }
}
// ─────────────────────────────────────────────────────────────
// GET /api/complaint/types
// Customer fetch dynamic types
// ─────────────────────────────────────────────────────────────
export async function getComplaintTypes(req, res) {
  try {
    const types = await ComplaintType.find().sort({ createdAt: -1 }).lean();
    return res.status(200).json(
      new ApiResponse(200, types, 'Complaint types fetched')
    );
  } catch (error) {
    throw new ApiError(500, 'Failed to fetch complaint types');
  }
}
