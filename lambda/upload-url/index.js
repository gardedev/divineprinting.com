/**
 * Divine Printing — S3 Presigned POST URL Generator
 * Lambda function for secure direct-to-S3 file uploads
 *
 * Endpoint: POST /upload-url
 * Body: { fileName: "artwork.pdf", fileType: "application/pdf", fileSize: 4200000 }
 * Returns: { url, fields, key } — use these to POST the file directly to S3
 */

const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');
const { v4: uuidv4 } = require('uuid');

// ─── Config ────────────────────────────────────────────────────────────────
const BUCKET_NAME   = process.env.S3_BUCKET_NAME   || 'divineprinting-uploads';
const AWS_REGION    = process.env.AWS_REGION        || 'us-east-1';
const MAX_FILE_SIZE = parseInt(process.env.MAX_FILE_SIZE_BYTES || '10485760'); // 10 MB
const URL_EXPIRES   = parseInt(process.env.PRESIGNED_URL_EXPIRES_SECONDS || '900'); // 15 min

const ALLOWED_EXTENSIONS = ['jpg', 'jpeg', 'png', 'pdf', 'ai', 'eps', 'psd'];
const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/pdf',
  // Adobe Illustrator
  'application/illustrator',
  'application/postscript',
  'application/x-illustrator',
  // EPS
  'application/eps',
  'application/x-eps',
  'image/eps',
  'image/x-eps',
  // Photoshop PSD
  'image/vnd.adobe.photoshop',
  'application/x-photoshop',
  'application/psd',
  'image/psd',
  // Generic binary (some upload clients send this)
  'application/octet-stream',
];

// ─── CORS headers ───────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  process.env.ALLOWED_ORIGIN || 'https://www.divineprinting.com',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Requested-With',
};

// ─── S3 client ──────────────────────────────────────────────────────────────
const s3 = new S3Client({ region: AWS_REGION });

// ─── Helpers ────────────────────────────────────────────────────────────────
function respond(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS, ...extraHeaders },
    body: JSON.stringify(body),
  };
}

function getExtension(fileName) {
  const parts = fileName.toLowerCase().split('.');
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

function sanitizeFileName(fileName) {
  // Strip path traversal, keep only alphanumeric, dash, underscore, dot
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.{2,}/g, '_');
}

// ─── Handler ────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return respond(200, { ok: true });
  }

  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return respond(405, { error: 'Method not allowed' });
  }

  // Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const { fileName, fileType, fileSize, orderId } = body;

  // ── Validate inputs ──────────────────────────────────────────────────────
  if (!fileName || typeof fileName !== 'string') {
    return respond(400, { error: 'fileName is required' });
  }

  if (!fileType || typeof fileType !== 'string') {
    return respond(400, { error: 'fileType is required' });
  }

  if (!fileSize || typeof fileSize !== 'number' || fileSize <= 0) {
    return respond(400, { error: 'fileSize must be a positive number' });
  }

  // File size check (10 MB)
  if (fileSize > MAX_FILE_SIZE) {
    return respond(400, {
      error: `File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
      maxSizeBytes: MAX_FILE_SIZE,
    });
  }

  // Extension check
  const ext = getExtension(fileName);
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return respond(400, {
      error: `File type ".${ext}" is not allowed.`,
      allowedExtensions: ALLOWED_EXTENSIONS,
    });
  }

  // MIME type check (allow octet-stream as fallback for AI/EPS/PSD)
  const normalizedType = fileType.toLowerCase().trim();
  if (!ALLOWED_MIME_TYPES.includes(normalizedType)) {
    return respond(400, {
      error: `MIME type "${fileType}" is not allowed.`,
      allowedTypes: ALLOWED_MIME_TYPES,
    });
  }

  // ── Build S3 object key ──────────────────────────────────────────────────
  const safeFileName = sanitizeFileName(fileName);
  const date         = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const uuid         = uuidv4();
  const prefix       = orderId ? `orders/${sanitizeFileName(orderId)}/` : `uploads/${date}/`;
  const key          = `${prefix}${uuid}-${safeFileName}`;

  // ── Generate presigned POST ──────────────────────────────────────────────
  try {
    const { url, fields } = await createPresignedPost(s3, {
      Bucket: BUCKET_NAME,
      Key:    key,
      Conditions: [
        ['content-length-range', 1, MAX_FILE_SIZE],
        ['eq', '$Content-Type', fileType],
        { key: key },
      ],
      Fields: {
        'Content-Type': fileType,
      },
      Expires: URL_EXPIRES,
    });

    return respond(200, {
      ok:        true,
      uploadUrl: url,
      fields,
      key,
      expiresIn: URL_EXPIRES,
      maxSizeBytes: MAX_FILE_SIZE,
    });
  } catch (err) {
    console.error('S3 presigned post error:', err);
    return respond(500, { error: 'Could not generate upload URL. Please try again.' });
  }
};
