'use strict';

/**
 * stripeWebhookValidator.js — Stripe Webhook Signature Verification
 *
 * Implements the exact Stripe webhook signature verification algorithm:
 *   1. Extract `t` (timestamp) and `v1` (signature) from the Stripe-Signature header.
 *   2. Construct the signed payload: `{t}.{rawBody}`.
 *   3. Compute HMAC-SHA256 of the signed payload using the webhook secret.
 *   4. Compare with constant-time equality to prevent timing attacks.
 *   5. Reject events older than the tolerance window (default: 300 seconds).
 *
 * The raw request body MUST be captured before any JSON parsing middleware;
 * once Express parses the body the Buffer is gone and signature verification
 * will fail.  Mount the webhook route BEFORE express.json() in app setup.
 *
 * @module stripeWebhookValidator
 */

const crypto = require('crypto');

/** Default replay-attack tolerance window in seconds (Stripe recommends 300). */
const DEFAULT_TOLERANCE_SECONDS = 300;

class StripeWebhookValidationError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'StripeWebhookValidationError';
    this.code = code;
  }
}

/**
 * Parse the Stripe-Signature header into its component parts.
 *
 * @param {string} header - Raw Stripe-Signature header value.
 * @returns {{ t: number, signatures: string[] }}
 * @throws {StripeWebhookValidationError} WEBHOOK_SIGNATURE_MALFORMED
 */
function parseSignatureHeader(header) {
  if (typeof header !== 'string' || !header.trim()) {
    throw new StripeWebhookValidationError(
      'WEBHOOK_SIGNATURE_MISSING',
      'Stripe-Signature header is missing or empty.',
    );
  }

  let t = null;
  const signatures = [];

  for (const part of header.split(',')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === 't') {
      const parsed = parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new StripeWebhookValidationError(
          'WEBHOOK_SIGNATURE_MALFORMED',
          'Stripe-Signature timestamp is invalid.',
        );
      }
      t = parsed;
    } else if (key === 'v1') {
      if (value && /^[a-f0-9]+$/i.test(value)) {
        signatures.push(value.toLowerCase());
      }
    }
  }

  if (t === null) {
    throw new StripeWebhookValidationError(
      'WEBHOOK_SIGNATURE_MALFORMED',
      'Stripe-Signature header is missing the timestamp (t=) component.',
    );
  }
  if (signatures.length === 0) {
    throw new StripeWebhookValidationError(
      'WEBHOOK_SIGNATURE_MALFORMED',
      'Stripe-Signature header contains no valid v1 signatures.',
    );
  }

  return { t, signatures };
}

/**
 * Compute the expected HMAC-SHA256 signature for the given payload and timestamp.
 *
 * @param {number} t - Stripe timestamp extracted from Stripe-Signature header.
 * @param {Buffer|string} rawBody - Exact raw request body bytes.
 * @param {string} secret - Stripe webhook signing secret (whsec_...).
 * @returns {string} Lowercase hex HMAC-SHA256.
 */
function computeExpectedSignature(t, rawBody, secret) {
  const payload = `${t}.${rawBody instanceof Buffer ? rawBody.toString('utf8') : rawBody}`;
  return crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
}

/**
 * Verify a Stripe webhook request using its raw body and Stripe-Signature header.
 *
 * @param {{
 *   rawBody: Buffer|string,
 *   signatureHeader: string,
 *   secret: string,
 *   toleranceSeconds?: number,
 *   now?: () => number,
 * }} options
 * @returns {{ event: object, timestamp: number }} Parsed event and header timestamp.
 * @throws {StripeWebhookValidationError}
 */
function verifyWebhookSignature({
  rawBody,
  signatureHeader,
  secret,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  now = () => Math.floor(Date.now() / 1000),
}) {
  if (!rawBody || (typeof rawBody !== 'string' && !Buffer.isBuffer(rawBody))) {
    throw new StripeWebhookValidationError(
      'WEBHOOK_RAW_BODY_MISSING',
      'Raw request body is required for signature verification.',
    );
  }
  if (typeof secret !== 'string' || !secret.startsWith('whsec_')) {
    throw new StripeWebhookValidationError(
      'WEBHOOK_SECRET_INVALID',
      'Webhook signing secret is invalid or missing.',
    );
  }

  const { t, signatures } = parseSignatureHeader(signatureHeader);

  const currentTime = now();
  if (Math.abs(currentTime - t) > toleranceSeconds) {
    throw new StripeWebhookValidationError(
      'WEBHOOK_TIMESTAMP_EXPIRED',
      `Webhook timestamp is outside the ${toleranceSeconds}s tolerance window.`,
    );
  }

  const expected = computeExpectedSignature(t, rawBody, secret);

  const expectedBuffer = Buffer.from(expected, 'hex');
  let matched = false;
  for (const sig of signatures) {
    // Pad to same length to prevent timing attacks even on length mismatch.
    if (sig.length === expected.length) {
      const sigBuffer = Buffer.from(sig, 'hex');
      if (sigBuffer.length === expectedBuffer.length &&
          crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
        matched = true;
        break;
      }
    }
  }

  if (!matched) {
    throw new StripeWebhookValidationError(
      'WEBHOOK_SIGNATURE_INVALID',
      'Stripe webhook signature verification failed.',
    );
  }

  let event;
  try {
    const bodyStr = rawBody instanceof Buffer ? rawBody.toString('utf8') : rawBody;
    event = JSON.parse(bodyStr);
  } catch (err) {
    throw new StripeWebhookValidationError(
      'WEBHOOK_PAYLOAD_INVALID',
      'Webhook payload is not valid JSON.',
    );
  }

  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') {
    throw new StripeWebhookValidationError(
      'WEBHOOK_PAYLOAD_INVALID',
      'Webhook payload is missing required fields (id, type).',
    );
  }

  return { event, timestamp: t };
}

/**
 * Create a reusable webhook validator bound to a specific secret provider.
 *
 * @param {{ secretProvider: () => Promise<string>, toleranceSeconds?: number, now?: () => number }} options
 * @returns {{ verify: (rawBody: Buffer|string, signatureHeader: string) => Promise<{ event: object, timestamp: number }> }}
 */
function createStripeWebhookValidator({ secretProvider, toleranceSeconds = DEFAULT_TOLERANCE_SECONDS, now = () => Math.floor(Date.now() / 1000) } = {}) {
  if (typeof secretProvider !== 'function') {
    throw new TypeError('A webhook secret provider function is required.');
  }

  async function verify(rawBody, signatureHeader) {
    const secret = await secretProvider();
    if (typeof secret !== 'string' || !secret.startsWith('whsec_')) {
      throw new StripeWebhookValidationError(
        'WEBHOOK_SECRET_INVALID',
        'Webhook signing secret is not configured.',
      );
    }
    return verifyWebhookSignature({ rawBody, signatureHeader, secret, toleranceSeconds, now });
  }

  return { verify };
}

module.exports = {
  createStripeWebhookValidator,
  verifyWebhookSignature,
  parseSignatureHeader,
  computeExpectedSignature,
  StripeWebhookValidationError,
  DEFAULT_TOLERANCE_SECONDS,
};
