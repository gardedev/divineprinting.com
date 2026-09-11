'use strict';
jest.mock('@aws-sdk/lib-dynamodb', () => ({ GetCommand: function(input){this.input=input;}, PutCommand: function(input){this.input=input;}, QueryCommand: function(input){this.input=input;}, UpdateCommand: function(input){this.input=input;}, TransactWriteCommand: function(input){this.input=input;} }));
jest.mock('../../utils/dynamoDbClient', () => ({ docClient: {} }));
const { createCheckoutRepository, deterministicId, estimateTransactionBytes, assertTransactionSafe, MAX_TRANSACTION_BYTES } = require('../checkoutRepository');

const prepared = { proposedOrder: { customerId: 'sub-1', cartId: 'cart-1', cartVersion: 4, merchandiseSubtotalCents: 2000, shippingCents: 795, discountCents: 0, taxStatus: 'disabled', taxCents: null, totalCents: 2795 }, proposedItems: [{ productId: 'p1', lineTotalCents: 2000 }], idempotency: { key: 'checkout-key-1', scope: 'sub-1:cart-1:4', fingerprint: 'a'.repeat(64) } };
describe('checkoutRepository', () => {
  test('atomically locks cart and creates deterministic pending order/items', async () => {
    const client = { send: jest.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({}) };
    const result = await createCheckoutRepository({ client, now: () => new Date('2026-08-25T00:00:00Z') }).createPendingCheckout({ prepared, orderNumber: 'DP-123' });
    expect(result.order).toMatchObject({ orderId: deterministicId('divine-printing-checkout-order-v1', 'sub-1:cart-1:4:checkout-key-1'), orderState: 'checkout_pending', paymentState: 'not_started', taxCents: null });
    const tx = client.send.mock.calls[1][0].input.TransactItems;
    expect(tx[0].Update.ExpressionAttributeValues).toMatchObject({ ':active': 'active', ':pending': 'pending_checkout', ':expectedVersion': 4 });
    expect(tx[1].ConditionCheck).toBeDefined(); expect(tx).toHaveLength(5);
  });
  test('returns same order on matching replay and rejects conflicting reuse', async () => {
    const orderId = deterministicId('divine-printing-checkout-order-v1', 'sub-1:cart-1:4:checkout-key-1');
    const client = { send: jest.fn().mockResolvedValue({ Item: { orderId, idempotencyFingerprint: prepared.idempotency.fingerprint } }) };
    await expect(createCheckoutRepository({ client }).createPendingCheckout({ prepared, orderNumber: 'DP-123' })).resolves.toMatchObject({ idempotentReplay: true });
    client.send.mockResolvedValue({ Item: { orderId, idempotencyFingerprint: 'different' } });
    await expect(createCheckoutRepository({ client }).createPendingCheckout({ prepared, orderNumber: 'DP-123' })).rejects.toMatchObject({ code: 'CHECKOUT_IDEMPOTENCY_CONFLICT' });
  });
  test('conditionally persists Stripe linkage and safely compensates failure', async () => {
    const client = { send: jest.fn().mockResolvedValueOnce({ Attributes: { orderId: 'o1' } }).mockResolvedValueOnce({}) };
    const repo = createCheckoutRepository({ client });
    await repo.persistStripeSession({ orderId: 'o1', expectedVersion: 1, session: { id: 'cs_1', expiresAt: 123 } });
    expect(client.send.mock.calls[0][0].input.ConditionExpression).toContain('#paymentState = :notStarted');
    await repo.recordStripeFailureAndUnlock({ order: { orderId: 'o1', cartId: 'c1', customerId: 'sub-1', cartVersion: 4, version: 1 }, failureCode: 'STRIPE_UNAVAILABLE' });
    const tx = client.send.mock.calls[1][0].input.TransactItems;
    expect(tx[1].Update.UpdateExpression).toContain('#status = :active');
  });
  test('accepts the maximum 96 small items within the 100-action limit', async () => {
    const client = { send: jest.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({}) };
    const maximum = { ...prepared, proposedItems: Array.from({ length: 96 }, (_, index) => ({ productId: `p${index}`, lineTotalCents: 1 })) };
    await expect(createCheckoutRepository({ client }).createPendingCheckout({ prepared: maximum, orderNumber: 'DP-MAX' })).resolves.toBeDefined();
    expect(client.send.mock.calls[1][0].input.TransactItems).toHaveLength(100);
  });
  test('rejects oversized individual and aggregate snapshots before any write', async () => {
    for (const proposedItems of [
      [{ productId: 'p1', customerConfiguration: { text: 'x'.repeat(2 * 1024 * 1024) }, lineTotalCents: 1 }],
      Array.from({ length: 20 }, (_, index) => ({ productId: `p${index}`, customerConfiguration: { text: 'x'.repeat(100000) }, lineTotalCents: 1 })),
    ]) {
      const client = { send: jest.fn().mockResolvedValueOnce({}) };
      await expect(createCheckoutRepository({ client }).createPendingCheckout({ prepared: { ...prepared, proposedItems }, orderNumber: 'DP-BIG' })).rejects.toMatchObject({ code: 'CHECKOUT_TOO_LARGE' });
      expect(client.send).toHaveBeenCalledTimes(1); // idempotency read only; no write
    }
  });
  test('uses a conservative byte estimate below the DynamoDB hard limit', () => {
    const near = [{ Put: { Item: { value: 'x'.repeat(1700000) } } }];
    expect(estimateTransactionBytes(near)).toBeLessThan(MAX_TRANSACTION_BYTES);
    expect(() => assertTransactionSafe(near)).not.toThrow();
    expect(() => assertTransactionSafe([{ Put: { Item: { value: 'x'.repeat(1900000) } } }])).toThrow(expect.objectContaining({ code: 'CHECKOUT_TOO_LARGE' }));
  });
  test('queries the deployed StripeCheckoutSessionIndex name', async () => {
    const client = { send: jest.fn().mockResolvedValueOnce({ Items: [] }) };
    await createCheckoutRepository({ client }).getOrderByStripeSessionId('cs_1');
    expect(client.send.mock.calls[0][0].input).toMatchObject({ IndexName: 'StripeCheckoutSessionIndex' });
  });
  test('claims duplicate webhook events with a conditional event-table write', async () => {
    const duplicate = Object.assign(new Error('duplicate'), { name: 'ConditionalCheckFailedException' });
    const client = { send: jest.fn().mockRejectedValueOnce(duplicate).mockResolvedValueOnce({ Item: { status: 'processing' } }) };
    await expect(createCheckoutRepository({ client }).claimStripeEvent({ eventId: 'evt_1', eventType: 'checkout.session.completed', stripeCreatedAt: 1770000000 })).resolves.toMatchObject({ duplicate: true });
    expect(client.send.mock.calls[0][0].input).toMatchObject({ TableName: 'divine-printing-stripe-events', ConditionExpression: 'attribute_not_exists(stripeEventId)' });
    expect(client.send.mock.calls[1][0].input).toMatchObject({ ConsistentRead: true });
  });
  test('atomically creates one deterministic confirmation outbox record with the paid transition', async () => {
    const client = { send: jest.fn().mockResolvedValue({}) };
    const order = { orderId: 'order-1', cartId: 'cart-1', cartVersion: 4, version: 2, paymentState: 'checkout_session_created' };
    await expect(createCheckoutRepository({ client, now: () => new Date('2026-09-10T00:00:00Z') }).transitionOrderToPaid({ order, stripePaymentIntentId: 'pi_1', stripeEventId: 'evt_1' })).resolves.toBe(true);
    const tx = client.send.mock.calls[0][0].input.TransactItems;
    expect(tx).toHaveLength(3);
    expect(tx[0].Update.ExpressionAttributeValues).toMatchObject({ ':paid': 'paid', ':confirmed': 'confirmed' });
    expect(tx[2].Put).toMatchObject({
      TableName: 'divine-printing-order-notifications',
      ConditionExpression: 'attribute_not_exists(notificationId)',
      Item: { notificationId: 'order-confirmation:order-1', notificationType: 'order_confirmation', orderId: 'order-1', deliveryState: 'pending', attemptCount: 0 },
    });
  });
  test('does not create another confirmation when an immediate/async race finds the order paid', async () => {
    const client = { send: jest.fn() };
    const repo = createCheckoutRepository({ client });
    await expect(repo.transitionOrderToPaid({ order: { orderId: 'order-1', paymentState: 'paid' }, stripePaymentIntentId: 'pi_1', stripeEventId: 'evt_2' })).resolves.toBe(false);
    expect(client.send).not.toHaveBeenCalled();
  });
});
