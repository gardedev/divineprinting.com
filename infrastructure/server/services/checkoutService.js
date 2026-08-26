'use strict';

const crypto = require('crypto');
const { createOrderService } = require('./orderService');
const { createCheckoutRepository } = require('../repositories/checkoutRepository');
const SHIPPING_CENTS = 795;

class CheckoutServiceError extends Error {
  constructor(code, message, cause) { super(message || code); this.name = 'CheckoutServiceError'; this.code = code; this.isDomainError = true; if (cause) this.cause = cause; }
}

function stripeKey(idempotency) {
  return `dp_checkout_${crypto.createHash('sha256').update(`${idempotency.scope}:${idempotency.key}:${idempotency.fingerprint}`).digest('hex')}`;
}
function orderNumber(orderId) { return `DP-${orderId.replace(/-/g, '').slice(0, 12).toUpperCase()}`; }
function safeError(error) {
  if (error?.isDomainError || error instanceof CheckoutServiceError) return error;
  const allowed = new Set(['STRIPE_UNAVAILABLE', 'STRIPE_REQUEST_REJECTED', 'STRIPE_RESPONSE_INVALID', 'STRIPE_CONFIGURATION_INVALID']);
  return new CheckoutServiceError(allowed.has(error?.code) ? error.code : 'CHECKOUT_FAILED', 'Checkout could not be completed safely.', error);
}

function createCheckoutService({ orderService, checkoutRepository = createCheckoutRepository(), stripeClient } = {}) {
  if (!stripeClient || typeof stripeClient.createSession !== 'function') throw new TypeError('stripeClient is required');
  const preparer = orderService || createOrderService({
    addressResolver: async () => ({ collectionAuthority: 'stripe_checkout' }),
    discountService: { calculate: async () => 0 },
    shippingService: { calculate: async () => SHIPPING_CENTS },
    taxPolicy: { status: 'disabled' },
  });

  async function startCheckout({ auth, checkoutInput = {}, idempotencyKey, expectedCartVersion } = {}) {
    let pending;
    try {
      const hintedCartId = checkoutInput?.cartId;
      if (typeof auth?.sub === 'string' && typeof hintedCartId === 'string' && Number.isInteger(expectedCartVersion) && typeof idempotencyKey === 'string') {
        const scope = `${auth.sub}:${hintedCartId}:${expectedCartVersion}`;
        const orderId = require('../repositories/checkoutRepository').deterministicId('divine-printing-checkout-order-v1', `${scope}:${idempotencyKey}`);
        const prior = await checkoutRepository.getCheckout?.(orderId);
        if (prior?.order) {
          if (prior.order.customerId !== auth.sub || prior.order.cartId !== hintedCartId || prior.order.cartVersion !== expectedCartVersion || prior.order.idempotencyKey !== idempotencyKey) throw new CheckoutServiceError('CHECKOUT_IDEMPOTENCY_CONFLICT', 'Checkout identity conflict.');
          const priorIdempotency = { scope, key: idempotencyKey, fingerprint: prior.order.idempotencyFingerprint };
          const session = prior.order.stripeCheckoutSessionId
            ? await stripeClient.retrieveSession(prior.order.stripeCheckoutSessionId)
            : await stripeClient.createSession({ order: prior.order, items: prior.items, idempotencyKey: stripeKey(priorIdempotency) });
          if (!prior.order.stripeCheckoutSessionId) await checkoutRepository.persistStripeSession({ orderId, expectedVersion: prior.order.version, session });
          return { orderId, checkoutUrl: session.url, expiresAt: session.expiresAt, idempotentReplay: true };
        }
      }
      const prepared = await preparer.prepareOrder({ auth, checkoutInput, idempotencyKey, expectedCartVersion });
      if (!prepared.readyForDurableCreation) throw new CheckoutServiceError('CHECKOUT_CONFIGURATION_INCOMPLETE', 'Checkout configuration is incomplete.');
      if (prepared.proposedItems.length > 96) throw new CheckoutServiceError('CHECKOUT_TOO_LARGE', 'The cart is too large for atomic checkout.');
      pending = await checkoutRepository.createPendingCheckout({ prepared, orderNumber: orderNumber(require('../repositories/checkoutRepository').deterministicId('divine-printing-checkout-order-v1', prepared.idempotency.scope + ':' + prepared.idempotency.key)) });
      if (pending.order.stripeCheckoutSessionId) {
        const session = await stripeClient.retrieveSession(pending.order.stripeCheckoutSessionId);
        return { orderId: pending.order.orderId, checkoutUrl: session.url, expiresAt: session.expiresAt, idempotentReplay: true };
      }
      const session = await stripeClient.createSession({ order: pending.order, items: pending.items || prepared.proposedItems, idempotencyKey: stripeKey(prepared.idempotency) });
      let linked;
      try { linked = await checkoutRepository.persistStripeSession({ orderId: pending.order.orderId, expectedVersion: pending.order.version, session }); }
      catch (firstError) {
        // The Stripe idempotency key already fixes the external Session identity.
        // One bounded persistence retry recovers a transient DynamoDB response loss
        // without issuing another Stripe request.
        try { linked = await checkoutRepository.persistStripeSession({ orderId: pending.order.orderId, expectedVersion: pending.order.version, session }); }
        catch (error) { throw new CheckoutServiceError('CHECKOUT_RECOVERY_REQUIRED', 'Checkout was created and must be safely resumed.', error); }
      }
      return { orderId: linked.orderId, checkoutUrl: session.url, expiresAt: session.expiresAt, idempotentReplay: pending.idempotentReplay };
    } catch (error) {
      if (pending?.order && !pending.order.stripeCheckoutSessionId && ['STRIPE_UNAVAILABLE', 'STRIPE_REQUEST_REJECTED', 'STRIPE_RESPONSE_INVALID', 'STRIPE_CONFIGURATION_INVALID'].includes(error?.code)) {
        try { await checkoutRepository.recordStripeFailureAndUnlock({ order: pending.order, failureCode: error.code }); }
        catch (compensationError) { throw new CheckoutServiceError('CHECKOUT_RECOVERY_REQUIRED', 'Checkout recovery is required.', compensationError); }
      }
      throw safeError(error);
    }
  }
  return { startCheckout };
}

module.exports = { createCheckoutService, CheckoutServiceError, SHIPPING_CENTS, stripeKey };
