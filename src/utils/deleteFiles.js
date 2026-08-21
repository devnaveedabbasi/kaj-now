import { deleteMedia } from '../service/s3Media.service.js';

// Legacy name retained so existing callers delete the S3 object instead of disk files.
export const deleteFile = async (mediaReference) => {
  try { return await deleteMedia(mediaReference); }
  catch (error) { console.error('Error deleting S3 media:', error.message); return false; }
};
