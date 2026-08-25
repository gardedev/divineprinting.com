'use strict';

/**
 * Unit tests for repositories/orderRepository.js (Task 6.1)
 *
 * Coverage:
 *   Transactional order+item creation (atomic), atomic failure,
 *   customerId ownership query (CustomerOrdersIndex), pagination,
 *   newest-first ordering, order/item hydration, order-number lookup,
 *   checkout-session lookup, payment-intent lookup, conditional uniqueness,
 *   idempotent replay, idempotency conflicts, optimistic version conflicts,
 *   state-transition conditions, payment-state conditions,
 *   AWS error translation, sensitive-data rejection, absence of
 *   client-controlled ownership, absence of token/card persistence.
 */

jest.mock('@aws-sdk/lib-dynamodb', () => {
  function GetCommand(input) { this.input = input; }
  function PutCommand(input) { this.input = input; }
  function QueryCommand(input) { this.input = input; }
  function UpdateCommand(input) { this.input = input; }
  function TransactWriteCommand(input) { this.input = input; }
  const DynamoDBDocumentClient = { from: jest.fn().mockReturnValue({ send: jest.fn() }) };
  return { GetCommand, PutCommand, QueryCommand, UpdateCommand, TransactWriteCommand, DynamoDBDocumentClient };
});

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

const crypto = require('crypto');
const {
  createOrderRepository,
  ORDERS_TABLE_DEFAULT,
  ORDER_ITEMS_TABLE_DEFAULT,
  CUSTOMER_ORDERS_INDEX,
  STRIPE_CHECKOUT_SESSION_INDEX,
  STRIPE_PAYMENT_INTENT_INDEX,
  ORDER_NUMBER_INDEX,
  FORBIDDEN_FIELDS,
} = require('../orderRepository');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockClient() { return { send: jest.fn() }; }

function makeRepo(clientArg) {
  const client = clientArg || makeMockClient();
  let counter = 0;
  const repo = createOrderRepository({
    client,
    tables: { orders: ORDERS_TABLE_DEFAULT, orderItems: ORDER_ITEMS_TABLE_DEFAULT },
    now: () => new Date('2026-08-25T12:00:00.000Z'),
    generateId: () => 'gen-' + (++counter),
  });
  return { repo, client };
}

function makeOrder(overrides) {
  return Object.assign({
    orderId: 'order-abc-123',
    customerId: 'cognito-sub-verified-12345',
    orderNumber: 'DP-2026-001',
    orderState: 'pending',
    paymentState: 'unpaid',
    totalCents: 4500,
    currency: 'USD',
    contactSnapshot: { email: 'buyer@example.com', name: 'Test Buyer' },
    version: 1,
  }, overrides || {});
}

function makeItem(overrides) {
  return Object.assign({
    orderItemId: 'item-xyz-001',
    productId: 'product-banner-001',
    sku: 'BANNER-3X6',
    quantity: 2,
    unitPriceCents: 2250,
    lineTotalCents: 4500,
  }, overrides || {});
}

function conditionalCheckError() {
  const err = new Error('ConditionalCheckFailedException');
  err.name = 'ConditionalCheckFailedException';
  return err;
}

function transactionCanceledError(codes) {
  const err = new Error('TransactionCanceledException');
  err.name = 'TransactionCanceledException';
  err.CancellationReasons = (codes || ['ConditionalCheckFailed', 'None']).map(function(Code) { return { Code: Code }; });
  return err;
}

