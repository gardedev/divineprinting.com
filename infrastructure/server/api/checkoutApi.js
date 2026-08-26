'use strict';

const { Router } = require('express');
const { jwtAuth } = require('../middleware/jwtAuth');
const { requireGroup } = require('../middleware/authorization');

const STATUS = Object.freeze({ ORDER_AUTH_REQUIRED: 401, ORDER_EMAIL_UNVERIFIED: 403, ORDER_ACCOUNT_INELIGIBLE: 403, ORDER_PROFILE_INCOMPLETE: 403, ORDER_CART_NOT_FOUND: 404, ORDER_CART_VERSION_CONFLICT: 409, CHECKOUT_CONFLICT: 409, CHECKOUT_IDEMPOTENCY_CONFLICT: 409, ORDER_PRICE_CHANGED: 409, ORDER_PRODUCT_UNAVAILABLE: 422, ORDER_CONFIGURATION_INVALID: 422, CHECKOUT_CONFIGURATION_INCOMPLETE: 503, STRIPE_UNAVAILABLE: 503, CHECKOUT_RECOVERY_REQUIRED: 503 });
const SAFE = Object.freeze({ CHECKOUT_IDEMPOTENCY_CONFLICT: 'The checkout key conflicts with an earlier request.', CHECKOUT_CONFLICT: 'The cart changed or checkout is already in progress.', ORDER_CART_VERSION_CONFLICT: 'The cart changed. Reload it and try again.', ORDER_CART_NOT_FOUND: 'Cart not found.', STRIPE_UNAVAILABLE: 'Payment service is temporarily unavailable.', CHECKOUT_RECOVERY_REQUIRED: 'Checkout is being recovered. Retry shortly.' });

function createCheckoutRouter({ checkoutService, jwtAuthMiddleware = jwtAuth } = {}) {
  if (!checkoutService) throw new TypeError('checkoutService is required');
  const router = Router();
  router.post('/session', jwtAuthMiddleware, requireGroup('customer'), async (req, res) => {
    try {
      if (!req.body || Object.keys(req.body).some((key) => !['checkoutInput'].includes(key))) return res.status(400).json({ code: 'CHECKOUT_INVALID_INPUT', error: 'The checkout request is invalid.' });
      const idempotencyKey = req.get('Idempotency-Key');
      const match = req.get('If-Match')?.match(/^"?([1-9]\d*)"?$/);
      if (!idempotencyKey || !match) return res.status(400).json({ code: 'CHECKOUT_INVALID_INPUT', error: 'Idempotency-Key and a valid If-Match are required.' });
      const result = await checkoutService.startCheckout({ auth: req.auth, checkoutInput: req.body.checkoutInput || {}, idempotencyKey, expectedCartVersion: Number(match[1]) });
      return res.status(result.idempotentReplay ? 200 : 201).json({ orderId: result.orderId, checkoutUrl: result.checkoutUrl, expiresAt: result.expiresAt });
    } catch (error) {
      const code = STATUS[error?.code] ? error.code : 'CHECKOUT_FAILED';
      return res.status(STATUS[code] || 500).json({ code, error: SAFE[code] || 'Checkout could not be completed.' });
    }
  });
  return router;
}

module.exports = { createCheckoutRouter, STATUS };
