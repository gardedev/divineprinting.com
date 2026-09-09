'use strict';

const crypto = require('crypto');
const { GetCommand, PutCommand, QueryCommand, TransactWriteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../utils/dynamoDbClient');
const { customerPointerId } = require('../carts/cartRepository');

const DEFAULT_TABLES = Object.freeze({
  carts: 'divine-printing-carts',
  orders: 'divine-printing-orders-v2',
  orderItems: 'divine-printing-order-items-v2',
  stripeEvents: 'divine-printing-stripe-events',
});
const MAX_TRANSACTION_ACTIONS = 100;
const MAX_TRANSACTION_BYTES = 3.5 * 1024 * 1024;
const TRANSACTION_ACTION_OVERHEAD_BYTES = 1024;
const STRIPE_CHECKOUT_SESSION_INDEX = 'StripeCheckoutSessionIndex';

class CheckoutRepositoryError extends Error {
  constructor(code, message, cause) {
    super(message || code); this.name = 'CheckoutRepositoryError'; this.code = code; this.isDomainError = true;
    if (cause) this.cause = cause;
  }
}

function deterministicId(namespace, value) {
  const raw = crypto.createHmac('sha256', namespace).update(value).digest('hex');
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20, 32)}`;
}

function estimateTransactionBytes(transactItems) {
  return (Buffer.byteLength(JSON.stringify(transactItems), 'utf8') * 2) +
    (transactItems.length * TRANSACTION_ACTION_OVERHEAD_BYTES);
}

function assertTransactionSafe(transactItems) {
  if (transactItems.length > MAX_TRANSACTION_ACTIONS) throw new CheckoutRepositoryError('CHECKOUT_TOO_LARGE', 'The cart is too large for atomic checkout.');
  if (estimateTransactionBytes(transactItems) > MAX_TRANSACTION_BYTES) throw new CheckoutRepositoryError('CHECKOUT_TOO_LARGE', 'The cart is too large for atomic checkout.');
}

function createCheckoutRepository({ client = docClient, tables = {}, now = () => new Date() } = {}) {
  const names = { ...DEFAULT_TABLES, ...tables };

  async function getOrder(orderId) {
    const response = await client.send(new GetCommand({ TableName: names.orders, Key: { orderId }, ConsistentRead: true }));
    return response.Item || null;
  }

  async function getCheckout(orderId) {
    const order = await getOrder(orderId);
    if (!order) return null;
    const response = await client.send(new QueryCommand({ TableName: names.orderItems, KeyConditionExpression: '#orderId = :orderId', ExpressionAttributeNames: { '#orderId': 'orderId' }, ExpressionAttributeValues: { ':orderId': orderId } }));
    return { order, items: response.Items || [] };
  }

  async function createPendingCheckout({ prepared, orderNumber }) {
    const { proposedOrder, proposedItems, idempotency } = prepared;
    const orderId = deterministicId('divine-printing-checkout-order-v1', idempotency.scope + ':' + idempotency.key);
    const existing = await getOrder(orderId);
    if (existing) {
      if (existing.idempotencyFingerprint !== idempotency.fingerprint) throw new CheckoutRepositoryError('CHECKOUT_IDEMPOTENCY_CONFLICT', 'Checkout key was reused for different cart data.');
      return { order: existing, idempotentReplay: true };
    }
    if (proposedItems.length > 96) throw new CheckoutRepositoryError('CHECKOUT_TOO_LARGE', 'The cart is too large for atomic checkout.');
    const at = now().toISOString();
    const order = {
      ...proposedOrder, orderId, orderNumber, orderState: 'checkout_pending', paymentState: 'not_started',
      checkoutAttemptStatus: 'pending_stripe_creation', idempotencyKey: idempotency.key,
      idempotencyFingerprint: idempotency.fingerprint, createdAt: at, updatedAt: at, version: 1,
    };
    const items = proposedItems.map((item, index) => ({ ...item, orderId, orderItemId: deterministicId('divine-printing-checkout-item-v1', `${orderId}:${index}`), createdAt: at, updatedAt: at, version: 1 }));
    const transaction = [
      { Update: { TableName: names.carts, Key: { cartId: proposedOrder.cartId }, UpdateExpression: 'SET #status = :pending, #checkoutOrderId = :orderId, #updatedAt = :at, #version = :nextVersion', ConditionExpression: '#customerId = :customerId AND #status = :active AND #version = :expectedVersion AND attribute_not_exists(#convertedToOrderId)', ExpressionAttributeNames: { '#customerId': 'customerId', '#status': 'status', '#checkoutOrderId': 'checkoutOrderId', '#updatedAt': 'updatedAt', '#version': 'version', '#convertedToOrderId': 'convertedToOrderId' }, ExpressionAttributeValues: { ':customerId': proposedOrder.customerId, ':active': 'active', ':pending': 'pending_checkout', ':expectedVersion': proposedOrder.cartVersion, ':nextVersion': proposedOrder.cartVersion + 1, ':orderId': orderId, ':at': at } } },
      { ConditionCheck: { TableName: names.carts, Key: { cartId: customerPointerId(proposedOrder.customerId) }, ConditionExpression: '#activeCartId = :cartId', ExpressionAttributeNames: { '#activeCartId': 'activeCartId' }, ExpressionAttributeValues: { ':cartId': proposedOrder.cartId } } },
      { Put: { TableName: names.orders, Item: order, ConditionExpression: 'attribute_not_exists(orderId)' } },
      ...items.map((item) => ({ Put: { TableName: names.orderItems, Item: item, ConditionExpression: 'attribute_not_exists(orderId) AND attribute_not_exists(orderItemId)' } })),
      { Put: { TableName: names.orders, Item: { orderId: `ORDER_NUMBER#${crypto.createHash('sha256').update(orderNumber).digest('hex')}`, recordType: 'ORDER_NUMBER_RESERVATION', reservedOrderId: orderId, createdAt: at }, ConditionExpression: 'attribute_not_exists(orderId)' } },
    ];
    assertTransactionSafe(transaction);
    try {
      await client.send(new TransactWriteCommand({ TransactItems: transaction, ClientRequestToken: deterministicId('checkout-transaction-token-v1', `${orderId}:create`).replace(/-/g, '').slice(0, 36) }));
      return { order, items, idempotentReplay: false };
    } catch (error) {
      if (error?.name === 'TransactionCanceledException') throw new CheckoutRepositoryError('CHECKOUT_CONFLICT', 'The cart changed or checkout is already in progress.', error);
      throw new CheckoutRepositoryError('CHECKOUT_PERSISTENCE_FAILED', 'Checkout could not be started.', error);
    }
  }

  async function persistStripeSession({ orderId, expectedVersion, session }) {
    try {
      const response = await client.send(new UpdateCommand({ TableName: names.orders, Key: { orderId }, UpdateExpression: 'SET #paymentState = :created, #attempt = :linked, #sessionId = :sessionId, #sessionExpiresAt = :expiresAt, #updatedAt = :at, #version = :nextVersion', ConditionExpression: '#version = :expectedVersion AND #paymentState = :notStarted AND #attempt = :pending', ExpressionAttributeNames: { '#paymentState': 'paymentState', '#attempt': 'checkoutAttemptStatus', '#sessionId': 'stripeCheckoutSessionId', '#sessionExpiresAt': 'stripeCheckoutSessionExpiresAt', '#updatedAt': 'updatedAt', '#version': 'version' }, ExpressionAttributeValues: { ':created': 'checkout_session_created', ':linked': 'stripe_session_linked', ':sessionId': session.id, ':expiresAt': session.expiresAt, ':at': now().toISOString(), ':nextVersion': expectedVersion + 1, ':expectedVersion': expectedVersion, ':notStarted': 'not_started', ':pending': 'pending_stripe_creation' }, ReturnValues: 'ALL_NEW' }));
      return response.Attributes;
    } catch (error) {
      throw new CheckoutRepositoryError('CHECKOUT_SESSION_PERSISTENCE_FAILED', 'Checkout Session linkage could not be saved.', error);
    }
  }

  async function recordStripeFailureAndUnlock({ order, failureCode }) {
    const at = now().toISOString();
    try {
      await client.send(new TransactWriteCommand({ TransactItems: [
        { Update: { TableName: names.orders, Key: { orderId: order.orderId }, UpdateExpression: 'SET #attempt = :failed, #failureCode = :failureCode, #updatedAt = :at, #version = :nextOrderVersion', ConditionExpression: '#version = :orderVersion AND #attempt = :pending AND #paymentState = :notStarted', ExpressionAttributeNames: { '#attempt': 'checkoutAttemptStatus', '#failureCode': 'checkoutFailureCode', '#updatedAt': 'updatedAt', '#version': 'version', '#paymentState': 'paymentState' }, ExpressionAttributeValues: { ':failed': 'stripe_creation_failed', ':failureCode': failureCode, ':at': at, ':nextOrderVersion': order.version + 1, ':orderVersion': order.version, ':pending': 'pending_stripe_creation', ':notStarted': 'not_started' } } },
        { Update: { TableName: names.carts, Key: { cartId: order.cartId }, UpdateExpression: 'SET #status = :active, #updatedAt = :at, #version = :nextCartVersion REMOVE #checkoutOrderId', ConditionExpression: '#customerId = :customerId AND #status = :pending AND #checkoutOrderId = :orderId AND #version = :cartVersion', ExpressionAttributeNames: { '#customerId': 'customerId', '#status': 'status', '#checkoutOrderId': 'checkoutOrderId', '#updatedAt': 'updatedAt', '#version': 'version' }, ExpressionAttributeValues: { ':customerId': order.customerId, ':active': 'active', ':pending': 'pending_checkout', ':orderId': order.orderId, ':cartVersion': order.cartVersion + 1, ':nextCartVersion': order.cartVersion + 2, ':at': at } } },
      ] }));
      return true;
    } catch (error) {
      throw new CheckoutRepositoryError('CHECKOUT_COMPENSATION_FAILED', 'Checkout recovery requires retry.', error);
    }
  }

  /**
   * Attempt to atomically claim a Stripe event for idempotent processing.
   * Returns { claimed, alreadyProcessed, duplicate }.
   */
  async function claimStripeEvent({ eventId, eventType, stripeCreatedAt }) {
    const at = now().toISOString();
    const ttl = Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60);
    const item = {
      stripeEventId: eventId,
      eventType,
      status: 'processing',
      claimedAt: at,
      stripeCreatedAt: typeof stripeCreatedAt === 'number' ? new Date(stripeCreatedAt * 1000).toISOString() : at,
      ttl,
    };
    try {
      await client.send(new PutCommand({
        TableName: names.stripeEvents,
        Item: item,
        ConditionExpression: 'attribute_not_exists(stripeEventId)',
      }));
      return { claimed: true, alreadyProcessed: false, duplicate: false };
    } catch (error) {
      if (error?.name === 'ConditionalCheckFailedException') {
        try {
          const existing = await client.send(new GetCommand({
            TableName: names.stripeEvents,
            Key: { stripeEventId: eventId },
            ConsistentRead: true,
          }));
          const existingItem = existing.Item;
          if (existingItem?.status === 'processed') {
            return { claimed: false, alreadyProcessed: true, duplicate: false };
          }
          return { claimed: false, alreadyProcessed: false, duplicate: true };
        } catch (readError) {
          throw new CheckoutRepositoryError('STRIPE_EVENT_CLAIM_FAILED', 'Could not check Stripe event status.', readError);
        }
      }
      throw new CheckoutRepositoryError('STRIPE_EVENT_CLAIM_FAILED', 'Could not claim Stripe event for processing.', error);
    }
  }

  /**
   * Mark a claimed Stripe event as successfully processed.
   */
  async function markStripeEventProcessed({ eventId, result }) {
    const at = now().toISOString();
    try {
      await client.send(new UpdateCommand({
        TableName: names.stripeEvents,
        Key: { stripeEventId: eventId },
        UpdateExpression: 'SET #status = :processed, #processedAt = :at' + (result ? ', #result = :result' : ''),
        ConditionExpression: '#status = :processing',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#processedAt': 'processedAt',
          ...(result ? { '#result': 'result' } : {}),
        },
        ExpressionAttributeValues: {
          ':processed': 'processed',
          ':processing': 'processing',
          ':at': at,
          ...(result ? { ':result': result } : {}),
        },
      }));
    } catch (error) {
      if (error?.name !== 'ConditionalCheckFailedException') {
        throw new CheckoutRepositoryError('STRIPE_EVENT_MARK_FAILED', 'Could not mark Stripe event as processed.', error);
      }
    }
  }

  /**
   * Mark a claimed Stripe event as failed (best-effort, does not mask original error).
   */
  async function markStripeEventFailed({ eventId, errorCode }) {
    const at = now().toISOString();
    try {
      await client.send(new UpdateCommand({
        TableName: names.stripeEvents,
        Key: { stripeEventId: eventId },
        UpdateExpression: 'SET #status = :failed, #failedAt = :at' + (errorCode ? ', #errorCode = :errorCode' : ''),
        ConditionExpression: '#status = :processing',
        ExpressionAttributeNames: {
          '#status': 'status',
          '#failedAt': 'failedAt',
          ...(errorCode ? { '#errorCode': 'errorCode' } : {}),
        },
        ExpressionAttributeValues: {
          ':failed': 'failed',
          ':processing': 'processing',
          ':at': at,
          ...(errorCode ? { ':errorCode': errorCode } : {}),
        },
      }));
    } catch (_err) {
      // Best-effort only.
    }
  }

  /**
   * Retrieve an order by its Stripe Checkout Session ID via GSI.
   */
  async function getOrderByStripeSessionId(sessionId) {
    try {
      const response = await client.send(new QueryCommand({
        TableName: names.orders,
        IndexName: STRIPE_CHECKOUT_SESSION_INDEX,
        KeyConditionExpression: '#sessionId = :sessionId',
        ExpressionAttributeNames: { '#sessionId': 'stripeCheckoutSessionId' },
        ExpressionAttributeValues: { ':sessionId': sessionId },
        Limit: 1,
      }));
      const item = (response.Items || [])[0];
      if (!item) return null;
      return await getOrder(item.orderId);
    } catch (error) {
      throw new CheckoutRepositoryError('ORDER_LOOKUP_FAILED', 'Order lookup by session ID failed.', error);
    }
  }

  /**
   * Transition order to paid state atomically, converting the cart to completed.
   * Idempotent: returns false if already paid.
   */
  async function transitionOrderToPaid({ order, stripePaymentIntentId, stripeEventId }) {
    if (order.paymentState === 'paid') return false;

    const at = now().toISOString();
    const transactItems = [
      {
        Update: {
          TableName: names.orders,
          Key: { orderId: order.orderId },
          UpdateExpression: 'SET #paymentState = :paid, #orderState = :confirmed, #stripePaymentIntentId = :piId, #lastStripeEventId = :eventId, #paidAt = :at, #updatedAt = :at, #version = :nextVersion',
          ConditionExpression: 'attribute_exists(orderId) AND (#paymentState = :sessionCreated OR #paymentState = :notStarted)',
          ExpressionAttributeNames: {
            '#paymentState': 'paymentState',
            '#orderState': 'orderState',
            '#stripePaymentIntentId': 'stripePaymentIntentId',
            '#lastStripeEventId': 'lastStripeEventId',
            '#paidAt': 'paidAt',
            '#updatedAt': 'updatedAt',
            '#version': 'version',
          },
          ExpressionAttributeValues: {
            ':paid': 'paid',
            ':confirmed': 'confirmed',
            ':piId': stripePaymentIntentId,
            ':eventId': stripeEventId,
            ':at': at,
            ':nextVersion': order.version + 1,
            ':sessionCreated': 'checkout_session_created',
            ':notStarted': 'not_started',
          },
        },
      },
      {
        Update: {
          TableName: names.carts,
          Key: { cartId: order.cartId },
          UpdateExpression: 'SET #status = :converted, #convertedToOrderId = :orderId, #updatedAt = :at, #version = :nextCartVersion REMOVE #checkoutOrderId',
          ConditionExpression: 'attribute_exists(cartId)',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#convertedToOrderId': 'convertedToOrderId',
            '#checkoutOrderId': 'checkoutOrderId',
            '#updatedAt': 'updatedAt',
            '#version': 'version',
          },
          ExpressionAttributeValues: {
            ':converted': 'converted',
            ':orderId': order.orderId,
            ':at': at,
            ':nextCartVersion': order.cartVersion + 2,
          },
        },
      },
    ];

    try {
      await client.send(new TransactWriteCommand({ TransactItems: transactItems }));
      return true;
    } catch (error) {
      if (error?.name === 'TransactionCanceledException') {
        const refreshed = await getOrder(order.orderId);
        if (refreshed?.paymentState === 'paid') return false;
        throw new CheckoutRepositoryError('ORDER_TRANSITION_CONFLICT', 'Order payment transition conflict.', error);
      }
      throw new CheckoutRepositoryError('ORDER_TRANSITION_FAILED', 'Order could not be marked as paid.', error);
    }
  }

  /**
   * Transition order to payment_failed state, unlocking the cart for retry.
   * Idempotent: returns false if already in a terminal payment state.
   */
  async function transitionOrderPaymentFailed({ order, reason, stripeEventId }) {
    const terminalStates = ['payment_failed', 'expired', 'cancelled', 'paid', 'refunded', 'disputed'];
    if (terminalStates.includes(order.paymentState)) return false;

    const at = now().toISOString();
    try {
      await client.send(new UpdateCommand({
        TableName: names.orders,
        Key: { orderId: order.orderId },
        UpdateExpression: 'SET #paymentState = :failed, #orderState = :cancelled, #paymentFailureReason = :reason, #lastStripeEventId = :eventId, #updatedAt = :at, #version = :nextVersion',
        ConditionExpression: 'attribute_exists(orderId) AND (#paymentState = :sessionCreated OR #paymentState = :notStarted)',
        ExpressionAttributeNames: {
          '#paymentState': 'paymentState',
          '#orderState': 'orderState',
          '#paymentFailureReason': 'paymentFailureReason',
          '#lastStripeEventId': 'lastStripeEventId',
          '#updatedAt': 'updatedAt',
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':failed': 'payment_failed',
          ':cancelled': 'cancelled',
          ':reason': reason,
          ':eventId': stripeEventId,
          ':at': at,
          ':nextVersion': order.version + 1,
          ':sessionCreated': 'checkout_session_created',
          ':notStarted': 'not_started',
        },
      }));
      return true;
    } catch (error) {
      if (error?.name === 'ConditionalCheckFailedException') return false;
      throw new CheckoutRepositoryError('ORDER_TRANSITION_FAILED', 'Order payment failure could not be recorded.', error);
    }
  }

  /**
   * Transition order to refunded state.
   * Idempotent: returns false if already refunded.
   */
  async function transitionOrderToRefunded({ order, refundAmountCents, stripeEventId, stripeRefundId }) {
    if (order.paymentState === 'refunded') return false;

    const at = now().toISOString();
    try {
      await client.send(new UpdateCommand({
        TableName: names.orders,
        Key: { orderId: order.orderId },
        UpdateExpression: 'SET #paymentState = :refunded, #refundedAt = :at, #refundAmountCents = :refundAmount, #stripeRefundId = :stripeRefundId, #lastStripeEventId = :eventId, #updatedAt = :at, #version = :nextVersion',
        ConditionExpression: 'attribute_exists(orderId) AND (#paymentState = :paid OR #paymentState = :disputed)',
        ExpressionAttributeNames: {
          '#paymentState': 'paymentState',
          '#refundedAt': 'refundedAt',
          '#refundAmountCents': 'refundAmountCents',
          '#stripeRefundId': 'stripeRefundId',
          '#lastStripeEventId': 'lastStripeEventId',
          '#updatedAt': 'updatedAt',
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':refunded': 'refunded',
          ':refundAmount': refundAmountCents,
          ':stripeRefundId': stripeRefundId,
          ':eventId': stripeEventId,
          ':at': at,
          ':nextVersion': order.version + 1,
          ':paid': 'paid',
          ':disputed': 'disputed',
        },
      }));
      return true;
    } catch (error) {
      if (error?.name === 'ConditionalCheckFailedException') return false;
      throw new CheckoutRepositoryError('ORDER_TRANSITION_FAILED', 'Order refund could not be recorded.', error);
    }
  }

  /**
   * Transition order to disputed state (chargeback opened).
   * Idempotent: returns false if already disputed.
   */
  async function transitionOrderToDisputed({ order, stripeDisputeId, stripeEventId }) {
    if (order.paymentState === 'disputed') return false;

    const at = now().toISOString();
    try {
      await client.send(new UpdateCommand({
        TableName: names.orders,
        Key: { orderId: order.orderId },
        UpdateExpression: 'SET #paymentState = :disputed, #stripeDisputeId = :disputeId, #lastStripeEventId = :eventId, #disputedAt = :at, #updatedAt = :at, #version = :nextVersion',
        ConditionExpression: 'attribute_exists(orderId) AND #paymentState = :paid',
        ExpressionAttributeNames: {
          '#paymentState': 'paymentState',
          '#stripeDisputeId': 'stripeDisputeId',
          '#lastStripeEventId': 'lastStripeEventId',
          '#disputedAt': 'disputedAt',
          '#updatedAt': 'updatedAt',
          '#version': 'version',
        },
        ExpressionAttributeValues: {
          ':disputed': 'disputed',
          ':disputeId': stripeDisputeId,
          ':eventId': stripeEventId,
          ':at': at,
          ':nextVersion': order.version + 1,
          ':paid': 'paid',
        },
      }));
      return true;
    } catch (error) {
      if (error?.name === 'ConditionalCheckFailedException') return false;
      throw new CheckoutRepositoryError('ORDER_TRANSITION_FAILED', 'Order dispute could not be recorded.', error);
    }
  }

  return {
    createPendingCheckout,
    persistStripeSession,
    recordStripeFailureAndUnlock,
    getOrder,
    getCheckout,
    getOrderByStripeSessionId,
    claimStripeEvent,
    markStripeEventProcessed,
    markStripeEventFailed,
    transitionOrderToPaid,
    transitionOrderPaymentFailed,
    transitionOrderToRefunded,
    transitionOrderToDisputed,
  };
}

module.exports = { createCheckoutRepository, CheckoutRepositoryError, deterministicId, estimateTransactionBytes, assertTransactionSafe, DEFAULT_TABLES, MAX_TRANSACTION_ACTIONS, MAX_TRANSACTION_BYTES, STRIPE_CHECKOUT_SESSION_INDEX };
