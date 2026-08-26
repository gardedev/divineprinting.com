'use strict';
jest.mock('@aws-sdk/lib-dynamodb', () => ({ GetCommand: function(input){this.input=input;}, QueryCommand: function(input){this.input=input;}, UpdateCommand: function(input){this.input=input;}, TransactWriteCommand: function(input){this.input=input;} }));
jest.mock('../../utils/dynamoDbClient', () => ({ docClient: {} }));
const { createCheckoutRepository, deterministicId } = require('../checkoutRepository');

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
});
