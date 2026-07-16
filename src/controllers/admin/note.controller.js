import mongoose from 'mongoose';
import UserNote from '../../models/userNote.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';
import { sendUserNoteReplyEmail } from '../../service/emailService.js';

// ─────────────────────────────────────────────────────────────
// GET /admin/user-notes — list all, with pagination/search/sort/filter
// ─────────────────────────────────────────────────────────────
export const getAllUserNotes = async (req, res) => {
  try {
    const { status, search, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const query = { region: 'UK' };
    if (status) query.status = status;
    if (search) {
      query.note = { $regex: search, $options: 'i' };
    }

    const sort = { [sortBy]: sortOrder === 'asc' ? 1 : -1 };

    const [notes, total] = await Promise.all([
      UserNote.find(query)
        .populate('userId', 'name email phone role profilePicture')
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .lean(),
      UserNote.countDocuments(query),
    ]);

    res.status(200).json(
      new ApiResponse(200, {
        notes,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: limit,
          hasNextPage: page < Math.ceil(total / limit),
          hasPrevPage: page > 1,
        },
      }, 'Notes fetched successfully')
    );
  } catch (error) {
    res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
  }
};

// ─────────────────────────────────────────────────────────────
// GET /admin/user-notes/:id — full detail
// ─────────────────────────────────────────────────────────────
export const getUserNoteById = async (req, res) => {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError(400, 'Invalid note ID');
    }

    const note = await UserNote.findOne({ _id: id, region: 'UK' })
      .populate('userId', 'name email phone role profilePicture')
      .populate('repliedBy', 'name email')
      .lean();

    if (!note) throw new ApiError(404, 'Note not found');

    res.status(200).json(new ApiResponse(200, note, 'Note fetched successfully'));
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
    }
    res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
  }
};

// ─────────────────────────────────────────────────────────────
// POST /admin/user-notes/:id/reply — admin replies, email sent to user
// ─────────────────────────────────────────────────────────────
export const replyToUserNote = async (req, res) => {
  try {
    const { id } = req.params;
    const { reply } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      throw new ApiError(400, 'Invalid note ID');
    }
    if (!reply?.trim()) {
      throw new ApiError(400, 'Reply is required');
    }

    const note = await UserNote.findOne({ _id: id, region: 'UK' }).populate('userId', 'name email');
    if (!note) throw new ApiError(404, 'Note not found');

    note.reply = reply.trim();
    note.repliedBy = req.user._id;
    note.repliedAt = new Date();
    note.status = 'replied';
    await note.save();

    await sendUserNoteReplyEmail(note.userId.email, {
      userName: note.userId.name,
      note: note.note,
      reply: note.reply,
      repliedAt: note.repliedAt,
    });

    res.status(200).json(new ApiResponse(200, note, 'Reply sent and email delivered to user'));
  } catch (error) {
    if (error instanceof ApiError) {
      return res.status(error.statusCode).json(new ApiResponse(error.statusCode, null, error.message));
    }
    res.status(500).json(new ApiResponse(500, null, 'Internal server error'));
  }
};
