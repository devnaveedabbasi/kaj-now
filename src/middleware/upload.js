import fs from 'fs';
import path from 'path';
import { randomBytes } from 'crypto';
import multer from 'multer';

const MAX_FILE_SIZE = 8 * 1024 * 1024; // 8 MB

const ALLOWED_MIMES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
]);

function fileFilter(_req, file, cb) {
  const mime = (file.mimetype || '').toLowerCase();
  if (ALLOWED_MIMES.has(mime)) {
    cb(null, true);
    return;
  }
  const e = new Error('Invalid file type. Allowed: JPEG, PNG, WebP, GIF, PDF.');
  e.code = 'INVALID_FILE_TYPE';
  cb(e);
}

function userSubdir(subfolder) {
  return multer.diskStorage({
    destination(req, _file, cb) {
      const uid = String(req.user._id);
      const dir = path.join(process.cwd(), 'uploads', subfolder, uid);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname || '') || '';
      const base = `${Date.now()}-${randomBytes(8).toString('hex')}`;
      cb(null, `${base}${ext}`);
    },
  });
}

/** Provider profile documents: multipart field names match model fields. */
export const uploadProviderDocuments = multer({
  storage: userSubdir('providers'),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
}).fields([
  { name: 'facePhoto', maxCount: 1 },
  { name: 'idCardFront', maxCount: 1 },
  { name: 'idCardBack', maxCount: 1 },
  { name: 'certificates', maxCount: 15 },
]);

/** Any authenticated user: single field `file`, optional query folder=subdir (alphanumeric, max 32). */
export const uploadGenericSingle = multer({
  storage: multer.diskStorage({
    destination(req, _file, cb) {
      const uid = String(req.user._id);
      let extra = String(req.query.folder || req.body.folder || 'misc')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 32);
      if (!extra) extra = 'misc';
      const dir = path.join(process.cwd(), 'uploads', 'users', uid, extra);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename(_req, file, cb) {
      const ext = path.extname(file.originalname || '') || '';
      const base = `${Date.now()}-${randomBytes(8).toString('hex')}`;
      cb(null, `${base}${ext}`);
    },
  }),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter,
}).single('file');

export function attachProviderDocumentsUpload(req, res, next) {
  uploadProviderDocuments(req, res, (err) => {
    if (err) return multerErrorHandler(err, req, res, next);
    next();
  });
}

export function attachGenericSingleUpload(req, res, next) {
  uploadGenericSingle(req, res, (err) => {
    if (err) return multerErrorHandler(err, req, res, next);
    next();
  });
}

export function multerErrorHandler(err, req, res, next) {
  if (err.code === 'INVALID_FILE_TYPE') {
    return res.status(400).json({ success: false, message: err.message });
  }
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ success: false, message: 'File too large (max 8 MB).' });
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({
        success: false,
        message: 'Unexpected file field. For generic upload use field name "file".',
      });
    }
    return res.status(400).json({ success: false, message: err.message || 'Upload failed.' });
  }
  next(err);
}