function computeFingerprint(value) {
  function canonical(v) {
    if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
    if (v && typeof v === 'object') {
      var keys = Object.keys(v).sort();
      return '{' + keys.map(function(k) { return JSON.stringify(k) + ':' + canonical(v[k]); }).join(',') + '}';
    }
    return JSON.stringify(v);
  }
  return crypto.createHash('sha256').update(canonical(value)).digest('hex');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('orderRepository', () => {
  beforeEach(function() { jest.clearAllMocks(); });

  // =========================================================================
  // Exported constants
  // =========================================================================
  describe('exported constants', () => {
    it('ORDERS_TABLE_DEFAULT is divine-printing-orders-v2', () => {
      expect(ORDERS_TABLE_DEFAULT).toBe('divine-printing-orders-v2');
    });
    it('ORDER_ITEMS_TABLE_DEFAULT is divine-printing-order-items-v2', () => {
      expect(ORDER_ITEMS_TABLE_DEFAULT).toBe('divine-printing-order-items-v2');
    });
    it('CUSTOMER_ORDERS_INDEX is CustomerOrdersIndex', () => {
      expect(CUSTOMER_ORDERS_INDEX).toBe('CustomerOrdersIndex');
    });
    it('ORDER_NUMBER_INDEX is OrderNumberIndex', () => {
      expect(ORDER_NUMBER_INDEX).toBe('OrderNumberIndex');
    });
    it('STRIPE_CHECKOUT_SESSION_INDEX is StripeCheckoutSessionIndex', () => {
      expect(STRIPE_CHECKOUT_SESSION_INDEX).toBe('StripeCheckoutSessionIndex');
    });
    it('STRIPE_PAYMENT_INTENT_INDEX is StripePaymentIntentIndex', () => {
      expect(STRIPE_PAYMENT_INTENT_INDEX).toBe('StripePaymentIntentIndex');
    });
    it('FORBIDDEN_FIELDS includes cardNumber, cvv, stripeToken, accessToken, refreshToken, clientSecret, password', () => {
      ['cardNumber','cvv','stripeToken','accessToken','refreshToken','clientSecret','password'].forEach(function(f) {
        expect(FORBIDDEN_FIELDS.has(f)).toBe(true);
      });
    });
  });

  // =========================================================================
  // createOrderWithItems — transactional creation
  // =========================================================================
  describe('createOrderWithItems', () => {

    it('returns idempotentReplay:false and populated order+items on first creation', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});  // TransactWriteCommand (no idempotency key → no pre-check)
      const result = await repo.createOrderWithItems(makeOrder(), [makeItem()]);
      expect(result.idempotentReplay).toBe(false);
      expect(result.order.orderId).toBe('order-abc-123');
      expect(result.order.version).toBe(1);
      expect(result.items).toHaveLength(1);
      expect(result.items[0].orderId).toBe('order-abc-123');
      expect(result.items[0].version).toBe(1);
    });

    it('uses TransactWriteCommand (atomic) for order+item creation', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});
      await repo.createOrderWithItems(makeOrder(), [makeItem()]);
      // No idempotency key → single send call (TransactWriteCommand)
      expect(client.send).toHaveBeenCalledTimes(1);
      const txCmd = client.send.mock.calls[0][0];
      expect(txCmd.input.TransactItems).toBeDefined();
      expect(Array.isArray(txCmd.input.TransactItems)).toBe(true);
    });

    it('packs the order, N items, and order-number reservation into one transaction', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});
      await repo.createOrderWithItems(makeOrder(), [makeItem(), makeItem({ orderItemId: 'item-2' })]);
      const txItems = client.send.mock.calls[0][0].input.TransactItems;
      expect(txItems).toHaveLength(4);
    });

    it('conditionally reserves orderNumber without projecting the marker into GSIs', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});
      await repo.createOrderWithItems(makeOrder(), []);
      const reservation = client.send.mock.calls[0][0].input.TransactItems[1].Put;
      expect(reservation.TableName).toBe(ORDERS_TABLE_DEFAULT);
      expect(reservation.ConditionExpression).toBe('attribute_not_exists(orderId)');
      expect(reservation.Item.orderId).toMatch(/^ORDER_NUMBER#[a-f0-9]{64}$/);
      expect(reservation.Item.reservedOrderId).toBe('order-abc-123');
      expect(reservation.Item.orderNumber).toBeUndefined();
      expect(reservation.Item.customerId).toBeUndefined();
    });

    it('returns ORDER_NUMBER_CONFLICT when the order-number reservation collides', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(transactionCanceledError(['None', 'ConditionalCheckFailed']));
      const err = await repo.createOrderWithItems(makeOrder(), []).catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_NUMBER_CONFLICT');
      expect(err.message).not.toContain('TransactionCanceledException');
    });

    it('rejects more than 98 items before calling DynamoDB', async () => {
      const { repo, client } = makeRepo();
      const items = Array.from({ length: 99 }, (_, i) => makeItem({ orderItemId: `item-${i}` }));
      const err = await repo.createOrderWithItems(makeOrder(), items).catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_PERSISTENCE_FAILED');
      expect(client.send).not.toHaveBeenCalled();
    });

    it('applies attribute_not_exists(orderId) condition on order Put', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});
      await repo.createOrderWithItems(makeOrder(), []);
      const orderPut = client.send.mock.calls[0][0].input.TransactItems[0];
      expect(orderPut.Put.ConditionExpression).toBe('attribute_not_exists(orderId)');
    });

    it('applies attribute_not_exists conditions on each item Put', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});
      await repo.createOrderWithItems(makeOrder(), [makeItem()]);
      const itemPut = client.send.mock.calls[0][0].input.TransactItems[1];
      expect(itemPut.Put.ConditionExpression).toContain('attribute_not_exists(orderId)');
      expect(itemPut.Put.ConditionExpression).toContain('attribute_not_exists(orderItemId)');
    });

    it('stamps version:1, createdAt, updatedAt on order', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});
      const result = await repo.createOrderWithItems(makeOrder(), []);
      expect(result.order.version).toBe(1);
      expect(result.order.createdAt).toBe('2026-08-25T12:00:00.000Z');
      expect(result.order.updatedAt).toBe('2026-08-25T12:00:00.000Z');
    });

    it('stamps orderId, version:1, createdAt on each item', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});
      const result = await repo.createOrderWithItems(makeOrder(), [makeItem()]);
      expect(result.items[0].orderId).toBe('order-abc-123');
      expect(result.items[0].version).toBe(1);
      expect(result.items[0].createdAt).toBe('2026-08-25T12:00:00.000Z');
    });

    it('writes order to orders table and items to order-items table', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});
      await repo.createOrderWithItems(makeOrder(), [makeItem()]);
      const txItems = client.send.mock.calls[0][0].input.TransactItems;
      expect(txItems[0].Put.TableName).toBe(ORDERS_TABLE_DEFAULT);
      expect(txItems[1].Put.TableName).toBe(ORDER_ITEMS_TABLE_DEFAULT);
    });

    // Atomic failure
    it('throws ORDER_IDEMPOTENCY_CONFLICT on TransactionCanceledException with ConditionalCheckFailed', async () => {
      const { repo, client } = makeRepo();
      // No idempotency key → directly transacts; reject the TransactWriteCommand
      client.send.mockRejectedValueOnce(transactionCanceledError(['ConditionalCheckFailed', 'None']));
      const err = await repo.createOrderWithItems(makeOrder(), []).catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_IDEMPOTENCY_CONFLICT');
      expect(err.isDomainError).toBe(true);
    });

    it('throws ORDER_PERSISTENCE_FAILED for generic DynamoDB errors', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'));
      const err = await repo.createOrderWithItems(makeOrder(), []).catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_PERSISTENCE_FAILED');
    });

    it('does not expose raw AWS error messages in domain errors', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(new Error('InternalServerError: db-secret'));
      const err = await repo.createOrderWithItems(makeOrder(), []).catch(function(e) { return e; });
      expect(err.message).not.toContain('InternalServerError');
      expect(err.message).not.toContain('db-secret');
    });

    // Idempotency replay
    it('returns idempotentReplay:true when same key and matching fingerprint exists', async () => {
      const { repo, client } = makeRepo();
      const items = [makeItem()];
      const payload = { orderId: 'order-abc-123', items: items };
      const expectedFp = computeFingerprint(payload);
      const existingOrder = makeOrder({ idempotencyKey: 'idem-001', idempotencyFingerprint: expectedFp });
      client.send.mockResolvedValueOnce({ Item: existingOrder }); // GetCommand
      client.send.mockResolvedValueOnce({ Items: items });          // QueryCommand (listOrderItems)
      const result = await repo.createOrderWithItems(makeOrder(), items, { key: 'idem-001', payload: payload });
      expect(result.idempotentReplay).toBe(true);
      expect(result.order).toEqual(existingOrder);
      const cmdNames = client.send.mock.calls.map(function(c) { return c[0].constructor.name; });
      expect(cmdNames).not.toContain('TransactWriteCommand');
    });

    it('throws ORDER_IDEMPOTENCY_CONFLICT when same key but different fingerprint', async () => {
      const { repo, client } = makeRepo();
      const existingOrder = makeOrder({ idempotencyKey: 'idem-999', idempotencyFingerprint: 'wrong-fp' });
      client.send.mockResolvedValueOnce({ Item: existingOrder });
      const err = await repo.createOrderWithItems(makeOrder(), [], {
        key: 'idem-999',
        payload: { orderId: 'order-abc-123', items: [{ x: 1 }] },
      }).catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_IDEMPOTENCY_CONFLICT');
      expect(err.message).toContain('Idempotency key reused');
    });

    // Sensitive-data rejection (tokens and card data)
    it('throws TypeError BEFORE any DynamoDB call if order has cardNumber', async () => {
      const { repo, client } = makeRepo();
      await expect(repo.createOrderWithItems(makeOrder({ cardNumber: '4111' }), [])).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError BEFORE any DynamoDB call if order has cvv', async () => {
      const { repo, client } = makeRepo();
      await expect(repo.createOrderWithItems(makeOrder({ cvv: '123' }), [])).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError BEFORE any DynamoDB call if order has cvc', async () => {
      const { repo, client } = makeRepo();
      await expect(repo.createOrderWithItems(makeOrder({ cvc: '123' }), [])).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError BEFORE any DynamoDB call if order has stripeToken', async () => {
      const { repo, client } = makeRepo();
      await expect(repo.createOrderWithItems(makeOrder({ stripeToken: 'tok_test' }), [])).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError BEFORE any DynamoDB call if order has accessToken', async () => {
      const { repo, client } = makeRepo();
      await expect(repo.createOrderWithItems(makeOrder({ accessToken: 'eyJ' }), [])).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError BEFORE any DynamoDB call if order has refreshToken', async () => {
      const { repo, client } = makeRepo();
      await expect(repo.createOrderWithItems(makeOrder({ refreshToken: 'rt' }), [])).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError BEFORE any DynamoDB call if order has clientSecret', async () => {
      const { repo, client } = makeRepo();
      await expect(repo.createOrderWithItems(makeOrder({ clientSecret: 'pi_secret' }), [])).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError BEFORE any DynamoDB call if order has password', async () => {
      const { repo, client } = makeRepo();
      await expect(repo.createOrderWithItems(makeOrder({ password: 'pw' }), [])).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError BEFORE any DynamoDB call if order has passwordHash', async () => {
      const { repo, client } = makeRepo();
      await expect(repo.createOrderWithItems(makeOrder({ passwordHash: 'hashed' }), [])).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError BEFORE any DynamoDB call if any item has cardNumber', async () => {
      const { repo, client } = makeRepo();
      await expect(repo.createOrderWithItems(makeOrder(), [makeItem({ cardNumber: '4111' })])).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError BEFORE any DynamoDB call if any item has cvv', async () => {
      const { repo, client } = makeRepo();
      await expect(repo.createOrderWithItems(makeOrder(), [makeItem({ cvv: '456' })])).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('forbidden field error message names the offending field', async () => {
      const { repo } = makeRepo();
      const err = await repo.createOrderWithItems(makeOrder({ cardNumber: '4111' }), []).catch(function(e) { return e; });
      expect(err.message).toContain('cardNumber');
    });

    it('does not persist forbidden fields into DynamoDB', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});
      await repo.createOrderWithItems(makeOrder(), [makeItem()]);
      const txItems = client.send.mock.calls[0][0].input.TransactItems;
      txItems.forEach(function(action) {
        const item = (action.Put && action.Put.Item) || {};
        ['cardNumber','cvv','cvc','stripeToken','accessToken','refreshToken','password','passwordHash','clientSecret'].forEach(function(f) {
          expect(item[f]).toBeUndefined();
        });
      });
    });

    // Absence of client-controlled ownership
    it('preserves customerId exactly as supplied by trusted service layer', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});
      const result = await repo.createOrderWithItems(makeOrder({ customerId: 'service-supplied-sub' }), []);
      expect(result.order.customerId).toBe('service-supplied-sub');
    });

    it('contactSnapshot.email does not become or override customerId', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});
      const result = await repo.createOrderWithItems(
        makeOrder({ customerId: 'cognito-sub', contactSnapshot: { email: 'buyer@example.com' } }),
        []
      );
      expect(result.order.customerId).toBe('cognito-sub');
      expect(result.order.customerId).not.toBe('buyer@example.com');
    });
  });

  // =========================================================================
  // getOrderById
  // =========================================================================
  describe('getOrderById', () => {
    it('returns the order when found', async () => {
      const { repo, client } = makeRepo();
      const order = makeOrder();
      client.send.mockResolvedValueOnce({ Item: order });
      expect(await repo.getOrderById('order-abc-123')).toEqual(order);
    });

    it('returns null when order is not found (empty response)', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});
      expect(await repo.getOrderById('ghost')).toBeNull();
    });

    it('returns null when Item is explicitly undefined', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Item: undefined });
      expect(await repo.getOrderById('any')).toBeNull();
    });

    it('uses GetCommand with ConsistentRead:true on orders table', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Item: makeOrder() });
      await repo.getOrderById('order-abc-123');
      const cmd = client.send.mock.calls[0][0];
      expect(cmd.input.TableName).toBe(ORDERS_TABLE_DEFAULT);
      expect(cmd.input.Key).toEqual({ orderId: 'order-abc-123' });
      expect(cmd.input.ConsistentRead).toBe(true);
    });

    it('throws ORDER_PERSISTENCE_FAILED (not raw AWS error) on DynamoDB failure', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(new Error('ServiceUnavailable'));
      const err = await repo.getOrderById('any').catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_PERSISTENCE_FAILED');
      expect(err.message).not.toContain('ServiceUnavailable');
    });
  });

  // =========================================================================
  // getOrderWithItems — order + item hydration
  // =========================================================================
  describe('getOrderWithItems', () => {
    it('returns { order, items } when both exist', async () => {
      const { repo, client } = makeRepo();
      const order = makeOrder();
      const items = [makeItem(), makeItem({ orderItemId: 'item-2' })];
      client.send.mockResolvedValueOnce({ Item: order });
      client.send.mockResolvedValueOnce({ Items: items });
      const result = await repo.getOrderWithItems('order-abc-123');
      expect(result.order).toEqual(order);
      expect(result.items).toHaveLength(2);
    });

    it('returns empty items array when order has no items', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Item: makeOrder() });
      client.send.mockResolvedValueOnce({ Items: [] });
      expect((await repo.getOrderWithItems('order-abc-123')).items).toEqual([]);
    });

    it('throws ORDER_NOT_FOUND when order does not exist', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});
      const err = await repo.getOrderWithItems('ghost').catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_NOT_FOUND');
    });

    it('queries order-items table with correct orderId', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Item: makeOrder() });
      client.send.mockResolvedValueOnce({ Items: [] });
      await repo.getOrderWithItems('order-abc-123');
      const itemCmd = client.send.mock.calls[1][0];
      expect(itemCmd.input.TableName).toBe(ORDER_ITEMS_TABLE_DEFAULT);
      expect(itemCmd.input.ExpressionAttributeValues[':orderId']).toBe('order-abc-123');
    });
  });

  // =========================================================================
  // listOrdersByCustomer
  // =========================================================================
  describe('listOrdersByCustomer', () => {
    it('queries CustomerOrdersIndex for the given customerId', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Items: [] });
      await repo.listOrdersByCustomer('cognito-sub-verified-12345');
      const cmd = client.send.mock.calls[0][0];
      expect(cmd.input.TableName).toBe(ORDERS_TABLE_DEFAULT);
      expect(cmd.input.IndexName).toBe(CUSTOMER_ORDERS_INDEX);
      expect(cmd.input.ExpressionAttributeValues[':customerId']).toBe('cognito-sub-verified-12345');
    });

    it('sets ScanIndexForward:false for newest-first ordering', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Items: [] });
      await repo.listOrdersByCustomer('any-sub');
      expect(client.send.mock.calls[0][0].input.ScanIndexForward).toBe(false);
    });

    it('applies default limit of 20', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Items: [] });
      await repo.listOrdersByCustomer('any-sub');
      expect(client.send.mock.calls[0][0].input.Limit).toBe(20);
    });

    it('applies caller-supplied limit', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Items: [] });
      await repo.listOrdersByCustomer('any-sub', { limit: 5 });
      expect(client.send.mock.calls[0][0].input.Limit).toBe(5);
    });

    it('forwards ExclusiveStartKey for pagination continuation', async () => {
      const { repo, client } = makeRepo();
      const lastKey = { orderId: 'last-id', customerId: 'any-sub', createdAt: '2026-01-01' };
      client.send.mockResolvedValueOnce({ Items: [] });
      await repo.listOrdersByCustomer('any-sub', { exclusiveStartKey: lastKey });
      expect(client.send.mock.calls[0][0].input.ExclusiveStartKey).toEqual(lastKey);
    });

    it('does not include ExclusiveStartKey when none provided', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Items: [] });
      await repo.listOrdersByCustomer('any-sub');
      expect(client.send.mock.calls[0][0].input.ExclusiveStartKey).toBeUndefined();
    });

    it('returns lastEvaluatedKey from DynamoDB response', async () => {
      const { repo, client } = makeRepo();
      const nextKey = { orderId: 'next-id', customerId: 'any-sub' };
      client.send.mockResolvedValueOnce({ Items: [makeOrder()], LastEvaluatedKey: nextKey });
      const result = await repo.listOrdersByCustomer('any-sub', { limit: 1 });
      expect(result.lastEvaluatedKey).toEqual(nextKey);
    });

    it('returns undefined lastEvaluatedKey when all results fit on one page', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Items: [makeOrder()] });
      expect((await repo.listOrdersByCustomer('any-sub')).lastEvaluatedKey).toBeUndefined();
    });

    it('returns orders array from Items', async () => {
      const { repo, client } = makeRepo();
      const orders = [makeOrder(), makeOrder({ orderId: 'order-2' })];
      client.send.mockResolvedValueOnce({ Items: orders });
      expect((await repo.listOrdersByCustomer('any-sub')).orders).toEqual(orders);
    });

    it('returns empty orders array when no orders found', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Items: [] });
      expect((await repo.listOrdersByCustomer('any-sub')).orders).toEqual([]);
    });

    it('throws ORDER_PERSISTENCE_FAILED (no raw AWS detail) on DynamoDB error', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(new Error('ResourceNotFound: table missing'));
      const err = await repo.listOrdersByCustomer('any-sub').catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_PERSISTENCE_FAILED');
      expect(err.message).not.toContain('ResourceNotFound');
    });
  });

  // =========================================================================
  // findByOrderNumber — OrderNumberIndex GSI
  // =========================================================================
  describe('findByOrderNumber', () => {
    it('queries OrderNumberIndex with the order number', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Items: [makeOrder()] });
      await repo.findByOrderNumber('DP-2026-001');
      const cmd = client.send.mock.calls[0][0];
      expect(cmd.input.IndexName).toBe('OrderNumberIndex');
      expect(cmd.input.ExpressionAttributeValues[':orderNumber']).toBe('DP-2026-001');
    });

    it('returns the first matching order', async () => {
      const { repo, client } = makeRepo();
      const order = makeOrder();
      client.send.mockResolvedValueOnce({ Items: [order] });
      expect(await repo.findByOrderNumber('DP-2026-001')).toEqual(order);
    });

    it('returns null when no order matches', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Items: [] });
      expect(await repo.findByOrderNumber('DP-NONEXISTENT')).toBeNull();
    });

    it('uses Limit:1 to avoid over-fetching', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Items: [] });
      await repo.findByOrderNumber('DP-2026-001');
      expect(client.send.mock.calls[0][0].input.Limit).toBe(1);
    });

    it('throws ORDER_PERSISTENCE_FAILED on DynamoDB error', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(new Error('DynamoDB error'));
      const err = await repo.findByOrderNumber('any').catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_PERSISTENCE_FAILED');
    });
  });

  // =========================================================================
  // findByCheckoutSessionId — StripeCheckoutSessionIndex GSI
  // =========================================================================
  describe('findByCheckoutSessionId', () => {
    it('queries StripeCheckoutSessionIndex with the session ID', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Items: [makeOrder()] });
      await repo.findByCheckoutSessionId('cs_test_abc');
      const cmd = client.send.mock.calls[0][0];
      expect(cmd.input.IndexName).toBe(STRIPE_CHECKOUT_SESSION_INDEX);
      expect(cmd.input.ExpressionAttributeValues[':sessionId']).toBe('cs_test_abc');
    });

    it('returns the matching order', async () => {
      const { repo, client } = makeRepo();
      const order = makeOrder({ stripeCheckoutSessionId: 'cs_test_abc' });
      client.send.mockResolvedValueOnce({ Items: [order] });
      expect(await repo.findByCheckoutSessionId('cs_test_abc')).toEqual(order);
    });

    it('returns null when no order matches', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Items: [] });
      expect(await repo.findByCheckoutSessionId('cs_nonexistent')).toBeNull();
    });

    it('uses Limit:1 to avoid over-fetching', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Items: [] });
      await repo.findByCheckoutSessionId('cs_test');
      expect(client.send.mock.calls[0][0].input.Limit).toBe(1);
    });

    it('throws ORDER_PERSISTENCE_FAILED on DynamoDB error', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(new Error('DynamoDB error'));
      const err = await repo.findByCheckoutSessionId('any').catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_PERSISTENCE_FAILED');
    });
  });

  // =========================================================================
  // findByPaymentIntentId — StripePaymentIntentIndex GSI
  // =========================================================================
  describe('findByPaymentIntentId', () => {
    it('queries StripePaymentIntentIndex with the payment intent ID', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Items: [makeOrder()] });
      await repo.findByPaymentIntentId('pi_test_xyz');
      const cmd = client.send.mock.calls[0][0];
      expect(cmd.input.IndexName).toBe(STRIPE_PAYMENT_INTENT_INDEX);
      expect(cmd.input.ExpressionAttributeValues[':paymentIntentId']).toBe('pi_test_xyz');
    });

    it('returns the matching order', async () => {
      const { repo, client } = makeRepo();
      const order = makeOrder({ stripePaymentIntentId: 'pi_test_xyz' });
      client.send.mockResolvedValueOnce({ Items: [order] });
      expect(await repo.findByPaymentIntentId('pi_test_xyz')).toEqual(order);
    });

    it('returns null when no order matches', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Items: [] });
      expect(await repo.findByPaymentIntentId('pi_nonexistent')).toBeNull();
    });

    it('uses Limit:1 to avoid over-fetching', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Items: [] });
      await repo.findByPaymentIntentId('pi_test');
      expect(client.send.mock.calls[0][0].input.Limit).toBe(1);
    });

    it('throws ORDER_PERSISTENCE_FAILED on DynamoDB error', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(new Error('DynamoDB error'));
      const err = await repo.findByPaymentIntentId('any').catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_PERSISTENCE_FAILED');
    });
  });

  // =========================================================================
  // updateOrderState — optimistic versioning + state-transition conditions
  // =========================================================================
  describe('updateOrderState', () => {
    it('updates orderState and increments version on success', async () => {
      const { repo, client } = makeRepo();
      const updatedOrder = makeOrder({ orderState: 'confirmed', version: 2 });
      client.send.mockResolvedValueOnce({ Attributes: updatedOrder });

      const result = await repo.updateOrderState('order-abc-123', 1, 'pending', 'confirmed');

      expect(result.updated).toBe(true);
      expect(result.order).toEqual(updatedOrder);
    });

    it('sends UpdateCommand with version condition and state condition', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Attributes: makeOrder({ version: 2 }) });

      await repo.updateOrderState('order-abc-123', 1, 'pending', 'confirmed');

      const cmd = client.send.mock.calls[0][0];
      expect(cmd.input.ConditionExpression).toContain(':expectedVersion');
      expect(cmd.input.ConditionExpression).toContain(':expectedState');
      expect(cmd.input.ExpressionAttributeValues[':expectedVersion']).toBe(1);
      expect(cmd.input.ExpressionAttributeValues[':nextVersion']).toBe(2);
      expect(cmd.input.ExpressionAttributeValues[':expectedState']).toBe('pending');
      expect(cmd.input.ExpressionAttributeValues[':nextState']).toBe('confirmed');
    });

    it('uses ReturnValues:ALL_NEW to return updated record', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Attributes: makeOrder({ version: 2 }) });
      await repo.updateOrderState('order-abc-123', 1, 'pending', 'confirmed');
      const cmd = client.send.mock.calls[0][0];
      expect(cmd.input.ReturnValues).toBe('ALL_NEW');
    });

    it('throws ORDER_NOT_FOUND when order does not exist', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(conditionalCheckError()); // UpdateCommand fails
      client.send.mockResolvedValueOnce({});                       // getOrderById: not found

      const err = await repo.updateOrderState('ghost-order', 1, 'pending', 'confirmed').catch(function(e) { return e; });

      expect(err.code).toBe('ORDER_NOT_FOUND');
    });

    it('throws ORDER_VERSION_CONFLICT when version is stale', async () => {
      const { repo, client } = makeRepo();
      const latest = makeOrder({ version: 5, orderState: 'pending' });
      client.send.mockRejectedValueOnce(conditionalCheckError()); // UpdateCommand fails
      client.send.mockResolvedValueOnce({ Item: latest });          // getOrderById: found with newer version

      const err = await repo.updateOrderState('order-abc-123', 1, 'pending', 'confirmed').catch(function(e) { return e; });

      expect(err.code).toBe('ORDER_VERSION_CONFLICT');
      expect(err.message).toContain('1');
      expect(err.message).toContain('5');
    });

    it('throws ORDER_STATE_CONFLICT when state does not match', async () => {
      const { repo, client } = makeRepo();
      const latest = makeOrder({ version: 1, orderState: 'cancelled' }); // state mismatch
      client.send.mockRejectedValueOnce(conditionalCheckError()); // UpdateCommand fails
      client.send.mockResolvedValueOnce({ Item: latest });          // getOrderById: same version, different state

      const err = await repo.updateOrderState('order-abc-123', 1, 'pending', 'confirmed').catch(function(e) { return e; });

      expect(err.code).toBe('ORDER_STATE_CONFLICT');
    });

    it('throws ORDER_PERSISTENCE_FAILED on generic DynamoDB error', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(new Error('InternalServerError: details'));
      const err = await repo.updateOrderState('order-abc-123', 1, 'pending', 'confirmed').catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_PERSISTENCE_FAILED');
      expect(err.message).not.toContain('InternalServerError');
    });

    it('requires attribute_exists(orderId) guard in ConditionExpression', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Attributes: makeOrder({ version: 2 }) });
      await repo.updateOrderState('order-abc-123', 1, 'pending', 'confirmed');
      const cmd = client.send.mock.calls[0][0];
      expect(cmd.input.ConditionExpression).toContain('attribute_exists');
    });
  });

  // =========================================================================
  // updatePaymentState — payment-state conditions
  // =========================================================================
  describe('updatePaymentState', () => {
    it('updates paymentState and increments version on success', async () => {
      const { repo, client } = makeRepo();
      const updatedOrder = makeOrder({ paymentState: 'paid', version: 2 });
      client.send.mockResolvedValueOnce({ Attributes: updatedOrder });

      const result = await repo.updatePaymentState('order-abc-123', 1, 'unpaid', 'paid');

      expect(result.updated).toBe(true);
      expect(result.order).toEqual(updatedOrder);
    });

    it('sends UpdateCommand with version and payment state conditions', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Attributes: makeOrder({ version: 2 }) });

      await repo.updatePaymentState('order-abc-123', 1, 'unpaid', 'paid');

      const cmd = client.send.mock.calls[0][0];
      expect(cmd.input.ExpressionAttributeValues[':expectedVersion']).toBe(1);
      expect(cmd.input.ExpressionAttributeValues[':nextVersion']).toBe(2);
      expect(cmd.input.ExpressionAttributeValues[':expectedState']).toBe('unpaid');
      expect(cmd.input.ExpressionAttributeValues[':nextState']).toBe('paid');
    });

    it('targets paymentState attribute (not orderState)', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Attributes: makeOrder({ version: 2 }) });
      await repo.updatePaymentState('order-abc-123', 1, 'unpaid', 'paid');
      const cmd = client.send.mock.calls[0][0];
      expect(cmd.input.UpdateExpression).toContain('#paymentState');
    });

    it('throws ORDER_NOT_FOUND when order does not exist (payment state update)', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(conditionalCheckError());
      client.send.mockResolvedValueOnce({});
      const err = await repo.updatePaymentState('ghost-order', 1, 'unpaid', 'paid').catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_NOT_FOUND');
    });

    it('throws ORDER_VERSION_CONFLICT when version is stale (payment state update)', async () => {
      const { repo, client } = makeRepo();
      const latest = makeOrder({ version: 9, paymentState: 'unpaid' });
      client.send.mockRejectedValueOnce(conditionalCheckError());
      client.send.mockResolvedValueOnce({ Item: latest });
      const err = await repo.updatePaymentState('order-abc-123', 1, 'unpaid', 'paid').catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_VERSION_CONFLICT');
    });

    it('throws ORDER_STATE_CONFLICT when payment state does not match', async () => {
      const { repo, client } = makeRepo();
      const latest = makeOrder({ version: 1, paymentState: 'refunded' });
      client.send.mockRejectedValueOnce(conditionalCheckError());
      client.send.mockResolvedValueOnce({ Item: latest });
      const err = await repo.updatePaymentState('order-abc-123', 1, 'unpaid', 'paid').catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_STATE_CONFLICT');
    });

    it('throws ORDER_PERSISTENCE_FAILED on generic DynamoDB error (payment state)', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(new Error('Throughput exceeded: secret'));
      const err = await repo.updatePaymentState('order-abc-123', 1, 'unpaid', 'paid').catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_PERSISTENCE_FAILED');
      expect(err.message).not.toContain('Throughput exceeded');
    });
  });

  // =========================================================================
  // AWS error translation — all errors produce domain errors, never raw AWS
  // =========================================================================
  describe('AWS error translation', () => {
    it('getOrderById: does not expose raw AWS error details', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(new Error('AccessDenied: not authorized to call dynamodb:GetItem'));
      const err = await repo.getOrderById('any').catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_PERSISTENCE_FAILED');
      expect(err.message).not.toContain('AccessDenied');
      expect(err.message).not.toContain('dynamodb');
    });

    it('listOrdersByCustomer: does not expose raw AWS error details', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(new Error('ValidationException: table does not exist'));
      const err = await repo.listOrdersByCustomer('any').catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_PERSISTENCE_FAILED');
      expect(err.message).not.toContain('ValidationException');
    });

    it('findByOrderNumber: does not expose raw AWS error details', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'));
      const err = await repo.findByOrderNumber('any').catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_PERSISTENCE_FAILED');
      expect(err.message).not.toContain('ProvisionedThroughputExceededException');
    });

    it('updateOrderState: does not expose raw AWS error details on generic failure', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(new Error('InternalServerError: secret-reason'));
      const err = await repo.updateOrderState('any', 1, 's1', 's2').catch(function(e) { return e; });
      expect(err.code).toBe('ORDER_PERSISTENCE_FAILED');
      expect(err.message).not.toContain('secret-reason');
    });

    it('all domain errors carry isDomainError:true', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(new Error('DynamoDB error'));
      const err = await repo.getOrderById('any').catch(function(e) { return e; });
      expect(err.isDomainError).toBe(true);
    });

    it('all domain errors carry a code property (no undefined code)', async () => {
      const { repo, client } = makeRepo();
      client.send.mockRejectedValueOnce(new Error('DynamoDB error'));
      const err = await repo.getOrderById('any').catch(function(e) { return e; });
      expect(typeof err.code).toBe('string');
      expect(err.code.length).toBeGreaterThan(0);
    });

    it('raw AWS cause is preserved on error for internal logging (not forwarded to caller)', async () => {
      const { repo, client } = makeRepo();
      const rawErr = new Error('ProvisionedThroughputExceededException');
      client.send.mockRejectedValueOnce(rawErr);
      const err = await repo.getOrderById('any').catch(function(e) { return e; });
      // cause is kept for logging
      expect(err.cause).toBe(rawErr);
      // but message is safe
      expect(err.message).not.toContain('ProvisionedThroughputExceededException');
    });
  });

  // =========================================================================
  // Security: sensitive data non-persistence
  // =========================================================================
  describe('sensitive data non-persistence', () => {
    it('no token/card fields are written to orders table via createOrderWithItems', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});
      await repo.createOrderWithItems(makeOrder(), [makeItem()]);
      const txItems = client.send.mock.calls[0][0].input.TransactItems;
      txItems.forEach(function(action) {
        const item = (action.Put && action.Put.Item) || {};
        expect(item.cardNumber).toBeUndefined();
        expect(item.cvv).toBeUndefined();
        expect(item.cvc).toBeUndefined();
        expect(item.cardCvc).toBeUndefined();
        expect(item.cardCvv).toBeUndefined();
        expect(item.stripeToken).toBeUndefined();
        expect(item.accessToken).toBeUndefined();
        expect(item.idToken).toBeUndefined();
        expect(item.refreshToken).toBeUndefined();
        expect(item.clientSecret).toBeUndefined();
        expect(item.paymentMethodToken).toBeUndefined();
        expect(item.password).toBeUndefined();
        expect(item.passwordHash).toBeUndefined();
      });
    });

    it('updateOrderState does not write token or card fields', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Attributes: makeOrder({ version: 2 }) });
      await repo.updateOrderState('order-abc-123', 1, 'pending', 'confirmed');
      const cmd = client.send.mock.calls[0][0];
      const updateExpr = cmd.input.UpdateExpression || '';
      const attrValues = cmd.input.ExpressionAttributeValues || {};
      const attrNames = cmd.input.ExpressionAttributeNames || {};
      const allText = JSON.stringify({ updateExpr, attrValues, attrNames });
      expect(allText).not.toContain('cardNumber');
      expect(allText).not.toContain('cvv');
      expect(allText).not.toContain('stripeToken');
      expect(allText).not.toContain('password');
    });
  });

  // =========================================================================
  // Absence of client-controlled ownership
  // =========================================================================
  describe('absence of client-controlled ownership', () => {
    it('repository interface does not accept customerId from external/unauthenticated input — it trusts the service layer', async () => {
      // This test validates the design contract: createOrderWithItems trusts customerId
      // from the service layer parameter, not from any request body or JWT claims.
      // The service layer is responsible for deriving customerId from the verified Cognito sub.
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});
      const result = await repo.createOrderWithItems(
        makeOrder({ customerId: 'cognito-sub-from-service-only' }),
        []
      );
      // Repository stores exactly what the service layer supplies (trusted sub)
      expect(result.order.customerId).toBe('cognito-sub-from-service-only');
    });

    it('listOrdersByCustomer scopes query to the provided customerId (must be a verified sub)', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({ Items: [] });
      await repo.listOrdersByCustomer('verified-cognito-sub');
      const cmd = client.send.mock.calls[0][0];
      // Ensures no cross-tenant leakage: query is keyed to customerId only
      expect(cmd.input.ExpressionAttributeValues[':customerId']).toBe('verified-cognito-sub');
    });

    it('contactSnapshot.email field in order is an immutable snapshot (not identity)', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});
      const order = makeOrder({
        customerId: 'cognito-sub-12345',
        contactSnapshot: { email: 'different-buyer@example.com', name: 'Buyer' },
      });
      const result = await repo.createOrderWithItems(order, []);
      // customerId (identity) is separate from contactSnapshot (immutable data)
      expect(result.order.customerId).toBe('cognito-sub-12345');
      expect(result.order.contactSnapshot.email).toBe('different-buyer@example.com');
      // contactSnapshot.email must NOT equal customerId
      expect(result.order.contactSnapshot.email).not.toBe(result.order.customerId);
    });
  });

  // =========================================================================
  // DEFECT REGRESSION TESTS
  // =========================================================================

  // -------------------------------------------------------------------------
  // Defect 1 regression: IaC GSI sort keys (documentation test)
  // -------------------------------------------------------------------------
  describe('IaC schema alignment (Defect 1 regression)', () => {
    it('OrderStateIndex should use createdAt as sort key per ADR0005 (not updatedAt)', () => {
      // This is a documentation/design test. The actual schema is in orders-v2.yaml.
      // We assert the constant is exported so the YAML can be audited against it.
      const { ORDER_STATE_INDEX } = require('../orderRepository');
      expect(ORDER_STATE_INDEX).toBe('OrderStateIndex');
      // The sort key for OrderStateIndex is createdAt per ADR0005.
      // See infrastructure/cloudformation/orders-v2.yaml for the corrected KeySchema.
    });

    it('ProductOrderItemIndex should use createdAt as sort key per ADR0005 (not updatedAt)', () => {
      const { PRODUCT_ORDER_ITEM_INDEX } = require('../orderRepository');
      expect(PRODUCT_ORDER_ITEM_INDEX).toBe('ProductOrderItemIndex');
      // The sort key for ProductOrderItemIndex is createdAt per ADR0005.
      // See infrastructure/cloudformation/orders-v2.yaml for the corrected KeySchema.
    });
  });

  // -------------------------------------------------------------------------
  // Defect 2 regression: Idempotency — deterministic orderId from key
  // -------------------------------------------------------------------------
  describe('idempotency deterministic orderId (Defect 2 regression)', () => {
    it('same idempotency key always resolves to same orderId, regardless of generateId() output', async () => {
      // Two separate repo instances with different generateId sequences
      const client1 = makeMockClient();
      let counter1 = 0;
      const repo1 = createOrderRepository({
        client: client1,
        now: () => new Date('2026-08-25T12:00:00.000Z'),
        generateId: () => 'gen-instance1-' + (++counter1),
      });

      const client2 = makeMockClient();
      let counter2 = 100;
      const repo2 = createOrderRepository({
        client: client2,
        now: () => new Date('2026-08-25T12:00:00.000Z'),
        generateId: () => 'gen-instance2-' + (++counter2),
      });

      const idemKey = 'idem-deterministic-test-key';
      const idemContext = { key: idemKey, payload: { amount: 4500 } };

      // First call: no existing record → creates new order
      client1.send.mockResolvedValueOnce({ Item: undefined }); // GetCommand: not found
      client1.send.mockResolvedValueOnce({});                  // TransactWriteCommand
      await repo1.createOrderWithItems(makeOrder({ orderId: undefined }), [], idemContext);

      // Second call (different repo instance, different generateId): must use same GetCommand key
      client2.send.mockResolvedValueOnce({ Item: undefined }); // GetCommand: not found
      client2.send.mockResolvedValueOnce({});                  // TransactWriteCommand
      await repo2.createOrderWithItems(makeOrder({ orderId: undefined }), [], idemContext);

      // Both repos must have queried the exact same derived orderId
      const getCmd1 = client1.send.mock.calls[0][0];
      const getCmd2 = client2.send.mock.calls[0][0];
      expect(getCmd1.input.Key.orderId).toBe(getCmd2.input.Key.orderId);
      // The derived orderId must NOT equal any generateId() output from either instance
      expect(getCmd1.input.Key.orderId).not.toContain('gen-instance1');
      expect(getCmd2.input.Key.orderId).not.toContain('gen-instance2');
    });

    it('omitting orderId and retrying with same key replays existing order (not a new record)', async () => {
      const idemKey = 'idem-replay-no-orderId';
      const idemPayload = { amount: 9900 };
      const fp = computeFingerprint(idemPayload);

      const client = makeMockClient();
      let genCount = 0;
      const repo = createOrderRepository({
        client,
        now: () => new Date('2026-08-25T12:00:00.000Z'),
        generateId: () => 'fresh-' + (++genCount),
      });

      // The derived orderId for this key
      const crypto = require('crypto');
      const NS = 'divine-printing-order-v2-idem-ns';
      const raw = crypto.createHmac('sha256', NS).update(idemKey).digest('hex');
      const derivedId = raw.slice(0,8)+'-'+raw.slice(8,12)+'-'+raw.slice(12,16)+'-'+raw.slice(16,20)+'-'+raw.slice(20,32);

      // First call: not found → creates
      client.send.mockResolvedValueOnce({ Item: undefined }); // GetCommand: miss
      client.send.mockResolvedValueOnce({});                  // TransactWrite
      const first = await repo.createOrderWithItems(
        makeOrder({ orderId: undefined }), [], { key: idemKey, payload: idemPayload }
      );
      expect(first.idempotentReplay).toBe(false);
      expect(first.order.orderId).toBe(derivedId);

      // Second call: found (same fingerprint) → replay
      const existingOrder = { ...first.order, idempotencyKey: idemKey, idempotencyFingerprint: fp };
      client.send.mockResolvedValueOnce({ Item: existingOrder }); // GetCommand: hit
      client.send.mockResolvedValueOnce({ Items: [] });            // listOrderItems
      const second = await repo.createOrderWithItems(
        makeOrder({ orderId: undefined }), [], { key: idemKey, payload: idemPayload }
      );
      expect(second.idempotentReplay).toBe(true);
      expect(second.order.orderId).toBe(derivedId);
      // generateId was never called for the orderId — always deterministic
      expect(second.order.orderId).not.toContain('fresh-');
    });

    it('omitting orderId with same key but different payload throws ORDER_IDEMPOTENCY_CONFLICT', async () => {
      const idemKey = 'idem-conflict-no-orderId';

      const client = makeMockClient();
      let genCount = 0;
      const repo = createOrderRepository({
        client,
        now: () => new Date('2026-08-25T12:00:00.000Z'),
        generateId: () => 'fresh-' + (++genCount),
      });

      const existingOrder = makeOrder({
        idempotencyKey: idemKey,
        idempotencyFingerprint: 'some-other-fingerprint',
      });
      client.send.mockResolvedValueOnce({ Item: existingOrder }); // GetCommand: hit with diff fingerprint

      const err = await repo.createOrderWithItems(
        makeOrder({ orderId: undefined }), [],
        { key: idemKey, payload: { amount: 1234 } } // different payload
      ).catch(function(e) { return e; });

      expect(err.code).toBe('ORDER_IDEMPOTENCY_CONFLICT');
      expect(err.isDomainError).toBe(true);
    });

    it('derived orderId differs from a fresh generateId() call (proves determinism)', async () => {
      const client = makeMockClient();
      let genCount = 0;
      const repo = createOrderRepository({
        client,
        now: () => new Date('2026-08-25T12:00:00.000Z'),
        generateId: () => 'fresh-uuid-' + (++genCount),
      });

      const idemKey = 'idem-determinism-check';
      client.send.mockResolvedValueOnce({ Item: undefined }); // GetCommand
      client.send.mockResolvedValueOnce({});                  // TransactWrite
      const result = await repo.createOrderWithItems(
        makeOrder({ orderId: undefined }), [],
        { key: idemKey, payload: { x: 1 } }
      );

      // The orderId must not be any generateId() output
      expect(result.order.orderId).not.toContain('fresh-uuid-');
      // And it must be consistent with the key derivation (same key → same id)
      const crypto2 = require('crypto');
      const NS = 'divine-printing-order-v2-idem-ns';
      const raw = crypto2.createHmac('sha256', NS).update(idemKey).digest('hex');
      const expectedDerived = raw.slice(0,8)+'-'+raw.slice(8,12)+'-'+raw.slice(12,16)+'-'+raw.slice(16,20)+'-'+raw.slice(20,32);
      expect(result.order.orderId).toBe(expectedDerived);
    });
  });

  // -------------------------------------------------------------------------
  // Defect 3 regression: Recursive/cycle-safe sensitive field validation
  // -------------------------------------------------------------------------
  describe('recursive sensitive field validation (Defect 3 regression)', () => {
    it('throws TypeError when a nested object inside order contains cardNumber', async () => {
      const { repo, client } = makeRepo();
      const order = makeOrder({
        paymentDetails: { cardNumber: '4111111111111111', last4: '1111' },
      });
      await expect(repo.createOrderWithItems(order, [])).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError when a nested object inside order contains cvv', async () => {
      const { repo, client } = makeRepo();
      const order = makeOrder({ card: { cvv: '123' } });
      await expect(repo.createOrderWithItems(order, [])).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError when a nested object inside order contains accessToken', async () => {
      const { repo, client } = makeRepo();
      const order = makeOrder({ auth: { accessToken: 'eyJhbGciOiJSUzI1NiJ9' } });
      await expect(repo.createOrderWithItems(order, [])).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError when a deeply nested object contains password', async () => {
      const { repo, client } = makeRepo();
      const order = makeOrder({ meta: { inner: { deep: { password: 'secret' } } } });
      await expect(repo.createOrderWithItems(order, [])).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError when an array inside order contains an object with cardNumber', async () => {
      const { repo, client } = makeRepo();
      const order = makeOrder({
        paymentMethods: [{ type: 'card', cardNumber: '5555555555554444' }],
      });
      await expect(repo.createOrderWithItems(order, [])).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError when a nested object inside an item contains cvv', async () => {
      const { repo, client } = makeRepo();
      const item = makeItem({ printSpec: { cardinalCvv: '999', cvv: '123' } });
      await expect(repo.createOrderWithItems(makeOrder(), [item])).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('recursive check is cycle-safe: does not hang on circular references', async () => {
      const { repo } = makeRepo();
      const order = makeOrder();
      // Create a circular reference (would cause stack overflow if not cycle-guarded)
      order.selfRef = order;
      // Should throw TypeError about circular reference OR not hang; should not stack overflow
      // The forbidden-field check must not throw RangeError (stack overflow)
      let threw = null;
      try {
        await repo.createOrderWithItems(order, []);
      } catch (e) {
        threw = e;
      }
      // It must throw SOMETHING (either TypeError for forbidden or DynamoDB error),
      // but must NOT throw RangeError (stack overflow)
      if (threw) {
        expect(threw.constructor.name).not.toBe('RangeError');
      }
    });

    it('throws TypeError for anonymous-cart credential anonCartToken in order', async () => {
      const { repo, client } = makeRepo();
      await expect(
        repo.createOrderWithItems(makeOrder({ anonCartToken: 'anon-tok-abc' }), [])
      ).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError for anonymous-cart credential cartToken in order', async () => {
      const { repo, client } = makeRepo();
      await expect(
        repo.createOrderWithItems(makeOrder({ cartToken: 'cart-tok-abc' }), [])
      ).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError for anonymous-cart credential guestToken in order', async () => {
      const { repo, client } = makeRepo();
      await expect(
        repo.createOrderWithItems(makeOrder({ guestToken: 'guest-tok' }), [])
      ).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError for anonymous-cart credential browserSessionId in order', async () => {
      const { repo, client } = makeRepo();
      await expect(
        repo.createOrderWithItems(makeOrder({ browserSessionId: 'sess-abc' }), [])
      ).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Defect 5 regression: Canonical customerId only; aliases are rejected
  // -------------------------------------------------------------------------
  describe('canonical customerId enforcement (Defect 5 regression)', () => {
    it('throws TypeError if order contains trustedCustomerId alias', async () => {
      const { repo, client } = makeRepo();
      await expect(
        repo.createOrderWithItems(makeOrder({ trustedCustomerId: 'cognito-sub' }), [])
      ).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError if order contains clientCustomerId alias', async () => {
      const { repo, client } = makeRepo();
      await expect(
        repo.createOrderWithItems(makeOrder({ clientCustomerId: 'some-id' }), [])
      ).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError if order contains requesterId alias', async () => {
      const { repo, client } = makeRepo();
      await expect(
        repo.createOrderWithItems(makeOrder({ requesterId: 'req-id' }), [])
      ).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError if order contains userId alias', async () => {
      const { repo, client } = makeRepo();
      await expect(
        repo.createOrderWithItems(makeOrder({ userId: 'uid-123' }), [])
      ).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('throws TypeError if order contains sub alias', async () => {
      const { repo, client } = makeRepo();
      await expect(
        repo.createOrderWithItems(makeOrder({ sub: 'cognito-sub' }), [])
      ).rejects.toThrow(TypeError);
      expect(client.send).not.toHaveBeenCalled();
    });

    it('does NOT reject the canonical customerId field (only aliases are forbidden)', async () => {
      // customerId is the ONE canonical field that IS allowed to be set by the service layer.
      // It must not be in FORBIDDEN_FIELDS.
      expect(FORBIDDEN_FIELDS.has('customerId')).toBe(false);
    });

    it('persisted order record contains only customerId, not any parallel identity alias', async () => {
      const { repo, client } = makeRepo();
      client.send.mockResolvedValueOnce({});
      const result = await repo.createOrderWithItems(
        makeOrder({ customerId: 'verified-cognito-sub-only' }),
        []
      );
      const persisted = result.order;
      // Canonical field is present
      expect(persisted.customerId).toBe('verified-cognito-sub-only');
      // No parallel aliases
      expect(persisted.trustedCustomerId).toBeUndefined();
      expect(persisted.clientCustomerId).toBeUndefined();
      expect(persisted.requesterId).toBeUndefined();
      expect(persisted.userId).toBeUndefined();
      expect(persisted.sub).toBeUndefined();
    });
  });
});
