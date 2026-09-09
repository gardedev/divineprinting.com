'use strict';

const express = require('express');
const { Router } = express;
const { jwtAuth } = require('../middleware/jwtAuth');
const { requireGroup } = require('../middleware/authorization');
const logger = require('../utils/logger');

const STATUS = Object.freeze({
  ORDER_AUTH_REQUIRED: 401,
  ORDER_EMAIL_UNVERIFIED: 403,
  ORDER_ACCOUNT_INELIGIBLE: 403,
  ORDER_PROFILE_INCOMPLETE: 403,
  ORDER_CART_NOT_FOUND: 404,
  ORDER_CART_VERSION_CONFLICT: 409,
  CHECKOUT_CONFLICT: 409,
  CHECKOUT_IDEMPOTENCY_CONFLICT: 409,
  ORDER_PRICE_CHANGED: 409,
  ORDER_PRODUCT_UNAVAILABLE: 422,
  ORDER_CONFIGURATION_INVALID: 422,
  CHECKOUT_CONFIGURATION_INCOMPLETE: 503,
  STRIPE_UNAVAILABLE: 503,
  CHECKOUT_RECOVERY_REQUIRED: 503,
});

const SAFE = Object.freeze({
  CHECKOUT_IDEMPOTENCY_CONFLICT: 'The checkout key conflicts with an earlier request.',
  CHECKOUT_CONFLICT: 'The cart changed or checkout is already in progress.',
  ORDER_CART_VERSION_CONFLICT: 'The cart changed. Reload it and try again.',
  ORDER_CART_NOT_FOUND: 'Cart not found.',
  STRIPE_UNAVAILABLE: 'Payment service is temporarily unavailable.',
  CHECKOUT_RECOVERY_REQUIRED: 'Checkout is being recovered. Retry shortly.',
});

/**
 * Express middleware that captures the raw request body as a Buffer before
 * any JSON parsing. This is required for Stripe webhook signature verification.
 *
 * Must be applied BEFORE express.json() on the webhook route.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {Function} next
 */
const parseRawWebhookBody = express.raw({ type: () => true, limit: '32kb' });

function rawBodyMiddleware(req, res, next) {
  parseRawWebhookBody(req, res, (error) => {
    if (error) return next(error);
    req.rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    return next();
  });
}

function createCheckoutRouter({ checkoutService, webhookValidator, jwtAuthMiddleware = jwtAuth } = {}) {
  if (!checkoutService) throw new TypeError('checkoutService is required');
  const router = Router();

  // ─── POST /session ─────────────────────────────────────────────────────────
  router.post('/session', jwtAuthMiddleware, requireGroup('customer'), async (req, res) => {
    try {
      if (!req.body || Object.keys(req.body).some((key) => !['checkoutInput'].includes(key))) {
        return res.status(400).json({ code: 'CHECKOUT_INVALID_INPUT', error: 'The checkout request is invalid.' });
      }
      const idempotencyKey = req.get('Idempotency-Key');
      const match = req.get('If-Match')?.match(/^\"?([1-9]\d*)\"?$/);
      if (!idempotencyKey || !match) {
        return res.status(400).json({ code: 'CHECKOUT_INVALID_INPUT', error: 'Idempotency-Key and a valid If-Match are required.' });
      }
      const result = await checkoutService.startCheckout({
        auth: req.auth,
        checkoutInput: req.body.checkoutInput || {},
        idempotencyKey,
        expectedCartVersion: Number(match[1]),
      });
      return res.status(result.idempotentReplay ? 200 : 201).json({
        orderId: result.orderId,
        checkoutUrl: result.checkoutUrl,
        expiresAt: result.expiresAt,
      });
    } catch (error) {
      const code = STATUS[error?.code] ? error.code : 'CHECKOUT_FAILED';
      return res.status(STATUS[code] || 500).json({ code, error: SAFE[code] || 'Checkout could not be completed.' });
    }
  });

  // ─── POST /webhook ──────────────────────────────────────────────────────────
  // IMPORTANT: This route captures the raw body BEFORE any JSON parsing.
  // It must be registered WITHOUT express.json() middleware.
  // The app must NOT apply express.json() globally before this route.
  router.post('/webhook',
    // Capture raw body bytes for Stripe signature verification
    rawBodyMiddleware,
    async (req, res) => {
      const signatureHeader = req.get('Stripe-Signature');
      const requestId = req.get('x-request-id') || req.get('x-amzn-requestid') || undefined;

      // Validate Stripe-Signature header is present before doing any work
      if (!signatureHeader) {
        logger.warn('Stripe webhook: missing Stripe-Signature header', { requestId });
        return res.status(400).json({ code: 'WEBHOOK_SIGNATURE_MISSING', error: 'Stripe-Signature header is required.' });
      }

      if (!req.rawBody || req.rawBody.length === 0) {
        logger.warn('Stripe webhook: empty raw body', { requestId });
        return res.status(400).json({ code: 'WEBHOOK_RAW_BODY_MISSING', error: 'Request body is required.' });
      }

      // Verify signature
      let event;
      try {
        if (!webhookValidator) {
          logger.error('Stripe webhook: webhookValidator not configured', null, { requestId });
          return res.status(503).json({ code: 'WEBHOOK_NOT_CONFIGURED', error: 'Webhook processing is not available.' });
        }
        const verified = await webhookValidator.verify(req.rawBody, signatureHeader);
        event = verified.event;
      } catch (sigError) {
        const code = sigError?.code || 'WEBHOOK_SIGNATURE_INVALID';
        logger.warn('Stripe webhook: signature verification failed', { requestId, code });
        // Use 400 for malformed/invalid payloads, 401 for signature failures
        const status = code === 'WEBHOOK_TIMESTAMP_EXPIRED' ? 400 :
                       code === 'WEBHOOK_SIGNATURE_MISSING' || code === 'WEBHOOK_SIGNATURE_MALFORMED' ? 400 : 400;
        return res.status(status).json({ code, error: 'Webhook signature verification failed.' });
      }

      // Process the verified event
      try {
        const result = await checkoutService.handleWebhookEvent({ event });

        if (result.duplicate) {
          // Concurrent duplicate: respond 200 so Stripe does not retry immediately,
          // but signal to our own monitoring that this was a duplicate delivery.
          logger.info('Stripe webhook: concurrent duplicate (200 OK, no-op)', {
            eventId: event.id,
            eventType: event.type,
            requestId,
          });
          return res.status(200).json({ received: true, status: 'duplicate' });
        }

        return res.status(200).json({ received: true, status: result.idempotent ? 'idempotent' : 'processed' });
      } catch (processingError) {
        const code = processingError?.code || 'WEBHOOK_PROCESSING_FAILED';

        // Log full error context safely (no PII, no secrets)
        logger.error('Stripe webhook: processing error', processingError, {
          eventId: event?.id,
          eventType: event?.type,
          code,
          requestId,
        });

        // Return 500 so Stripe will retry the event.
        // Do NOT return 400 for processing errors — that would prevent retries.
        return res.status(500).json({ code: 'WEBHOOK_PROCESSING_FAILED', error: 'Webhook event could not be processed.' });
      }
    },
  );

  return router;
}

module.exports = { createCheckoutRouter, STATUS, rawBodyMiddleware };
