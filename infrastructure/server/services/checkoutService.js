'use strict';

const crypto = require('crypto');
const { createOrderService } = require('./orderService');
const { createCheckoutRepository } = require('../repositories/checkoutRepository');
const logger = require('../utils/logger');

const SHIPPING_CENTS = 795;

// Stripe event types the webhook handler processes
const HANDLED_EVENT_TYPES = new Set([
  'checkout.session.completed',
  'checkout.session.expired',
  'payment_intent.payment_failed',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
]);

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

  /**
   * Process a verified Stripe webhook event with full idempotency and ordering guards.
   *
   * The caller (API layer) is responsible for raw-body signature verification.
   * This method performs:
   *   1. Event type filtering (skip unhandled types immediately).
   *   2. Idempotent event claim with concurrent duplicate protection.
   *   3. Order lookup via session ID or payment intent metadata.
   *   4. Stale-event ordering guards on all state transitions.
   *   5. Atomic DynamoDB state transitions for all payment events.
   *   6. Best-effort event completion marking.
   *   7. Safe observability (no PII, no secrets in logs).
   *
   * Returns { handled: boolean, idempotent: boolean } for HTTP response decisions.
   *
   * @param {{ event: object }} options - Pre-verified Stripe event object.
   * @returns {Promise<{ handled: boolean, idempotent: boolean, duplicate: boolean }>}
   */
  async function handleWebhookEvent({ event }) {
    const eventId = event.id;
    const eventType = event.type;
    const stripeCreatedAt = event.created;

    // 1. Skip unhandled event types immediately
    if (!HANDLED_EVENT_TYPES.has(eventType)) {
      logger.info('Stripe webhook: unhandled event type (skipped)', { eventId, eventType });
      return { handled: false, idempotent: false, duplicate: false };
    }

    // 2. Claim event for idempotent processing
    let claim;
    try {
      claim = await checkoutRepository.claimStripeEvent({ eventId, eventType, stripeCreatedAt });
    } catch (claimError) {
      logger.error('Stripe webhook: event claim failed', claimError, { eventId, eventType });
      throw new CheckoutServiceError('WEBHOOK_PROCESSING_FAILED', 'Webhook event could not be claimed for processing.', claimError);
    }

    if (claim.alreadyProcessed) {
      logger.info('Stripe webhook: idempotent re-delivery (already processed)', { eventId, eventType });
      return { handled: true, idempotent: true, duplicate: false };
    }

    if (claim.duplicate) {
      logger.info('Stripe webhook: concurrent duplicate delivery (in-progress)', { eventId, eventType });
      return { handled: false, idempotent: false, duplicate: true };
    }

    // 3. Process the event
    let result = 'processed';
    try {
      await _dispatchWebhookEvent({ event, eventId, eventType });
    } catch (processingError) {
      result = 'failed';
      logger.error('Stripe webhook: event processing failed', processingError, { eventId, eventType });
      // Best-effort failure marking
      await checkoutRepository.markStripeEventFailed({ eventId, errorCode: processingError?.code || 'UNKNOWN' });
      throw processingError instanceof CheckoutServiceError
        ? processingError
        : new CheckoutServiceError('WEBHOOK_PROCESSING_FAILED', 'Webhook event processing failed.', processingError);
    }

    // 4. Mark event as processed
    try {
      await checkoutRepository.markStripeEventProcessed({ eventId, result });
    } catch (markError) {
      // Non-fatal: the payment transition already succeeded; log and continue.
      logger.warn('Stripe webhook: could not mark event processed (non-fatal)', { eventId, eventType, code: markError?.code });
    }

    logger.info('Stripe webhook: event processed successfully', { eventId, eventType });
    return { handled: true, idempotent: false, duplicate: false };
  }

  /**
   * Dispatch a verified, claimed event to the appropriate handler.
   * @private
   */
  async function _dispatchWebhookEvent({ event, eventId, eventType }) {
    const data = event.data?.object || {};

    switch (eventType) {
      case 'checkout.session.completed':
        return _handleCheckoutSessionCompleted({ event, eventId, session: data });

      case 'checkout.session.expired':
        return _handleCheckoutSessionExpired({ event, eventId, session: data });

      case 'payment_intent.payment_failed':
        return _handlePaymentIntentFailed({ event, eventId, paymentIntent: data });

      case 'charge.refunded':
        return _handleChargeRefunded({ event, eventId, charge: data });

      case 'charge.dispute.created':
      case 'charge.dispute.updated':
      case 'charge.dispute.closed':
        return _handleChargeDispute({ event, eventId, dispute: data, eventType });

      default:
        logger.info('Stripe webhook: unrouted event type', { eventId, eventType });
    }
  }

  /**
   * Handle checkout.session.completed — primary payment success path.
   * @private
   */
  async function _handleCheckoutSessionCompleted({ event, eventId, session }) {
    const sessionId = session.id;
    const paymentIntentId = session.payment_intent;
    const paymentStatus = session.payment_status;

    if (!sessionId) {
      throw new CheckoutServiceError('WEBHOOK_PAYLOAD_INVALID', 'checkout.session.completed missing session id.');
    }

    // payment_status may be 'paid' (immediate) or 'unpaid' (async — late payment)
    if (paymentStatus !== 'paid' && paymentStatus !== 'unpaid') {
      logger.warn('Stripe webhook: unexpected payment_status on session.completed', { eventId, paymentStatus });
      return;
    }

    const order = await checkoutRepository.getOrderByStripeSessionId(sessionId);
    if (!order) {
      logger.warn('Stripe webhook: order not found for session', { eventId, sessionId: _mask(sessionId) });
      return;
    }

    if (paymentStatus === 'paid') {
      // Immediate payment success
      const transitioned = await checkoutRepository.transitionOrderToPaid({
        order,
        stripePaymentIntentId: paymentIntentId || '',
        stripeEventId: eventId,
      });
      if (!transitioned) {
        logger.info('Stripe webhook: checkout.session.completed transition skipped (idempotent)', { eventId, orderId: order.orderId });
      } else {
        logger.info('Stripe webhook: order transitioned to paid', { eventId, orderId: order.orderId });
      }
    } else {
      // Async payment — record session completion, await payment_intent success
      logger.info('Stripe webhook: checkout.session.completed with unpaid status (async payment)', { eventId, orderId: order.orderId });
    }
  }

  /**
   * Handle checkout.session.expired — session timed out without payment.
   * @private
   */
  async function _handleCheckoutSessionExpired({ event, eventId, session }) {
    const sessionId = session.id;
    if (!sessionId) return;

    const order = await checkoutRepository.getOrderByStripeSessionId(sessionId);
    if (!order) {
      logger.warn('Stripe webhook: order not found for expired session', { eventId, sessionId: _mask(sessionId) });
      return;
    }

    const transitioned = await checkoutRepository.transitionOrderPaymentFailed({
      order,
      reason: 'session_expired',
      stripeEventId: eventId,
    });

    if (transitioned) {
      logger.info('Stripe webhook: order transitioned to payment_failed (session expired)', { eventId, orderId: order.orderId });
    } else {
      logger.info('Stripe webhook: session.expired transition skipped (stale or idempotent)', { eventId, orderId: order.orderId });
    }
  }

  /**
   * Handle payment_intent.payment_failed — captures late-payment failures.
   * @private
   */
  async function _handlePaymentIntentFailed({ event, eventId, paymentIntent }) {
    const piId = paymentIntent.id;
    const sessionId = paymentIntent.metadata?.checkout_session_id || null;

    // We need to find the order. Payment intents on Checkout sessions have
    // the session ID in their metadata. If not present, we look up by PI ID
    // via order records (best-effort).
    let order = null;

    if (sessionId) {
      order = await checkoutRepository.getOrderByStripeSessionId(sessionId);
    }

    if (!order && piId) {
      // Fallback: scan by payment intent ID is not supported without an index.
      // Log and skip; this is non-critical as session.expired covers the case.
      logger.warn('Stripe webhook: payment_intent.payment_failed without resolvable order', { eventId, hasSessionId: !!sessionId });
      return;
    }

    if (!order) return;

    const failureMessage = paymentIntent.last_payment_error?.message || 'payment_failed';
    const transitioned = await checkoutRepository.transitionOrderPaymentFailed({
      order,
      reason: `payment_intent_failed:${failureMessage.slice(0, 100)}`,
      stripeEventId: eventId,
    });

    if (transitioned) {
      logger.info('Stripe webhook: order transitioned to payment_failed (PI failed)', { eventId, orderId: order.orderId });
    }
  }

  /**
   * Handle charge.refunded — full or partial refund issued.
   * @private
   */
  async function _handleChargeRefunded({ event, eventId, charge }) {
    const sessionId = charge.metadata?.checkout_session_id || null;
    const refundAmountCents = charge.amount_refunded;
    // Find the most recent refund object
    const refunds = charge.refunds?.data || [];
    const latestRefund = refunds[0];
    const stripeRefundId = latestRefund?.id || charge.id;

    if (!sessionId) {
      logger.warn('Stripe webhook: charge.refunded missing session metadata', { eventId });
      return;
    }

    const order = await checkoutRepository.getOrderByStripeSessionId(sessionId);
    if (!order) {
      logger.warn('Stripe webhook: order not found for refunded charge', { eventId, sessionId: _mask(sessionId) });
      return;
    }

    const transitioned = await checkoutRepository.transitionOrderToRefunded({
      order,
      refundAmountCents: refundAmountCents || 0,
      stripeEventId: eventId,
      stripeRefundId,
    });

    if (transitioned) {
      logger.info('Stripe webhook: order transitioned to refunded', { eventId, orderId: order.orderId });
    } else {
      logger.info('Stripe webhook: refund transition skipped (stale or idempotent)', { eventId, orderId: order.orderId });
    }
  }

  /**
   * Handle charge dispute events (chargeback).
   * @private
   */
  async function _handleChargeDispute({ event, eventId, dispute, eventType }) {
    const chargeId = dispute.charge;
    const stripeDisputeId = dispute.id;

    // Disputes have a charge ID; we need the session ID from the charge metadata.
    // For now, we use the dispute's payment_intent field if available.
    const sessionId = dispute.metadata?.checkout_session_id || null;

    if (!sessionId) {
      logger.warn('Stripe webhook: dispute event missing session metadata', { eventId, eventType, disputeId: stripeDisputeId });
      return;
    }

    const order = await checkoutRepository.getOrderByStripeSessionId(sessionId);
    if (!order) {
      logger.warn('Stripe webhook: order not found for dispute', { eventId, disputeId: stripeDisputeId });
      return;
    }

    if (eventType === 'charge.dispute.created' || eventType === 'charge.dispute.updated') {
      const transitioned = await checkoutRepository.transitionOrderToDisputed({
        order,
        stripeDisputeId,
        stripeEventId: eventId,
      });

      if (transitioned) {
        logger.info('Stripe webhook: order transitioned to disputed', { eventId, orderId: order.orderId, eventType });
      } else {
        logger.info('Stripe webhook: dispute transition skipped (idempotent or stale)', { eventId, orderId: order.orderId });
      }
    } else if (eventType === 'charge.dispute.closed') {
      logger.info('Stripe webhook: dispute closed (no state change required)', { eventId, orderId: order.orderId, disputeStatus: dispute.status });
    }
  }

  /**
   * Mask sensitive string values for safe logging (shows prefix only).
   * @private
   */
  function _mask(value) {
    if (typeof value !== 'string') return '[unknown]';
    return value.length > 8 ? `${value.slice(0, 6)}...` : '[masked]';
  }

  return { startCheckout, handleWebhookEvent };
}

module.exports = { createCheckoutService, CheckoutServiceError, SHIPPING_CENTS, stripeKey, HANDLED_EVENT_TYPES };
