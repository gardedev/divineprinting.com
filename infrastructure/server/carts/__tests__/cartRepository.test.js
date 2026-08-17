'use strict';

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const make = (kind) => function Command(input) { this.kind = kind; this.input = input; };
  return {
    PutCommand: make('Put'), GetCommand: make('Get'), QueryCommand: make('Query'),
    UpdateCommand: make('Update'), TransactWriteCommand: make('TransactWrite'),
    DynamoDBDocumentClient: { from: jest.fn() },
  };
});
jest.mock('../../utils/dynamoDbClient', () => ({ docClient: { send: jest.fn() } }));

const { createCartRepository, CartRepositoryError, constants, fingerprint, customerPointerId } = require('../cartRepository');

const fixedNow = new Date('2026-08-13T12:00:00.000Z');
const epoch = Math.floor(fixedNow.getTime() / 1000);
const customerOwner = { type: 'customer', customerId: 'cognito-sub-1' };
const anonymousOwner = { type: 'anonymous', anonymousSessionHash: 'sha256-token-hash' };

function setup() {
  const client = { send: jest.fn() };
  const repository = createCartRepository({ client, now: () => fixedNow, generateId: () => 'generated-id' });
  return { client, repository };
}

describe('cartRepository', () => {
  test('creates an anonymous cart with hash-only ownership and 14-day epoch TTL', async () => {
    const { client, repository } = setup(); client.send.mockResolvedValue({});
    const cart = await repository.createCart({ cartType: 'anonymous', anonymousSessionHash: 'sha256-token-hash' });
    expect(cart).toMatchObject({ cartId: 'generated-id', status: 'draft', version: 1, anonymousSessionHash: 'sha256-token-hash', expiresAt: epoch + constants.ANONYMOUS_TTL_SECONDS });
    expect(cart).not.toHaveProperty('anonymousToken');
    expect(client.send.mock.calls[0][0].input.ConditionExpression).toBe('attribute_not_exists(cartId)');
  });

  test('creates a customer cart owned by Cognito sub with 90-day TTL and cent snapshots', async () => {
    const { client, repository } = setup(); client.send.mockResolvedValue({});
    const cart = await repository.createCart({ cartType: 'customer', customerId: 'cognito-sub-1', subtotalCents: 1001, totalCents: 1001 });
    expect(cart).toMatchObject({ customerId: 'cognito-sub-1', subtotalCents: 1001, totalCents: 1001, expiresAt: epoch + constants.CUSTOMER_TTL_SECONDS });
    expect(Number.isInteger(cart.totalCents)).toBe(true);
  });

  test('rejects raw anonymous and authentication tokens before persistence', async () => {
    const { client, repository } = setup();
    await expect(repository.createCart({ cartType: 'anonymous', anonymousSessionHash: 'hash', anonymousToken: 'secret' })).rejects.toThrow('must not be persisted');
    expect(client.send).not.toHaveBeenCalled();
  });

  test('rejects mixed or missing ownership models', async () => {
    const { repository } = setup();
    await expect(repository.createCart({ cartType: 'customer', customerId: 'sub', anonymousSessionHash: 'hash' })).rejects.toThrow('cannot have anonymous ownership');
    await expect(repository.createCart({ cartType: 'anonymous', anonymousSessionHash: 'hash', customerId: 'sub' })).rejects.toThrow('cannot have customer ownership');
  });

  test('translates create collisions safely', async () => {
    const { client, repository } = setup(); const error = new Error(); error.name = 'ConditionalCheckFailedException'; client.send.mockRejectedValue(error);
    await expect(repository.createCart({ cartType: 'customer', customerId: 'sub' })).rejects.toMatchObject({ code: 'CART_ID_CONFLICT' });
  });

  test('gets a cart consistently and returns null when absent', async () => {
    const { client, repository } = setup(); client.send.mockResolvedValue({});
    await expect(repository.getCart('cart-1')).resolves.toBeNull();
    expect(client.send.mock.calls[0][0].input).toMatchObject({ Key: { cartId: 'cart-1' }, ConsistentRead: true });
  });

  test('uses approved customer and anonymous indexes', async () => {
    const { client, repository } = setup(); client.send.mockResolvedValueOnce({ Items: [{ cartId: 'customer-cart' }] }).mockResolvedValueOnce({ Items: [{ cartId: 'guest-cart' }] });
    await expect(repository.findActiveCustomerCart('sub')).resolves.toMatchObject({ cartId: 'customer-cart' });
    await expect(repository.findAnonymousCartByHash('hash')).resolves.toMatchObject({ cartId: 'guest-cart' });
    expect(client.send.mock.calls[0][0].input.IndexName).toBe('CustomerActiveCartIndex');
    expect(client.send.mock.calls[1][0].input.IndexName).toBe('AnonymousSessionIndex');
    expect(JSON.stringify(client.send.mock.calls[1][0].input)).not.toContain('anonymousToken');
  });

  test('transactionally creates one current customer cart and hashed pointer', async () => {
    const { client, repository } = setup();
    client.send.mockResolvedValueOnce({}).mockResolvedValueOnce({ Items: [] }).mockResolvedValueOnce({});
    const cart = await repository.findOrCreateCustomerCart('cognito-sub-1');
    expect(cart).toMatchObject({ cartId: 'generated-id', customerId: 'cognito-sub-1', status: 'active', expiresAt: epoch + constants.CUSTOMER_TTL_SECONDS });
    const transaction = client.send.mock.calls[2][0].input.TransactItems;
    const pointer = transaction[1].Put.Item;
    expect(pointer).toMatchObject({ cartId: customerPointerId('cognito-sub-1'), recordType: 'customer_active_cart_pointer', activeCartId: 'generated-id' });
    expect(pointer).not.toHaveProperty('customerId');
    expect(JSON.stringify(pointer)).not.toContain('cognito-sub-1');
  });

  test('adopts a valid legacy active cart instead of creating a duplicate', async () => {
    const legacy = { cartId: 'legacy-cart', cartType: 'customer', customerId: 'cognito-sub-1', status: 'active', expiresAt: epoch + 100, version: 4 };
    const { client, repository } = setup();
    client.send.mockResolvedValueOnce({}).mockResolvedValueOnce({ Items: [legacy] }).mockResolvedValueOnce({});
    await expect(repository.findOrCreateCustomerCart('cognito-sub-1')).resolves.toBe(legacy);
    const transaction = client.send.mock.calls[2][0].input.TransactItems;
    expect(transaction).toHaveLength(1);
    expect(transaction[0].Put.Item.activeCartId).toBe('legacy-cart');
  });

  test('reads an existing pointer without extending TTL or changing cart version', async () => {
    const cart = { cartId: 'current-cart', cartType: 'customer', customerId: 'cognito-sub-1', status: 'active', expiresAt: epoch + 100, version: 7 };
    const { client, repository } = setup();
    client.send.mockResolvedValueOnce({ Item: { cartId: customerPointerId('cognito-sub-1'), recordType: 'customer_active_cart_pointer', activeCartId: 'current-cart' } }).mockResolvedValueOnce({ Item: cart });
    await expect(repository.findOrCreateCustomerCart('cognito-sub-1')).resolves.toBe(cart);
    expect(client.send).toHaveBeenCalledTimes(2);
    expect(client.send.mock.calls.every(([command]) => command.kind === 'Get')).toBe(true);
  });

  test('atomically expires and replaces an elapsed current cart', async () => {
    const expired = { cartId: 'old-cart', cartType: 'customer', customerId: 'cognito-sub-1', status: 'active', expiresAt: epoch - 1, version: 3 };
    let nextId = 0;
    const client = { send: jest.fn().mockResolvedValueOnce({ Item: { cartId: customerPointerId('cognito-sub-1'), recordType: 'customer_active_cart_pointer', activeCartId: 'old-cart' } }).mockResolvedValueOnce({ Item: expired }).mockResolvedValueOnce({}) };
    const repository = createCartRepository({ client, now: () => fixedNow, generateId: () => `replacement-${++nextId}` });
    const replacement = await repository.findOrCreateCustomerCart('cognito-sub-1');
    expect(replacement).toMatchObject({ cartId: 'replacement-1', status: 'active', subtotalCents: 0, totalCents: 0, version: 1 });
    const transaction = client.send.mock.calls[2][0].input.TransactItems;
    expect(transaction).toHaveLength(3);
    expect(transaction[1].Update).toMatchObject({ Key: { cartId: 'old-cart' } });
    expect(transaction[1].Update.ExpressionAttributeValues).toMatchObject({ ':expired': 'expired', ':expectedVersion': 3 });
    expect(transaction[2].Update.ExpressionAttributeValues).toMatchObject({ ':priorCartId': 'old-cart', ':nextCartId': 'replacement-1' });
  });

  test('concurrent creation loser converges on the winning pointer cart', async () => {
    const conflict = Object.assign(new Error('race'), { name: 'TransactionCanceledException' });
    const winner = { cartId: 'winner-cart', cartType: 'customer', customerId: 'cognito-sub-1', status: 'active', expiresAt: epoch + 100, version: 1 };
    const { client, repository } = setup();
    client.send.mockResolvedValueOnce({}).mockResolvedValueOnce({ Items: [] }).mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({ Item: { cartId: customerPointerId('cognito-sub-1'), recordType: 'customer_active_cart_pointer', activeCartId: 'winner-cart' } })
      .mockResolvedValueOnce({ Item: winner });
    await expect(repository.findOrCreateCustomerCart('cognito-sub-1')).resolves.toBe(winner);
  });

  test('queries expiration candidates by status and integer epoch seconds', async () => {
    const { client, repository } = setup(); client.send.mockResolvedValue({ Items: [{ cartId: 'old' }] });
    await expect(repository.queryExpiringCarts('active', epoch)).resolves.toHaveLength(1);
    const input = client.send.mock.calls[0][0].input;
    expect(input.IndexName).toBe('CartStatusExpiryIndex');
    expect(input.ExpressionAttributeValues[':expiresAt']).toBe(epoch);
  });

  test('mutates with owner, lifecycle, and optimistic-version conditions and increments atomically', async () => {
    const { client, repository } = setup();
    client.send.mockResolvedValueOnce({ Item: { cartId: 'cart-1', cartType: 'customer', customerId: 'cognito-sub-1', status: 'active', version: 2, idempotencyRecords: [] } }).mockResolvedValueOnce({ Attributes: { cartId: 'cart-1', version: 3 } });
    const result = await repository.mutateCart({ cartId: 'cart-1', owner: customerOwner, expectedVersion: 2, mutationId: 'mutation-1', updates: { totalCents: 2000 } });
    expect(result.idempotentReplay).toBe(false);
    const input = client.send.mock.calls[1][0].input;
    expect(input.ConditionExpression).toContain('#customerId = :ownerCustomerId');
    expect(input.ConditionExpression).toContain('#version = :expectedVersion');
    expect(input.ConditionExpression).toContain('#status = :draft OR #status = :active');
    expect(input.ExpressionAttributeValues[':nextVersion']).toBe(3);
  });

  test('returns legitimate idempotent retry without a second write', async () => {
    const { client, repository } = setup(); const fp = fingerprint({ operation: 'mutateCart', updates: {} });
    client.send.mockResolvedValue({ Item: { cartId: 'cart-1', customerId: 'cognito-sub-1', status: 'active', version: 4, idempotencyRecords: [{ mutationId: 'same', fingerprint: fp }] } });
    const result = await repository.mutateCart({ cartId: 'cart-1', owner: customerOwner, expectedVersion: 3, mutationId: 'same' });
    expect(result.idempotentReplay).toBe(true); expect(client.send).toHaveBeenCalledTimes(1);
  });

  test('rejects conflicting idempotency-key reuse', async () => {
    const { client, repository } = setup(); client.send.mockResolvedValue({ Item: { cartId: 'cart-1', customerId: 'cognito-sub-1', status: 'active', version: 4, idempotencyRecords: [{ mutationId: 'same', fingerprint: fingerprint({ operation: 'mutateCart', updates: { totalCents: 1 } }) }] } });
    await expect(repository.mutateCart({ cartId: 'cart-1', owner: customerOwner, expectedVersion: 3, mutationId: 'same', updates: { totalCents: 2 } })).rejects.toMatchObject({ code: 'CART_IDEMPOTENCY_CONFLICT' });
  });

  test('allows a lifecycle-changing replay only after trusted ownership validation', async () => {
    const { client, repository } = setup();
    const fp = fingerprint({ operation: 'mutateCart', updates: { status: 'converted' } });
    client.send.mockResolvedValueOnce({ Item: { cartId: 'cart-1', customerId: 'different-sub', status: 'converted', version: 2, idempotencyRecords: [{ mutationId: 'same', fingerprint: fp }] } });
    await expect(repository.mutateCart({ cartId: 'cart-1', owner: customerOwner, expectedVersion: 1, mutationId: 'same', updates: { status: 'converted' } })).rejects.toMatchObject({ code: 'CART_ACCESS_DENIED' });
    client.send.mockResolvedValueOnce({ Item: { cartId: 'cart-1', customerId: 'cognito-sub-1', status: 'converted', version: 2, idempotencyRecords: [{ mutationId: 'same', fingerprint: fp }] } });
    await expect(repository.mutateCart({ cartId: 'cart-1', owner: customerOwner, expectedVersion: 1, mutationId: 'same', updates: { status: 'converted' } })).resolves.toMatchObject({ idempotentReplay: true });
  });

  test('bounds cart-record idempotency metadata to twenty fingerprints', async () => {
    const { client, repository } = setup();
    const records = Array.from({ length: 20 }, (_, i) => ({ mutationId: `m${i}`, fingerprint: `${i}` }));
    client.send.mockResolvedValueOnce({ Item: { cartId: 'cart-1', cartType: 'customer', customerId: 'cognito-sub-1', status: 'active', version: 20, idempotencyRecords: records } }).mockResolvedValueOnce({ Attributes: {} });
    await repository.mutateCart({ cartId: 'cart-1', owner: customerOwner, expectedVersion: 20, mutationId: 'new' });
    const stored = client.send.mock.calls[1][0].input.ExpressionAttributeValues[':records'];
    expect(stored).toHaveLength(20); expect(stored[0].mutationId).toBe('m1'); expect(stored[19].mutationId).toBe('new'); expect(stored[19].fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain('payload');
  });

  test('computes mutation digests internally and never persists caller fingerprint payloads', async () => {
    const { client, repository } = setup();
    client.send.mockResolvedValueOnce({ Item: { cartId: 'cart-1', cartType: 'customer', customerId: 'cognito-sub-1', status: 'active', version: 1, idempotencyRecords: [] } }).mockResolvedValueOnce({ Attributes: {} });
    await repository.mutateCart({ cartId: 'cart-1', owner: customerOwner, expectedVersion: 1, mutationId: 'safe', mutationFingerprint: 'RAW_SECRET_PAYLOAD', updates: { totalCents: 500 } });
    const record = client.send.mock.calls[1][0].input.ExpressionAttributeValues[':records'][0];
    expect(record.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(record)).not.toContain('RAW_SECRET_PAYLOAD');
  });

  test('translates stale cart versions without exposing DynamoDB details', async () => {
    const { client, repository } = setup(); client.send.mockResolvedValueOnce({ Item: { cartId: 'cart-1', cartType: 'customer', customerId: 'cognito-sub-1', status: 'active', version: 1, idempotencyRecords: [] } });
    const error = new Error('internal dynamodb message'); error.name = 'ConditionalCheckFailedException'; client.send.mockRejectedValueOnce(error);
    await expect(repository.mutateCart({ cartId: 'cart-1', owner: customerOwner, expectedVersion: 1, mutationId: 'm' })).rejects.toEqual(expect.objectContaining({ code: 'CART_VERSION_CONFLICT', message: 'CART_VERSION_CONFLICT' }));
  });

  test('conditionally transitions an expired cart using ownership, status, expiry, and version', async () => {
    const { client, repository } = setup(); client.send.mockResolvedValue({ Attributes: { status: 'expired', version: 3 } });
    await repository.transitionExpiredCart({ cartId: 'cart-1', owner: anonymousOwner, expectedVersion: 2 });
    const input = client.send.mock.calls[0][0].input;
    expect(input.ConditionExpression).toContain('#anonymousSessionHash = :ownerAnonymousHash');
    expect(input.ConditionExpression).toContain('#expiresAt <= :nowEpoch');
    expect(input.ExpressionAttributeValues[':expired']).toBe('expired');
  });

  test('lists and gets items by the CartItems composite key', async () => {
    const { client, repository } = setup(); client.send.mockResolvedValueOnce({ Items: [{ cartItemId: 'i1' }] }).mockResolvedValueOnce({ Item: { cartItemId: 'i1' } });
    await expect(repository.listCartItems('cart-1')).resolves.toHaveLength(1);
    await expect(repository.getCartItem('cart-1', 'i1')).resolves.toMatchObject({ cartItemId: 'i1' });
    expect(client.send.mock.calls[1][0].input.Key).toEqual({ cartId: 'cart-1', cartItemId: 'i1' });
  });

  test('queries product-impact index', async () => {
    const { client, repository } = setup(); client.send.mockResolvedValue({ Items: [] });
    await repository.findCartItemsByProduct('product-1');
    expect(client.send.mock.calls[0][0].input.IndexName).toBe('ProductCartItemIndex');
  });

  test('creates an item transactionally with cart ownership/lifecycle/version guard', async () => {
    const { client, repository } = setup(); client.send.mockResolvedValueOnce({ Item: { cartId: 'cart-1', customerId: 'cognito-sub-1', status: 'active', version: 3, idempotencyRecords: [] } }).mockResolvedValueOnce({});
    const item = await repository.createCartItem({ cartId: 'cart-1', owner: customerOwner, expectedCartVersion: 3, mutationId: 'add-1', item: { productId: 'p1', quantity: 2, unitPriceCents: 350, lineTotalCents: 700 } });
    expect(item).toMatchObject({ cartId: 'cart-1', cartItemId: 'generated-id', quantity: 2, unitPriceCents: 350, lineTotalCents: 700, version: 1 });
    const tx = client.send.mock.calls[1][0].input.TransactItems;
    expect(tx[0].Update.ConditionExpression).toContain('#customerId = :ownerCustomerId');
    expect(tx[0].Update.ExpressionAttributeValues[':nextCartVersion']).toBe(4);
    expect(tx[1].Put.ConditionExpression).toContain('attribute_not_exists');
    expect(tx[0].Update.ExpressionAttributeValues[':records'][0]).toMatchObject({ mutationId: 'add-1', result: { cartItemId: 'generated-id' } });
  });

  test('does not persist client-supplied ownership fields on cart items', async () => {
    const { client, repository } = setup(); client.send.mockResolvedValueOnce({ Item: { cartId: 'cart-1', customerId: 'cognito-sub-1', status: 'active', version: 1, idempotencyRecords: [] } }).mockResolvedValueOnce({});
    const item = await repository.createCartItem({ cartId: 'cart-1', owner: customerOwner, expectedCartVersion: 1, mutationId: 'add-2', item: { productId: 'p1', customerId: 'attacker-sub', quantity: 1, unitPriceCents: 100, lineTotalCents: 100 } });
    expect(item).not.toHaveProperty('customerId');
    expect(client.send.mock.calls[1][0].input.TransactItems[1].Put.Item).not.toHaveProperty('customerId');
  });

  test('rejects non-integer quantities and monetary snapshots', async () => {
    const { client, repository } = setup();
    await expect(repository.createCartItem({ cartId: 'c', owner: customerOwner, expectedCartVersion: 1, mutationId: 'm1', item: { productId: 'p', quantity: 1.5, unitPriceCents: 100, lineTotalCents: 100 } })).rejects.toThrow('quantity must be an integer');
    await expect(repository.createCartItem({ cartId: 'c', owner: customerOwner, expectedCartVersion: 1, mutationId: 'm2', item: { productId: 'p', quantity: 1, unitPriceCents: 1.99, lineTotalCents: 2 } })).rejects.toThrow('unitPriceCents must be an integer');
    expect(client.send).not.toHaveBeenCalled();
  });

  test('updates an item transactionally with item and cart optimistic versions', async () => {
    const { client, repository } = setup(); client.send.mockResolvedValueOnce({ Item: { cartId: 'c', anonymousSessionHash: 'sha256-token-hash', status: 'active', version: 5, idempotencyRecords: [] } }).mockResolvedValueOnce({ Item: { cartId: 'c', cartItemId: 'i', quantity: 2 } }).mockResolvedValueOnce({});
    const result = await repository.updateCartItem({ cartId: 'c', cartItemId: 'i', owner: anonymousOwner, expectedCartVersion: 5, expectedItemVersion: 2, mutationId: 'update-1', updates: { quantity: 4, lineTotalCents: 800 } });
    expect(result).toMatchObject({ quantity: 4, version: 3 });
    const tx = client.send.mock.calls[2][0].input.TransactItems;
    expect(tx[0].Update.ConditionExpression).toContain('#anonymousSessionHash = :ownerAnonymousHash');
    expect(tx[1].Update.ConditionExpression).toContain('#version = :expectedItemVersion');
    expect(tx[1].Update.ExpressionAttributeValues[':nextItemVersion']).toBe(3);
  });

  test('persists approved option and fulfillment snapshots during item update', async () => {
    const { client, repository } = setup();
    client.send.mockResolvedValueOnce({ Item: { cartId: 'c', customerId: 'cognito-sub-1', status: 'active', version: 1, idempotencyRecords: [] } }).mockResolvedValueOnce({ Item: { cartId: 'c', cartItemId: 'i', quantity: 1 } }).mockResolvedValueOnce({});
    await repository.updateCartItem({ cartId: 'c', cartItemId: 'i', owner: customerOwner, expectedCartVersion: 1, expectedItemVersion: 1, mutationId: 'options', updates: { options: { size: 'L' }, fulfillment: { rush: false } } });
    const values = client.send.mock.calls[2][0].input.TransactItems[1].Update.ExpressionAttributeValues;
    expect(values[':u_options']).toEqual({ size: 'L' });
    expect(values[':u_fulfillment']).toEqual({ rush: false });
  });

  test('persists configured-job structures without changing table keys or transactions', async () => {
    const { client, repository } = setup();
    client.send.mockResolvedValueOnce({ Item: { cartId: 'c', customerId: 'cognito-sub-1', status: 'active', version: 1, idempotencyRecords: [] } }).mockResolvedValueOnce({});
    const configured = {
      productId: 'p', cartItemType: 'CONFIGURED_JOB', baseSku: 'BASE', quantity: 120, totalQuantity: 120,
      unitPriceCents: 1000, lineTotalCents: 120000, currency: 'USD', dedupeVersion: 'configured-job-v1', dedupeKey: 'hash',
      customerConfiguration: { schemaVersion: 'custom-v1', options: { material: 'vinyl' } },
      variantAllocations: [{ selections: { dimension: 'large' }, quantity: 120 }],
      pricingSnapshot: { schemaVersion: 'configured-pricing-v1', subtotalCents: 120000 },
      customerInstructions: 'Handle carefully',
    };
    const result = await repository.createCartItem({ cartId: 'c', owner: customerOwner, expectedCartVersion: 1, mutationId: 'configured', item: configured });
    expect(result).toMatchObject(configured);
    const put = client.send.mock.calls[1][0].input.TransactItems[1].Put;
    expect(put.Item).toMatchObject({ cartId: 'c', cartItemId: 'generated-id', cartItemType: 'CONFIGURED_JOB' });
    expect(put.Item).not.toHaveProperty('customerId');
  });

  test('enforces a 256 KiB serialized CartItem budget and nested credential exclusion', async () => {
    expect(constants.MAX_CART_ITEM_BYTES).toBe(256 * 1024);
    const { client, repository } = setup();
    const base = { productId: 'p', quantity: 1, unitPriceCents: 1, lineTotalCents: 1 };
    await expect(repository.createCartItem({ cartId: 'c', owner: customerOwner, expectedCartVersion: 1, mutationId: 'secret', item: { ...base, customerConfiguration: { accessToken: 'secret' } } })).rejects.toThrow('must not be persisted');
    client.send.mockResolvedValueOnce({ Item: { cartId: 'c', customerId: 'cognito-sub-1', status: 'active', version: 1, idempotencyRecords: [] } });
    await expect(repository.createCartItem({ cartId: 'c', owner: customerOwner, expectedCartVersion: 1, mutationId: 'large', item: { ...base, personalization: { text: 'x'.repeat(constants.MAX_CART_ITEM_BYTES) } } })).rejects.toMatchObject({ code: 'CART_ITEM_TOO_LARGE' });
  });

  test('hard-deletes an item transactionally with ownership and both version guards', async () => {
    const { client, repository } = setup(); client.send.mockResolvedValueOnce({ Item: { cartId: 'c', customerId: 'cognito-sub-1', status: 'active', version: 2, idempotencyRecords: [] } }).mockResolvedValueOnce({});
    await expect(repository.deleteCartItem({ cartId: 'c', cartItemId: 'i', owner: customerOwner, expectedCartVersion: 2, expectedItemVersion: 7, mutationId: 'delete-1' })).resolves.toBe(true);
    const tx = client.send.mock.calls[1][0].input.TransactItems;
    expect(tx[1].Delete).toBeDefined(); expect(tx[1].Delete).not.toHaveProperty('UpdateExpression');
    expect(tx[1].Delete.ExpressionAttributeValues[':expectedItemVersion']).toBe(7);
  });

  test('replays item creation without a second write and rejects conflicting key reuse', async () => {
    const { client, repository } = setup();
    const semantic = { productId: 'p1', quantity: 1, currency: 'USD', unitPriceCents: 100, lineTotalCents: 100 };
    const record = { mutationId: 'add-retry', fingerprint: fingerprint({ operation: 'createCartItem', item: semantic }), result: { cartItemId: 'original-item' } };
    client.send.mockResolvedValueOnce({ Item: { cartId: 'c', customerId: 'cognito-sub-1', status: 'active', version: 2, idempotencyRecords: [record] } }).mockResolvedValueOnce({ Item: { cartId: 'c', cartItemId: 'original-item', quantity: 1 } });
    await expect(repository.createCartItem({ cartId: 'c', owner: customerOwner, expectedCartVersion: 1, mutationId: 'add-retry', item: { productId: 'p1', quantity: 1, unitPriceCents: 100, lineTotalCents: 100 } })).resolves.toMatchObject({ cartItemId: 'original-item' });
    expect(client.send).toHaveBeenCalledTimes(2);

    client.send.mockResolvedValueOnce({ Item: { cartId: 'c', customerId: 'cognito-sub-1', status: 'active', version: 2, idempotencyRecords: [record] } });
    await expect(repository.createCartItem({ cartId: 'c', owner: customerOwner, expectedCartVersion: 1, mutationId: 'add-retry', item: { productId: 'p1', quantity: 2, unitPriceCents: 100, lineTotalCents: 200 } })).rejects.toMatchObject({ code: 'CART_IDEMPOTENCY_CONFLICT' });
  });

  test('preflights mutation replay with ownership and canonical conflict checks', async () => {
    const { client, repository } = setup();
    const semantic = { operation: 'addItem', productId: 'p1', quantity: 1 };
    client.send.mockResolvedValue({ Item: { cartId: 'c', customerId: 'cognito-sub-1', idempotencyRecords: [{ mutationId: 'same', fingerprint: fingerprint(semantic), result: { cartItemId: 'i' } }] } });
    await expect(repository.getMutationReplay({ cartId: 'c', owner: customerOwner, mutationId: 'same', idempotencyInput: semantic })).resolves.toMatchObject({ result: { cartItemId: 'i' } });
    await expect(repository.getMutationReplay({ cartId: 'c', owner: customerOwner, mutationId: 'same', idempotencyInput: { ...semantic, quantity: 2 } })).rejects.toMatchObject({ code: 'CART_IDEMPOTENCY_CONFLICT' });
  });

  test('replays item update and delete without applying either mutation twice', async () => {
    const { client, repository } = setup();
    const updateRecord = { mutationId: 'update-retry', fingerprint: fingerprint({ operation: 'updateCartItem', cartItemId: 'i', updates: { quantity: 3 } }), result: { cartItemId: 'i' } };
    client.send.mockResolvedValueOnce({ Item: { cartId: 'c', customerId: 'cognito-sub-1', status: 'active', version: 4, idempotencyRecords: [updateRecord] } }).mockResolvedValueOnce({ Item: { cartId: 'c', cartItemId: 'i', quantity: 3, version: 2 } });
    await expect(repository.updateCartItem({ cartId: 'c', cartItemId: 'i', owner: customerOwner, expectedCartVersion: 3, expectedItemVersion: 1, mutationId: 'update-retry', updates: { quantity: 3 } })).resolves.toMatchObject({ quantity: 3 });

    const deleteRecord = { mutationId: 'delete-retry', fingerprint: fingerprint({ operation: 'deleteCartItem', cartItemId: 'i' }), result: { cartItemId: 'i', deleted: true } };
    client.send.mockResolvedValueOnce({ Item: { cartId: 'c', customerId: 'cognito-sub-1', status: 'active', version: 5, idempotencyRecords: [deleteRecord] } });
    await expect(repository.deleteCartItem({ cartId: 'c', cartItemId: 'i', owner: customerOwner, expectedCartVersion: 4, expectedItemVersion: 2, mutationId: 'delete-retry' })).resolves.toBe(true);
    expect(client.send).toHaveBeenCalledTimes(3);
  });

  test('caps item mutation metadata and stores only digest plus bounded result identifiers', async () => {
    const { client, repository } = setup();
    const records = Array.from({ length: 20 }, (_, i) => ({ mutationId: `old-${i}`, fingerprint: 'a'.repeat(64) }));
    client.send.mockResolvedValueOnce({ Item: { cartId: 'c', customerId: 'cognito-sub-1', status: 'active', version: 20, idempotencyRecords: records } }).mockResolvedValueOnce({});
    await repository.deleteCartItem({ cartId: 'c', cartItemId: 'i', owner: customerOwner, expectedCartVersion: 20, expectedItemVersion: 1, mutationId: 'delete-new', mutationFingerprint: 'RAW_REQUEST' });
    const stored = client.send.mock.calls[1][0].input.TransactItems[0].Update.ExpressionAttributeValues[':records'];
    expect(stored).toHaveLength(20);
    expect(stored[0].mutationId).toBe('old-1');
    expect(stored[19]).toMatchObject({ mutationId: 'delete-new', result: { cartItemId: 'i', deleted: true } });
    expect(stored[19].fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain('RAW_REQUEST');
  });

  test('supports bounded generic DynamoDB transactions with request token', async () => {
    const { client, repository } = setup(); client.send.mockResolvedValue({ ok: true });
    await repository.executeTransaction([{ ConditionCheck: { TableName: 'table' } }], { clientRequestToken: 'request-1' });
    expect(client.send.mock.calls[0][0].input.ClientRequestToken).toBe('request-1');
    await expect(repository.executeTransaction([])).rejects.toThrow('between 1 and 100');
  });

  test('does not accept client role or ownership changes as cart mutations', async () => {
    const { client, repository } = setup(); client.send.mockResolvedValue({ Item: { cartId: 'c', cartType: 'customer', customerId: 'cognito-sub-1', status: 'active', version: 1, idempotencyRecords: [] } });
    await expect(repository.mutateCart({ cartId: 'c', owner: customerOwner, expectedVersion: 1, mutationId: 'm', updates: { customerId: 'attacker-sub' } })).rejects.toThrow('customerId is not mutable');
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  test('uses explicit safe repository errors', () => {
    expect(new CartRepositoryError('CART_NOT_FOUND')).toMatchObject({ code: 'CART_NOT_FOUND', message: 'CART_NOT_FOUND' });
  });
});
