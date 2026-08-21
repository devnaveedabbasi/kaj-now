import { S3Client, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import crypto from 'crypto';
import path from 'path';

const required = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION', 'AWS_S3_BUCKET'];
function config() {
  const missing = required.filter((name) => !process.env[name]);
  if (missing.length) throw new Error(`Missing S3 configuration: ${missing.join(', ')}`);
  return { region: process.env.AWS_REGION, bucket: process.env.AWS_S3_BUCKET };
}
const client = new S3Client({ region: process.env.AWS_REGION, credentials: process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY ? { accessKeyId: process.env.AWS_ACCESS_KEY_ID, secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY } : undefined });
export function publicS3Url(key) { const { region, bucket } = config(); return `https://${bucket}.s3.${region}.amazonaws.com/${encodeURIComponent(key).replace(/%2F/g, '/')}`; }
export function keyFromMediaReference(reference) {
  if (!reference || typeof reference !== 'string') return null;
  if (reference.startsWith('media/')) return reference;
  const prefix = `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/`;
  return reference.startsWith(prefix) ? decodeURIComponent(reference.slice(prefix.length)) : null;
}
function safeExtension(name = '', type = '') { return path.extname(name).toLowerCase() || ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'application/pdf': '.pdf' })[type] || ''; }
export async function uploadMediaBuffer({ buffer, originalname, mimetype, folder = 'media/documents', metadata = {} }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Cannot upload an empty media file');
  const key = `${folder.replace(/^\/+|\/+$/g, '')}/${Date.now()}-${crypto.randomUUID()}${safeExtension(originalname, mimetype)}`;
  const { bucket } = config();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mimetype || 'application/octet-stream', Metadata: Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, String(v)])) }));
  return { key, url: publicS3Url(key) };
}
export async function uploadMediaAtKey({ key, buffer, mimetype, metadata = {} }) {
  if (!Buffer.isBuffer(buffer) || !buffer.length) throw new Error('Cannot upload an empty media file');
  const { bucket } = config();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mimetype || 'application/octet-stream', Metadata: Object.fromEntries(Object.entries(metadata).map(([k, v]) => [k, String(v)])) }));
  return { key, url: publicS3Url(key) };
}
export async function deleteMedia(reference) { const key = keyFromMediaReference(reference); if (!key) return false; const { bucket } = config(); await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })); return true; }
export async function mediaExists(key) { const { bucket } = config(); try { await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key })); return true; } catch (error) { if (error?.$metadata?.httpStatusCode === 404 || error?.name === 'NotFound') return false; throw error; } }
export async function getMediaBuffer(reference) { const key = keyFromMediaReference(reference); if (!key) throw new Error('Invalid S3 media reference'); const { bucket } = config(); const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key })); const chunks = []; for await (const chunk of result.Body) chunks.push(chunk); return Buffer.concat(chunks); }
export async function getMediaDownloadUrl(reference, expiresIn = 300) { const key = keyFromMediaReference(reference); if (!key) return reference; const { bucket } = config(); return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn }); }
