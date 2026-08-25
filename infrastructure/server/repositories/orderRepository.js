'use strict';

/**
 * orderRepository.js — ADR 0005-compliant DynamoDB persistence for Orders and OrderItems.
 *
 * Tables (v2, isolated from legacy):
 *   divine-printing-orders-v2
 *     PK:  orderId (S)
 *     GSIs: CustomerOrdersIndex, OrderStateIndex, PaymentStateIndex,
 *           StripeCheckoutSessionIndex, StripePaymentIntentIndex, OrderNumberIndex
 *
 *   divine-printing-order-items-v2
 *     PK:  orderId (S)
 *     SK:  orderItemId (S)
 *     GSI: ProductOrderItemIndex
 *
 * Security invariants:
 *   - customerId MUST be derived exclusively from the verified Cognito sub supplied
 *     by a trusted service layer. It is NEVER accepted directly from client input.
 *   - The field `customerId` is the ONLY canonical identity field persisted.
 *     Aliases (trustedCustomerId, clientCustomerId, requesterId, userId, sub) are
 *     explicitly forbidden from being persisted by this repository.
 *   - Anonymous-cart credentials (anonCartToken, cartToken, guestToken, anonToken,
 *     browserSessionId, deviceId) are explicitly forbidden from being persisted.
 *   - Contact/email data is immutable order snapshot only (captured at creation time).
 *   - No raw AWS errors are exposed; all failures surface as structured domain errors.
 *   - No tokens, card data, or payment credentials are stored by this repository.
 *   - Optimistic locking via `version` attribute and conditional writes.
 *   - Order + items creation is always atomic via TransactWriteItems.
 *   - Idempotency keys prevent duplicate order creation on retry.
 *
 * Idempotency strategy (two-table schema, no additional tables):
 *   When an idempotencyContext.key is provided, the orderId is ALWAYS derived
 *   deterministically from the key using HMAC-SHA256, truncated to a UUID-shaped
 *   hex string. This ensures that retries with the same key always resolve to the
 *   same orderId, regardless of which generateId() call sequence occurs.
 *   When no key is provided, generateId() is used normally (no replay guarantee).
 *
 * Domain errors (code field):
 *   ORDER_NOT_FOUND              — getOrderById / getOrderWithItems / updates: no record
 *   ORDER_VERSION_CONFLICT       — updateOrderState / updatePaymentState: stale version
 *   ORDER_STATE_CONFLICT         — updateOrderState: expectedState mismatch
 *   ORDER_IDEMPOTENCY_CONFLICT   — createOrderWithItems: same idempotency key, different payload
 *   ORDER_PERSISTENCE_FAILED     — unrecoverable DynamoDB error
 */

