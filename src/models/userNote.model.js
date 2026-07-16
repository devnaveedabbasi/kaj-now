import mongoose from 'mongoose';

// Admin <-> User support-note thread. UK region only — see userNote.controller.js
// for the region gate; kept as a separate model from note.model.js (the
// existing cross-region note system) since that one has no `subject` field
// and is already relied on by existing clients without one.
const userNoteSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    region: {
      type: String,
      enum: ['UK'],
      required: true,
      default: 'UK',
    },
    note: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ['pending', 'replied'],
      default: 'pending',
    },
    reply: {
      type: String,
      default: null,
    },
    repliedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    repliedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

userNoteSchema.index({ status: 1, createdAt: -1 });
userNoteSchema.index({ userId: 1, createdAt: -1 });

const UserNote = mongoose.models.UserNote || mongoose.model('UserNote', userNoteSchema);
export default UserNote;
