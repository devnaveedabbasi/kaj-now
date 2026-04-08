import { absoluteUrlForWebPath, webPathFromMulterFile } from '../utils/publicFileUrl.js';

function badRequest(res, message) {
  return res.status(400).json({ success: false, message });
}

/**
 * POST multipart/form-data, field name `file`.
 * Optional: query ?folder=avatars or body field folder (alphanumeric) — stored under uploads/users/<userId>/<folder>/.
 */
export function uploadSingleFile(req, res) {
  try {
    if (!req.file) {
      return badRequest(res, 'No file uploaded. Use form field "file" (JPEG, PNG, WebP, GIF, or PDF).');
    }
    const webPath = webPathFromMulterFile(req.file);
    const url = absoluteUrlForWebPath(req, webPath);
    return res.status(201).json({
      success: true,
      message: 'File saved.',
      data: { url, path: webPath },
    });
  } catch (err) {
    console.error('uploadSingleFile:', err);
    return res.status(500).json({ success: false, message: err.message || 'Upload failed.' });
  }
}