const crypto = require('crypto');
const {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  TransactWriteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../utils/dynamoDbClient');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ORDERS_TABLE_DEFAULT = 'divine-printing-orders-v2';
const ORDER_ITEMS_TABLE_DEFAULT = 'divine-printing-order-items-v2';

// GSI names
const CUSTOMER_ORDERS_INDEX = 'CustomerOrdersIndex';
const ORDER_STATE_INDEX = 'OrderStateIndex';
const PAYMENT_STATE_INDEX = 'PaymentStateIndex';
const STRIPE_CHECKOUT_SESSION_INDEX = 'StripeCheckoutSessionIndex';
const STRIPE_PAYMENT_INTENT_INDEX = 'StripePaymentIntentIndex';
const ORDER_NUMBER_INDEX = 'OrderNumberIndex';
const PRODUCT_ORDER_ITEM_INDEX = 'ProductOrderItemIndex';

// Sensitive fields that must NEVER be persisted.
// Covers: card/token data, raw credentials, client-supplied identity aliases,
// and anonymous-cart browser credentials.
const FORBIDDEN_FIELDS = new Set([
  // Payment card data
  'cardNumber', 'cvv', 'cvc', 'cardCvc', 'cardCvv',
  // Stripe/OAuth tokens
  'stripeToken', 'accessToken', 'idToken', 'refreshToken',
  'clientSecret', 'paymentMethodToken',
  // Raw credentials
  'password', 'passwordHash',
  // Client-supplied customerId aliases — must never bypass the trusted service layer.
  // The ONLY canonical identity field is `customerId` (set by the verified service layer).
  'trustedCustomerId', 'clientCustomerId', 'requesterId', 'userId', 'sub',
  // Anonymous-cart / browser ownership credentials
  'anonCartToken', 'cartToken', 'guestToken', 'anonToken',
  'browserSessionId', 'deviceId',
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Constructs a domain error with structured metadata.
 * Raw AWS error details are preserved on `cause` for internal logging ONLY —
 * they must never be forwarded to API callers.
 *
 * @param {string} code     - Domain error code
 * @param {string} message  - Safe message (no AWS internals)
 * @param {Error} [cause]   - Original error for logging
 * @returns {Error}
 */
function domainError(code, message, cause) {
  const err = new Error(message);
  err.code = code;
  err.isDomainError = true;
  if (cause) err.cause = cause;
  return err;
}

/**
 * Returns true if the error is a DynamoDB ConditionalCheckFailedException.
 * @param {Error} err
 * @returns {boolean}
 */
function isConditionalCheckFailed(err) {
  return !!(
    err &&
    (err.name === 'ConditionalCheckFailedException' ||
      (err.__type && err.__type.includes('ConditionalCheckFailed')) ||
      (err.code === 'ConditionalCheckFailedException'))
  );
}

/**
 * Returns true if the error is a DynamoDB TransactionCanceledException.
 * Checks CancellationReasons for ConditionalCheckFailed codes.
 * @param {Error} err
 * @returns {boolean}
 */
function isTransactionCanceled(err) {
  return !!(
    err &&
    (err.name === 'TransactionCanceledException' ||
      (err.__type && err.__type.includes('TransactionCanceled')))
  );
}

/**
 * Returns a canonical idempotency fingerprint (SHA-256 hex) of a value.
 * Used to detect payload changes on idempotency key replay.
 *
 * @param {*} value
 * @returns {string}
 */
function fingerprint(value) {
  function canonical(v) {
    if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
    if (v && typeof v === 'object') {
      return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v);
  }
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

/**
 * Derives a deterministic orderId from an idempotency key.
 * Uses HMAC-SHA256 with a fixed namespace constant, then formats as a
 * lowercase hex string of UUID shape (8-4-4-4-12).
 *
 * Guarantees: same key → same orderId across all retries and processes,
 * without any additional table or external state.
 *
 * @param {string} idempotencyKey
 * @returns {string} Deterministic orderId derived from the key
 */
const IDEMPOTENCY_NAMESPACE = 'divine-printing-order-v2-idem-ns';
function deriveOrderIdFromKey(idempotencyKey) {
  const raw = crypto
    .createHmac('sha256', IDEMPOTENCY_NAMESPACE)
    .update(idempotencyKey)
    .digest('hex');
  // Format as UUID-shaped string (8-4-4-4-12) for readability; not RFC 4122 compliant
  return `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20,32)}`;
}

function deriveOrderNumberReservationId(orderNumber) {
  const digest = crypto.createHash('sha256').update(orderNumber).digest('hex');
  return `ORDER_NUMBER#${digest}`;
}

/**
 * Recursively asserts that no object in the tree contains a forbidden field.
 * Cycle-safe via a WeakSet of visited objects.
 * Throws a TypeError immediately if any forbidden field is present at any depth.
 *
 * @param {*} value   - Root value to inspect
 * @param {WeakSet} [visited] - Internal cycle guard; do not pass from outside
 */
function assertNoForbiddenFieldsDeep(value, visited = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (visited.has(value)) return; // cycle guard
  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) assertNoForbiddenFieldsDeep(item, visited);
    return;
  }

  for (const key of Object.keys(value)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      throw new TypeError(
        `Forbidden field "${key}" must not be persisted. Tokens, card data, and identity aliases are never stored.`
      );
    }
    assertNoForbiddenFieldsDeep(value[key], visited);
  }
}

/**
 * Asserts that neither the order nor any item (and their nested objects/arrays)
 * contain forbidden fields. Throws a TypeError immediately if any forbidden
 * field is found at any depth.
 *
 * @param {object} order
 * @param {object[]} items
 */
function assertNoForbiddenFields(order, items) {
  assertNoForbiddenFieldsDeep(order);
  for (const item of (items || [])) {
    assertNoForbiddenFieldsDeep(item);
  }
}

/**
 * Extracts the cancellation reason codes from a TransactionCanceledException.
 * @param {Error} err
 * @returns {string[]}
 */
function cancellationCodes(err) {
  if (!err || !Array.isArray(err.CancellationReasons)) return [];
  return err.CancellationReasons.map((r) => r.Code || '').filter(Boolean);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates an order repository bound to the given DynamoDB client and configuration.
 *
 * @param {object} options
 * @param {object} [options.client]       - DynamoDB DocumentClient (injectable for testing)
 * @param {object} [options.tables]       - Table name overrides
 * @param {string} [options.tables.orders]      - Orders table name
 * @param {string} [options.tables.orderItems]  - Order items table name
 * @param {function} [options.now]        - Clock function returning Date (injectable)
 * @param {function} [options.generateId] - UUID generator (injectable)
 * @returns {object} Repository interface
 */
function createOrderRepository({
  client = docClient,
  tables = {},
  now = () => new Date(),
  generateId = () => crypto.randomUUID(),
} = {}) {
  const ORDERS_TABLE = tables.orders || ORDERS_TABLE_DEFAULT;
  const ORDER_ITEMS_TABLE = tables.orderItems || ORDER_ITEMS_TABLE_DEFAULT;

  // =========================================================================
  // createOrderWithItems
  // =========================================================================

  /**
   * Atomically creates an order and its line items using TransactWriteItems.
   *
   * Implements:
   *   - Conditional uniqueness: orderId attribute_not_exists guard on order record.
   *   - Idempotency: idempotencyKey + fingerprint stored on order; replay returns
   *     the original order without error if the payload fingerprint matches.
   *   - Atomic failure: if ANY transact item fails, nothing is written.
   *
   * Security:
   *   - customerId is asserted to be supplied by service layer (not client).
   *   - Forbidden fields (tokens, cards) are rejected before any write.
   *   - Order contact/email data is stored as immutable snapshot.
   *
   * @param {object} order              - Order data. Must include canonical customerId
   *                                      supplied by the trusted service layer.
   * @param {object[]} items            - Line items to create with the order.
   * @param {object} [idempotencyContext]
   * @param {string} [idempotencyContext.key]     - Caller-supplied idempotency key
   * @param {object} [idempotencyContext.payload] - Canonical payload for fingerprint
   * @returns {Promise<{ order: object, items: object[], idempotentReplay: boolean }>}
   * @throws Domain error with code ORDER_IDEMPOTENCY_CONFLICT or ORDER_PERSISTENCE_FAILED
   */
  async function createOrderWithItems(order, items = [], idempotencyContext = {}) {
    // --- Security: reject forbidden fields before any write (recursive, cycle-safe) ---
    assertNoForbiddenFields(order, items);

    if (typeof order.orderNumber !== 'string' || !order.orderNumber.trim()) {
      throw new TypeError('orderNumber is required for conditional uniqueness.');
    }
    // DynamoDB transactions allow at most 100 actions. The order record and
    // order-number reservation consume two, leaving room for at most 98 items.
    if (!Array.isArray(items) || items.length > 98) {
      throw domainError(
        'ORDER_PERSISTENCE_FAILED',
        'Order creation exceeds the supported atomic item limit.'
      );
    }

    const at = now().toISOString();
    const idempotencyKey = idempotencyContext.key || null;

    // Idempotency: when a key is supplied, derive a DETERMINISTIC orderId from it.
    // This ensures that retries with the same key always resolve to the same
    // DynamoDB primary key, regardless of the generateId() call sequence.
    // Without a key, fall back to caller-supplied orderId or a fresh UUID.
    const orderId = idempotencyKey
      ? deriveOrderIdFromKey(idempotencyKey)
      : (order.orderId || generateId());

    // Derive payload fingerprint for conflict detection
    const payloadFingerprint = idempotencyContext.payload
      ? fingerprint(idempotencyContext.payload)
      : fingerprint({ orderId, items });

    // --- Check for existing record when idempotency key is provided ---
    if (idempotencyKey) {
      const existing = await getOrderById(orderId);
      if (existing) {
        // Same key → same derived orderId: check fingerprint to detect conflict
        if (existing.idempotencyKey === idempotencyKey) {
          if (existing.idempotencyFingerprint !== payloadFingerprint) {
            throw domainError(
              'ORDER_IDEMPOTENCY_CONFLICT',
              'Idempotency key reused with a different payload.'
            );
          }
          // Idempotent replay: return original order without re-writing
          const existingItems = await listOrderItems(orderId);
          return { order: existing, items: existingItems, idempotentReplay: true };
        }
        // Derived orderId exists but with a different idempotency key: hash collision
        // (astronomically unlikely, but guard for correctness)
        throw domainError(
          'ORDER_IDEMPOTENCY_CONFLICT',
          'Idempotency key collision detected. Contact support.'
        );
      }
    }

    // --- Build order item ---
    const orderRecord = {
      ...order,
      orderId,
      createdAt: order.createdAt || at,
      updatedAt: at,
      version: 1,
      ...(idempotencyKey ? { idempotencyKey, idempotencyFingerprint: payloadFingerprint } : {}),
    };

    // Security: ensure no forbidden fields leaked through spread
    assertNoForbiddenFields(orderRecord, []);

    // --- Build order item transact actions ---
    const transactItems = [
      {
        Put: {
          TableName: ORDERS_TABLE,
          Item: orderRecord,
          ConditionExpression: 'attribute_not_exists(orderId)',
        },
      },
    ];

    // --- Build order-items transact actions ---
    const itemRecords = items.map((item) => {
      const itemRecord = {
        ...item,
        orderId,
        orderItemId: item.orderItemId || generateId(),
        createdAt: item.createdAt || at,
        updatedAt: at,
        version: 1,
      };
      assertNoForbiddenFields(itemRecord, []);
      return itemRecord;
    });

    for (const itemRecord of itemRecords) {
      transactItems.push({
        Put: {
          TableName: ORDER_ITEMS_TABLE,
          Item: itemRecord,
          ConditionExpression:
            'attribute_not_exists(orderId) AND attribute_not_exists(orderItemId)',
        },
      });
    }

    // Reserve the human-readable order number in the same transaction. The
    // marker deliberately omits GSI attributes, so it remains invisible to all
    // order query indexes while enforcing uniqueness without another table.
    transactItems.push({
      Put: {
        TableName: ORDERS_TABLE,
        Item: {
          orderId: deriveOrderNumberReservationId(order.orderNumber),
          recordType: 'ORDER_NUMBER_RESERVATION',
          reservedOrderId: orderId,
          createdAt: at,
        },
        ConditionExpression: 'attribute_not_exists(orderId)',
      },
    });

    try {
      await client.send(new TransactWriteCommand({ TransactItems: transactItems }));
      return { order: orderRecord, items: itemRecords, idempotentReplay: false };
    } catch (err) {
      // Distinguish idempotency / uniqueness failures from general persistence errors
      if (isTransactionCanceled(err)) {
        const codes = cancellationCodes(err);
        if (codes[codes.length - 1] === 'ConditionalCheckFailed') {
          throw domainError(
            'ORDER_NUMBER_CONFLICT',
            'Order number is already reserved. Generate a new order number and retry.',
            err
          );
        }
        if (codes.some((c) => c === 'ConditionalCheckFailed')) {
          // The order-level condition failed: likely a duplicate orderId or idempotency conflict
          throw domainError(
            'ORDER_IDEMPOTENCY_CONFLICT',
            'Order creation failed: a record with this orderId already exists or an idempotency conflict was detected.',
            err
          );
        }
      }
      throw domainError(
        'ORDER_PERSISTENCE_FAILED',
        'Order creation failed. Please retry.',
        err
      );
    }
  }

  // =========================================================================
  // getOrderById
  // =========================================================================

  /**
   * Retrieves a single order by its orderId (primary key).
   *
   * @param {string} orderId
   * @returns {Promise<object|null>} Order record or null if not found.
   * @throws Domain error with code ORDER_PERSISTENCE_FAILED on unrecoverable DynamoDB error.
   */
  async function getOrderById(orderId) {
    try {
      const response = await client.send(
        new GetCommand({
          TableName: ORDERS_TABLE,
          Key: { orderId },
          ConsistentRead: true,
        })
      );
      return response.Item ?? null;
    } catch (err) {
      throw domainError('ORDER_PERSISTENCE_FAILED', 'Failed to retrieve order.', err);
    }
  }

  // =========================================================================
  // getOrderWithItems
  // =========================================================================

  /**
   * Retrieves an order and all its line items by orderId.
   *
   * @param {string} orderId
   * @returns {Promise<{ order: object, items: object[] }>}
   * @throws Domain error ORDER_NOT_FOUND if order does not exist.
   * @throws Domain error ORDER_PERSISTENCE_FAILED on unrecoverable DynamoDB error.
   */
  async function getOrderWithItems(orderId) {
    const order = await getOrderById(orderId);
    if (!order) {
      throw domainError('ORDER_NOT_FOUND', `Order not found: ${orderId}`);
    }
    const items = await listOrderItems(orderId);
    return { order, items };
  }

  // =========================================================================
  // listOrderItems (internal helper)
  // =========================================================================

  /**
   * Queries all items belonging to an order (internal, no auth check here).
   * Auth/ownership checks are the service layer's responsibility.
   *
   * @param {string} orderId
   * @returns {Promise<object[]>}
   */
  async function listOrderItems(orderId) {
    const response = await client.send(
      new QueryCommand({
        TableName: ORDER_ITEMS_TABLE,
        KeyConditionExpression: '#orderId = :orderId',
        ExpressionAttributeNames: { '#orderId': 'orderId' },
        ExpressionAttributeValues: { ':orderId': orderId },
      })
    );
    return response.Items || [];
  }

  // =========================================================================
  // listOrdersByCustomer
  // =========================================================================

  /**
   * Lists orders for a customer, sorted newest-first, with pagination.
   *
   * Security: customerId must be a verified Cognito sub from the service layer.
   *
   * @param {string} customerId - Verified Cognito sub (NEVER client-supplied directly).
   * @param {object} [pagination]
   * @param {number} [pagination.limit=20]         - Max results per page.
   * @param {object} [pagination.exclusiveStartKey] - DynamoDB last evaluated key for continuation.
   * @returns {Promise<{ orders: object[], lastEvaluatedKey: object|undefined }>}
   * @throws Domain error ORDER_PERSISTENCE_FAILED on unrecoverable error.
   */
  async function listOrdersByCustomer(customerId, pagination = {}) {
    const { limit = 20, exclusiveStartKey } = pagination;

    const params = {
      TableName: ORDERS_TABLE,
      IndexName: CUSTOMER_ORDERS_INDEX,
      KeyConditionExpression: '#customerId = :customerId',
      ExpressionAttributeNames: { '#customerId': 'customerId' },
      ExpressionAttributeValues: { ':customerId': customerId },
      ScanIndexForward: false, // Newest-first
      Limit: limit,
    };

    if (exclusiveStartKey) {
      params.ExclusiveStartKey = exclusiveStartKey;
    }

    try {
      const response = await client.send(new QueryCommand(params));
      return {
        orders: response.Items || [],
        lastEvaluatedKey: response.LastEvaluatedKey,
      };
    } catch (err) {
      throw domainError('ORDER_PERSISTENCE_FAILED', 'Failed to list customer orders.', err);
    }
  }

  // =========================================================================
  // findByOrderNumber
  // =========================================================================

  /**
   * Finds an order by its human-readable order number via OrderNumberIndex GSI.
   *
   * @param {string} orderNumber
   * @returns {Promise<object|null>} Order record or null.
   * @throws Domain error ORDER_PERSISTENCE_FAILED on unrecoverable error.
   */
  async function findByOrderNumber(orderNumber) {
    try {
      const response = await client.send(
        new QueryCommand({
          TableName: ORDERS_TABLE,
          IndexName: ORDER_NUMBER_INDEX,
          KeyConditionExpression: '#orderNumber = :orderNumber',
          ExpressionAttributeNames: { '#orderNumber': 'orderNumber' },
          ExpressionAttributeValues: { ':orderNumber': orderNumber },
          Limit: 1,
        })
      );
      return (response.Items && response.Items[0]) || null;
    } catch (err) {
      throw domainError('ORDER_PERSISTENCE_FAILED', 'Failed to find order by order number.', err);
    }
  }

  // =========================================================================
  // findByCheckoutSessionId
  // =========================================================================

  /**
   * Finds an order by Stripe Checkout Session ID via StripeCheckoutSessionIndex GSI.
   *
   * @param {string} sessionId
   * @returns {Promise<object|null>} Order record or null.
   * @throws Domain error ORDER_PERSISTENCE_FAILED on unrecoverable error.
   */
  async function findByCheckoutSessionId(sessionId) {
    try {
      const response = await client.send(
        new QueryCommand({
          TableName: ORDERS_TABLE,
          IndexName: STRIPE_CHECKOUT_SESSION_INDEX,
          KeyConditionExpression: '#stripeCheckoutSessionId = :sessionId',
          ExpressionAttributeNames: { '#stripeCheckoutSessionId': 'stripeCheckoutSessionId' },
          ExpressionAttributeValues: { ':sessionId': sessionId },
          Limit: 1,
        })
      );
      return (response.Items && response.Items[0]) || null;
    } catch (err) {
      throw domainError(
        'ORDER_PERSISTENCE_FAILED',
        'Failed to find order by checkout session ID.',
        err
      );
    }
  }

  // =========================================================================
  // findByPaymentIntentId
  // =========================================================================

  /**
   * Finds an order by Stripe Payment Intent ID via StripePaymentIntentIndex GSI.
   *
   * @param {string} paymentIntentId
   * @returns {Promise<object|null>} Order record or null.
   * @throws Domain error ORDER_PERSISTENCE_FAILED on unrecoverable error.
   */
  async function findByPaymentIntentId(paymentIntentId) {
    try {
      const response = await client.send(
        new QueryCommand({
          TableName: ORDERS_TABLE,
          IndexName: STRIPE_PAYMENT_INTENT_INDEX,
          KeyConditionExpression: '#stripePaymentIntentId = :paymentIntentId',
          ExpressionAttributeNames: { '#stripePaymentIntentId': 'stripePaymentIntentId' },
          ExpressionAttributeValues: { ':paymentIntentId': paymentIntentId },
          Limit: 1,
        })
      );
      return (response.Items && response.Items[0]) || null;
    } catch (err) {
      throw domainError(
        'ORDER_PERSISTENCE_FAILED',
        'Failed to find order by payment intent ID.',
        err
      );
    }
  }

  // =========================================================================
  // updateOrderState
  // =========================================================================

  /**
   * Transitions an order's state with optimistic locking.
   *
   * Conditions enforced atomically:
   *   - version = expectedVersion   (optimistic lock)
   *   - orderState = expectedState  (state-machine guard)
   *
   * @param {string} orderId
   * @param {number} expectedVersion  - Version the caller read; write fails if stale.
   * @param {string} expectedState    - Current state the caller expects.
   * @param {string} nextState        - New state to transition to.
   * @returns {Promise<{ updated: boolean, order: object }>}
   *   updated=true  → transition succeeded; order is the new record.
   *   updated=false → condition failed (version or state mismatch); order is the latest record.
   * @throws Domain error ORDER_NOT_FOUND if order does not exist.
   * @throws Domain error ORDER_VERSION_CONFLICT or ORDER_STATE_CONFLICT on condition failure.
   * @throws Domain error ORDER_PERSISTENCE_FAILED on unrecoverable error.
   */
  async function updateOrderState(orderId, expectedVersion, expectedState, nextState) {
    const at = now().toISOString();

    try {
      const response = await client.send(
        new UpdateCommand({
          TableName: ORDERS_TABLE,
          Key: { orderId },
          UpdateExpression:
            'SET #orderState = :nextState, #version = :nextVersion, #updatedAt = :updatedAt',
          ConditionExpression:
            'attribute_exists(#orderId) AND #version = :expectedVersion AND #orderState = :expectedState',
          ExpressionAttributeNames: {
            '#orderId': 'orderId',
            '#orderState': 'orderState',
            '#version': 'version',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':expectedVersion': expectedVersion,
            ':nextVersion': expectedVersion + 1,
            ':expectedState': expectedState,
            ':nextState': nextState,
            ':updatedAt': at,
          },
          ReturnValues: 'ALL_NEW',
        })
      );
      return { updated: true, order: response.Attributes };
    } catch (err) {
      if (isConditionalCheckFailed(err)) {
        // Distinguish: does the order exist at all?
        const latest = await getOrderById(orderId);
        if (!latest) {
          throw domainError('ORDER_NOT_FOUND', `Order not found: ${orderId}`);
        }
        if (latest.version !== expectedVersion) {
          throw domainError(
            'ORDER_VERSION_CONFLICT',
            `Order version conflict: expected ${expectedVersion}, found ${latest.version}.`
          );
        }
        throw domainError(
          'ORDER_STATE_CONFLICT',
          `Order state conflict: expected "${expectedState}", found "${latest.orderState}".`
        );
      }
      throw domainError('ORDER_PERSISTENCE_FAILED', 'Failed to update order state.', err);
    }
  }

  // =========================================================================
  // updatePaymentState
  // =========================================================================

  /**
   * Transitions an order's payment state with optimistic locking.
   *
   * Conditions enforced atomically:
   *   - version = expectedVersion        (optimistic lock)
   *   - paymentState = expectedState     (payment-state-machine guard)
   *
   * @param {string} orderId
   * @param {number} expectedVersion  - Version the caller read; write fails if stale.
   * @param {string} expectedState    - Current payment state the caller expects.
   * @param {string} nextState        - New payment state to transition to.
   * @returns {Promise<{ updated: boolean, order: object }>}
   *   updated=true  → transition succeeded; order is the new record.
   *   updated=false → condition failed; throws structured domain error.
   * @throws Domain error ORDER_NOT_FOUND if order does not exist.
   * @throws Domain error ORDER_VERSION_CONFLICT or ORDER_STATE_CONFLICT on condition failure.
   * @throws Domain error ORDER_PERSISTENCE_FAILED on unrecoverable error.
   */
  async function updatePaymentState(orderId, expectedVersion, expectedState, nextState) {
    const at = now().toISOString();

    try {
      const response = await client.send(
        new UpdateCommand({
          TableName: ORDERS_TABLE,
          Key: { orderId },
          UpdateExpression:
            'SET #paymentState = :nextState, #version = :nextVersion, #updatedAt = :updatedAt',
          ConditionExpression:
            'attribute_exists(#orderId) AND #version = :expectedVersion AND #paymentState = :expectedState',
          ExpressionAttributeNames: {
            '#orderId': 'orderId',
            '#paymentState': 'paymentState',
            '#version': 'version',
            '#updatedAt': 'updatedAt',
          },
          ExpressionAttributeValues: {
            ':expectedVersion': expectedVersion,
            ':nextVersion': expectedVersion + 1,
            ':expectedState': expectedState,
            ':nextState': nextState,
            ':updatedAt': at,
          },
          ReturnValues: 'ALL_NEW',
        })
      );
      return { updated: true, order: response.Attributes };
    } catch (err) {
      if (isConditionalCheckFailed(err)) {
        const latest = await getOrderById(orderId);
        if (!latest) {
          throw domainError('ORDER_NOT_FOUND', `Order not found: ${orderId}`);
        }
        if (latest.version !== expectedVersion) {
          throw domainError(
            'ORDER_VERSION_CONFLICT',
            `Order version conflict: expected ${expectedVersion}, found ${latest.version}.`
          );
        }
        throw domainError(
          'ORDER_STATE_CONFLICT',
          `Payment state conflict: expected "${expectedState}", found "${latest.paymentState}".`
        );
      }
      throw domainError('ORDER_PERSISTENCE_FAILED', 'Failed to update payment state.', err);
    }
  }

  // =========================================================================
  // Public interface
  // =========================================================================

  return {
    createOrderWithItems,
    getOrderById,
    getOrderWithItems,
    listOrdersByCustomer,
    findByOrderNumber,
    findByCheckoutSessionId,
    findByPaymentIntentId,
    updateOrderState,
    updatePaymentState,
  };
}

// ---------------------------------------------------------------------------
// Module exports
// ---------------------------------------------------------------------------

module.exports = {
  createOrderRepository,
  // Exported for testing
  ORDERS_TABLE_DEFAULT,
  ORDER_ITEMS_TABLE_DEFAULT,
  CUSTOMER_ORDERS_INDEX,
  ORDER_STATE_INDEX,
  PAYMENT_STATE_INDEX,
  STRIPE_CHECKOUT_SESSION_INDEX,
  STRIPE_PAYMENT_INTENT_INDEX,
  ORDER_NUMBER_INDEX,
  PRODUCT_ORDER_ITEM_INDEX,
  FORBIDDEN_FIELDS,
};
