import Note from '../models/note.model.js';
import { ApiError } from '../utils/errorHandler.js';
import { ApiResponse } from '../utils/apiResponse.js';
import { sendNoteReplyEmail } from '../service/emailService.js';

// ─────────────────────────────────────────────────────────────
// POST /api/note
// Customer note submit karta hai
// ─────────────────────────────────────────────────────────────
export async function submitNote(req, res) {
  try {
    const { note } = req.body;
    const userId = req.user._id;

    if (!note?.trim()) {
      throw new ApiError(400, 'Note text is required');
    }

    const created = await Note.create({ userId, note: note.trim() });

    return res.status(201).json(
      new ApiResponse(201, created, 'Note submitted successfully')
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, 'Failed to submit note');
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/note
// Customer apne notes dekhta hai
// ─────────────────────────────────────────────────────────────
export async function getMyNotes(req, res) {
  try {
    const notes = await Note.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json(
      new ApiResponse(200, notes, 'Notes fetched')
    );
  } catch (error) {
    throw new ApiError(500, 'Failed to fetch notes');
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN: GET /api/note/all
// Sab notes — filter: ?status=pending
// ─────────────────────────────────────────────────────────────
export async function getAllNotes(req, res) {
  try {
    const { status } = req.query;
    const filter = {};
    if (status) filter.status = status;

    const notes = await Note.find(filter)
      .populate('userId', 'name email phone profilePicture role')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json(
      new ApiResponse(200, notes, 'All notes fetched')
    );
  } catch (error) {
    throw new ApiError(500, 'Failed to fetch notes');
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN: GET /api/note/:id
// Single note detail
// ─────────────────────────────────────────────────────────────
export async function getNoteById(req, res) {
  try {
    const note = await Note.findById(req.params.id)
      .populate('userId', 'name email phone profilePicture role')
      .lean();

    if (!note) throw new ApiError(404, 'Note not found');

    return res.status(200).json(
      new ApiResponse(200, note, 'Note fetched')
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, 'Failed to fetch note');
  }
}

// ─────────────────────────────────────────────────────────────
// ADMIN: POST /api/note/:id/reply
// Admin reply karta hai — email bhi jata hai user ko
// ─────────────────────────────────────────────────────────────
export async function replyToNote(req, res) {
  try {
    const { reply } = req.body;
    if (!reply?.trim()) throw new ApiError(400, 'Reply text is required');

    const note = await Note.findById(req.params.id)
      .populate('userId', 'name email');

    if (!note) throw new ApiError(404, 'Note not found');

    note.adminReply = reply.trim();
    note.repliedAt  = new Date();
    note.status     = 'seen';
    await note.save();

    await sendNoteReplyEmail(note.userId.email, {
      userName:   note.userId.name,
      noteText:   note.note,
      adminReply: reply.trim(),
    });

    return res.status(200).json(
      new ApiResponse(200, note, 'Reply sent and email delivered to user')
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, 'Failed to send reply');
  }
}
