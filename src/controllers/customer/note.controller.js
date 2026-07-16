import UserNote from '../../models/userNote.model.js';
import { ApiError } from '../../utils/errorHandler.js';
import { ApiResponse } from '../../utils/apiResponse.js';

// This feature is UK-only. Users have `region` set at signup (derived from
// phone country code), so this is a plain field check — there is no
// dedicated "region middleware" elsewhere in the codebase to reuse.
function assertUkRegion(user) {
  if (user?.region !== 'UK') {
    throw new ApiError(403, 'This feature is only available for the UK region');
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/user-notes
// Authenticated user (customer/provider) submits a note to admin
// ─────────────────────────────────────────────────────────────
export async function createUserNote(req, res) {
  try {
    assertUkRegion(req.user);

    const { note: noteText } = req.body;

    if (!noteText?.trim()) throw new ApiError(400, 'Note is required');

    const note = await UserNote.create({
      userId: req.user._id,
      region: 'UK',
      note: noteText.trim(),
    });

    return res.status(201).json(
      new ApiResponse(201, note, 'Note submitted successfully')
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, 'Failed to submit note');
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/user-notes
// Authenticated user views their own notes
// ─────────────────────────────────────────────────────────────
export async function getMyUserNotes(req, res) {
  try {
    assertUkRegion(req.user);

    const notes = await UserNote.find({ userId: req.user._id })
      .select('note status reply repliedAt createdAt')
      .sort({ createdAt: -1 })
      .lean();

    return res.status(200).json(
      new ApiResponse(200, notes, 'Notes fetched successfully')
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, 'Failed to fetch notes');
  }
}

// ─────────────────────────────────────────────────────────────
// GET /api/user-notes/:id
// Authenticated user views a single note — only if it belongs to them
// ─────────────────────────────────────────────────────────────
export async function getMyUserNoteById(req, res) {
  try {
    assertUkRegion(req.user);

    const note = await UserNote.findOne({ _id: req.params.id, userId: req.user._id })
      .select('note status reply repliedAt createdAt')
      .lean();

    if (!note) throw new ApiError(404, 'Note not found');

    return res.status(200).json(
      new ApiResponse(200, note, 'Note fetched successfully')
    );
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(500, 'Failed to fetch note');
  }
}
