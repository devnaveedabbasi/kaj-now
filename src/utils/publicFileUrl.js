import path from 'path';

/**
 * Web path for a file stored under project /uploads (leading slash).
 * @param {import('multer').File} file - multer file object with .path
 */
export function webPathFromMulterFile(file) {
  const uploadRoot = path.join(process.cwd(), 'uploads');
  let rel = path.relative(uploadRoot, file.path);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Invalid upload path');
  }
  rel = rel.split(path.sep).join('/');
  return `/uploads/${rel}`;
}

/**
 * Full URL clients can use to fetch the file (set PUBLIC_APP_URL in production).
 */
export function absoluteUrlForWebPath(req, webPath) {
  const base = (process.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
  if (base) return `${base}${webPath}`;
  const host = req.get('host');
  const proto = req.protocol;
  return `${proto}://${host}${webPath}`;
}
