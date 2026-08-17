'use strict';

jest.mock('../../utils/dynamoDbClient', () => ({ docClient: { send: jest.fn() } }));
const { createCartRepository } = require('../cartRepository');

describe('Task 5.6 atomic cart claim repository', () => {
  test('conditions both owners and versions, pointer, item writes, and source conversion in one transaction', async () => {
    const client = { send: jest.fn().mockResolvedValue({}) };
    const repository = createCartRepository({ client, now: () => new Date('2026-08-17T00:00:00Z'), generateId: () => 'new-item' });
    await repository.claimAnonymousCart({
      customerId: 'sub-1', anonymousSessionHash: 'hash', mutationId: 'migration-1',
      customerCart: { cartId: 'customer', cartType: 'customer', customerId: 'sub-1', status: 'active', version: 4, idempotencyRecords: [] },
      anonymousCart: { cartId: 'anonymous', cartType: 'anonymous', anonymousSessionHash: 'hash', status: 'active', version: 2 },
      items: [{ productId: 'p', quantity: 2, unitPriceCents: 500, lineTotalCents: 1000 }],
      cartUpdates: { subtotalCents: 1000, discountCents: 0, taxCents: 0, shippingCents: 0, totalCents: 1000, validationStatus: 'valid' },
    });
    const input = client.send.mock.calls[0][0].input;
    expect(input.TransactItems).toHaveLength(4);
    expect(input.ClientRequestToken).toMatch(/^[a-f0-9]{36}$/);
    expect(input.TransactItems[0].Update.ConditionExpression).toContain('#version = :expectedVersion');
    expect(input.TransactItems[1].Update.ExpressionAttributeValues).toMatchObject({ ':converted': 'converted', ':reason': 'customer_cart_merge', ':migrationId': 'migration-1', ':targetId': 'customer' });
    expect(input.TransactItems[2].ConditionCheck.ExpressionAttributeValues[':targetId']).toBe('customer');
    expect(input.TransactItems[3].Put.Item).toMatchObject({ cartId: 'customer', cartItemId: 'new-item' });
    expect(JSON.stringify(input)).not.toContain('cartToken');
  });

  test('preflights the DynamoDB 100-action transaction limit before writing', async () => {
    const client = { send: jest.fn() };
    const repository = createCartRepository({ client });
    const items = Array.from({ length: 98 }, (_, index) => ({ productId: `p-${index}`, quantity: 1, unitPriceCents: 1, lineTotalCents: 1 }));
    await expect(repository.claimAnonymousCart({
      customerId: 'sub', anonymousSessionHash: 'hash', mutationId: 'migration',
      customerCart: { cartId: 'customer', customerId: 'sub', status: 'active', version: 1 },
      anonymousCart: { cartId: 'anonymous', anonymousSessionHash: 'hash', status: 'active', version: 1 },
      items, cartUpdates: {},
    })).rejects.toMatchObject({ code: 'CART_MERGE_TOO_LARGE' });
    expect(client.send).not.toHaveBeenCalled();
  });

  test('preflights a conservative serialized transaction-size budget before writing', async () => {
    const client = { send: jest.fn() };
    const repository = createCartRepository({ client });
    const items = Array.from({ length: 15 }, (_, index) => ({
      productId: `p-${index}`, quantity: 1, unitPriceCents: 1, lineTotalCents: 1,
      customerInstructions: 'x'.repeat(245 * 1024),
    }));
    await expect(repository.claimAnonymousCart({
      customerId: 'sub', anonymousSessionHash: 'hash', mutationId: 'migration',
      customerCart: { cartId: 'customer', customerId: 'sub', status: 'active', version: 1 },
      anonymousCart: { cartId: 'anonymous', anonymousSessionHash: 'hash', status: 'active', version: 1 },
      items, cartUpdates: {},
    })).rejects.toMatchObject({ code: 'CART_MERGE_TOO_LARGE' });
    expect(client.send).not.toHaveBeenCalled();
  });
});
