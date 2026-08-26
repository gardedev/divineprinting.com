'use strict';

const crypto = require('crypto');
const { GetCommand, QueryCommand, TransactWriteCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../utils/dynamoDbClient');
const { customerPointerId } = require('../carts/cartRepository');

const DEFAULT_TABLES = Object.freeze({
  carts: 'divine-printing-carts',
  orders: 'divine-printing-orders-v2',
  orderItems: 'divine-printing-order-items-v2',
});
const MAX_TRANSACTION_ACTIONS = 100;
// Stay 512 KiB below DynamoDB's 4 MiB hard limit. The estimator doubles the
// canonical JSON byte size and adds per-action overhead to conservatively cover
// DynamoDB AttributeValue/type metadata not visible in DocumentClient input.
const MAX_TRANSACTION_BYTES = 3.5 * 1024 * 1024;
const TRANSACTION_ACTION_OVERHEAD_BYTES = 1024;

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
      await client.send(new TransactWriteCommand({ TransactItems: transaction, ClientRequestToken: idempotency.fingerprint.slice(0, 36) }));
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

  return { createPendingCheckout, persistStripeSession, recordStripeFailureAndUnlock, getOrder, getCheckout };
}

module.exports = { createCheckoutRepository, CheckoutRepositoryError, deterministicId, estimateTransactionBytes, assertTransactionSafe, DEFAULT_TABLES, MAX_TRANSACTION_ACTIONS, MAX_TRANSACTION_BYTES };
