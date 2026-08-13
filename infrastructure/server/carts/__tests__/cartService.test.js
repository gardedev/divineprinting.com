'use strict';

jest.mock('../cartRepository', () => ({ createCartRepository: jest.fn(() => ({})) }));
jest.mock('../../products/productService', () => ({}));

const { createCartService, CartServiceError, dedupeKey } = require('../cartService');

const customer = { type: 'customer', sub: 'sub-1' };
const anonymous = { type: 'anonymous', anonymousSessionHash: 'token-hash' };
const product = { productId: 'p1', status: 'active', basePrice: 250, version: 3, pricingVersion: 2 };

function setup(overrides = {}) {
  const repo = {
    createCart: jest.fn(), findActiveCustomerCart: jest.fn(), findAnonymousCartByHash: jest.fn(),
    getCart: jest.fn(), listCartItems: jest.fn(), getCartItem: jest.fn(), createCartItem: jest.fn(),
    updateCartItem: jest.fn(), deleteCartItem: jest.fn(), getMutationReplay: jest.fn().mockResolvedValue(null), ...overrides.repo,
  };
  const productService = { getProduct: jest.fn().mockResolvedValue(product), ...overrides.productService };
  return { repo, productService, service: createCartService({ cartRepository: repo, productService }) };
}

describe('cartService', () => {
  test('creates customer and anonymous carts with trusted ownership and USD', async () => {
    const { repo, service } = setup(); repo.createCart.mockImplementation(async (input) => input);
    await expect(service.createCart(customer)).resolves.toMatchObject({ cartType: 'customer', customerId: 'sub-1', currency: 'USD' });
    await expect(service.createCart(anonymous)).resolves.toMatchObject({ cartType: 'anonymous', anonymousSessionHash: 'token-hash', currency: 'USD' });
    expect(JSON.stringify(repo.createCart.mock.calls)).not.toContain('anonymousToken');
  });

  test('finds or creates the current customer cart and returns items', async () => {
    const { repo, service } = setup();
    repo.findActiveCustomerCart.mockResolvedValue(null);
    repo.createCart.mockResolvedValue({ cartId: 'new', customerId: 'sub-1', status: 'active' });
    repo.listCartItems.mockResolvedValue([]);
    await expect(service.getCurrentCart(customer)).resolves.toMatchObject({ cart: { cartId: 'new' }, items: [] });
    expect(repo.createCart).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'sub-1' }));
  });

  test('returns checkout-in-progress instead of creating a second cart', async () => {
    const { repo, service } = setup(); repo.findActiveCustomerCart.mockResolvedValue({ cartId: 'locked', customerId: 'sub-1', status: 'pending_checkout' });
    await expect(service.getCurrentCart(customer)).rejects.toMatchObject({ code: 'CART_CHECKOUT_IN_PROGRESS' });
    expect(repo.createCart).not.toHaveBeenCalled();
  });

  test('requires anonymous hash lookup and does not create a missing anonymous cart', async () => {
    const { repo, service } = setup(); repo.findAnonymousCartByHash.mockResolvedValue(null);
    await expect(service.getCurrentCart(anonymous)).rejects.toMatchObject({ code: 'CART_NOT_FOUND' });
    expect(repo.createCart).not.toHaveBeenCalled();
  });

  test('adds a new item using ProductService price, USD, totals, and neutral inventory', async () => {
    const { repo, productService, service } = setup();
    repo.getCart.mockResolvedValue({ cartId: 'c', customerId: 'sub-1', status: 'active', currency: 'USD' });
    repo.listCartItems.mockResolvedValue([]); repo.createCartItem.mockImplementation(async (input) => input);
    const result = await service.addItem({ context: customer, cartId: 'c', expectedCartVersion: 1, mutationId: 'm1', item: { productId: 'p1', quantity: 2, unitPriceCents: 1 } });
    expect(productService.getProduct).toHaveBeenCalledWith('p1');
    expect(result.item).toMatchObject({ unitPriceCents: 250, lineTotalCents: 500, currency: 'USD', inventoryStatus: 'not_checked', validationStatus: 'warning' });
    expect(result.cartUpdates).toMatchObject({ subtotalCents: 500, discountCents: 0, taxCents: 0, shippingCents: 0, totalCents: 500 });
  });

  test('activates an anonymous draft after its first successful add', async () => {
    const { repo, service } = setup();
    repo.getCart.mockResolvedValue({ cartId: 'c', anonymousSessionHash: 'token-hash', status: 'draft' });
    repo.listCartItems.mockResolvedValue([]); repo.createCartItem.mockImplementation(async (input) => input);
    const result = await service.addItem({ context: anonymous, cartId: 'c', expectedCartVersion: 1, mutationId: 'm', item: { productId: 'p1', quantity: 1 } });
    expect(result.cartUpdates.status).toBe('active');
  });

  test('combines identical lines and rejects combined quantity above 99', async () => {
    const existing = { cartItemId: 'i', productId: 'p1', dedupeKey: dedupeKey({ productId: 'p1' }), quantity: 2, lineTotalCents: 500, version: 4 };
    const { repo, service } = setup(); repo.getCart.mockResolvedValue({ cartId: 'c', customerId: 'sub-1', status: 'active' }); repo.listCartItems.mockResolvedValue([existing]); repo.updateCartItem.mockImplementation(async (input) => input);
    const result = await service.addItem({ context: customer, cartId: 'c', expectedCartVersion: 2, mutationId: 'combine', item: { productId: 'p1', quantity: 3 } });
    expect(result.updates).toMatchObject({ quantity: 5, lineTotalCents: 1250 });
    expect(result.updates).not.toHaveProperty('productId');
    await expect(service.addItem({ context: customer, cartId: 'c', expectedCartVersion: 2, mutationId: 'overflow', item: { productId: 'p1', quantity: 98 } })).rejects.toMatchObject({ code: 'CART_QUANTITY_INVALID' });
  });

  test('dedupe is stable, ignores price/quantity, and separates material selections', () => {
    expect(dedupeKey({ productId: 'p', quantity: 1, unitPriceCents: 1, variation: { b: 2, a: 1 } })).toBe(dedupeKey({ productId: 'p', quantity: 9, unitPriceCents: 999, variation: { a: 1, b: 2 } }));
    expect(dedupeKey({ productId: 'p', variation: { color: 'red' } })).not.toBe(dedupeKey({ productId: 'p', variation: { color: 'blue' } }));
  });

  test.each([0, 100, 1.5])('rejects invalid quantity %p without repository mutation', async (quantity) => {
    const { repo, service } = setup(); repo.getCart.mockResolvedValue({ cartId: 'c', customerId: 'sub-1', status: 'active' });
    await expect(service.addItem({ context: customer, cartId: 'c', expectedCartVersion: 1, mutationId: 'm', item: { productId: 'p1', quantity } })).rejects.toMatchObject({ code: 'CART_QUANTITY_INVALID' });
    expect(repo.createCartItem).not.toHaveBeenCalled();
  });

  test('honors stricter existing product quantity fields', async () => {
    const { repo, service } = setup({ productService: { getProduct: jest.fn().mockResolvedValue({ ...product, minimumQuantity: 5, maximumQuantity: 20, quantityIncrement: 5 }) } });
    repo.getCart.mockResolvedValue({ cartId: 'c', customerId: 'sub-1', status: 'active' }); repo.listCartItems.mockResolvedValue([]);
    await expect(service.addItem({ context: customer, cartId: 'c', expectedCartVersion: 1, mutationId: 'm', item: { productId: 'p1', quantity: 6 } })).rejects.toMatchObject({ code: 'CART_QUANTITY_INVALID' });
  });

  test('rejects unavailable products, unsupported selections, and non-USD products', async () => {
    const { repo, productService, service } = setup(); repo.getCart.mockResolvedValue({ cartId: 'c', customerId: 'sub-1', status: 'active' });
    productService.getProduct.mockResolvedValueOnce({ ...product, status: 'draft' });
    await expect(service.addItem({ context: customer, cartId: 'c', expectedCartVersion: 1, mutationId: '1', item: { productId: 'p1', quantity: 1 } })).rejects.toMatchObject({ code: 'CART_PRODUCT_UNAVAILABLE' });
    productService.getProduct.mockResolvedValueOnce(product);
    await expect(service.addItem({ context: customer, cartId: 'c', expectedCartVersion: 1, mutationId: '2', item: { productId: 'p1', sku: 'unknown', quantity: 1 } })).rejects.toMatchObject({ code: 'CART_INVALID_VARIATION' });
    productService.getProduct.mockResolvedValueOnce({ ...product, currency: 'EUR' });
    await expect(service.addItem({ context: customer, cartId: 'c', expectedCartVersion: 1, mutationId: '3', item: { productId: 'p1', quantity: 1 } })).rejects.toMatchObject({ code: 'CART_CURRENCY_MISMATCH' });
  });

  test('checks ownership before product lookup or mutation', async () => {
    const { repo, productService, service } = setup(); repo.getCart.mockResolvedValue({ cartId: 'c', customerId: 'other', status: 'active' });
    await expect(service.addItem({ context: customer, cartId: 'c', expectedCartVersion: 1, mutationId: 'm', item: { productId: 'p1', quantity: 1 } })).rejects.toMatchObject({ code: 'CART_ACCESS_DENIED' });
    expect(productService.getProduct).not.toHaveBeenCalled(); expect(repo.createCartItem).not.toHaveBeenCalled();
  });

  test.each([
    ['pending_checkout', 'CART_CHECKOUT_IN_PROGRESS'], ['expired', 'CART_EXPIRED'],
    ['abandoned', 'CART_ABANDONED'], ['converted', 'CART_ALREADY_CONVERTED'],
  ])('blocks mutation for %s', async (status, code) => {
    const { repo, service } = setup(); repo.getCart.mockResolvedValue({ cartId: 'c', customerId: 'sub-1', status });
    await expect(service.addItem({ context: customer, cartId: 'c', expectedCartVersion: 1, mutationId: 'm', item: { productId: 'p1', quantity: 1 } })).rejects.toMatchObject({ code });
  });

  test('updates quantity from ProductService and persists recalculated totals atomically', async () => {
    const item = { cartItemId: 'i', productId: 'p1', quantity: 1, lineTotalCents: 250, version: 2 };
    const { repo, service } = setup(); repo.getCart.mockResolvedValue({ cartId: 'c', customerId: 'sub-1', status: 'active' }); repo.getCartItem.mockResolvedValue(item); repo.listCartItems.mockResolvedValue([item]); repo.updateCartItem.mockImplementation(async (input) => input);
    const result = await service.updateItemQuantity({ context: customer, cartId: 'c', cartItemId: 'i', expectedCartVersion: 4, expectedItemVersion: 2, mutationId: 'u', quantity: 3 });
    expect(result.updates).toMatchObject({ quantity: 3, unitPriceCents: 250, lineTotalCents: 750 });
    expect(result.cartUpdates).toMatchObject({ subtotalCents: 750, totalCents: 750 });
  });

  test('removes explicitly and recalculates totals without clear-cart behavior', async () => {
    const items = [{ cartItemId: 'i1', lineTotalCents: 250 }, { cartItemId: 'i2', lineTotalCents: 500 }];
    const { repo, service } = setup(); repo.getCart.mockResolvedValue({ cartId: 'c', customerId: 'sub-1', status: 'active' }); repo.listCartItems.mockResolvedValue(items); repo.deleteCartItem.mockImplementation(async (input) => input);
    const result = await service.removeItem({ context: customer, cartId: 'c', cartItemId: 'i1', expectedCartVersion: 2, expectedItemVersion: 1, mutationId: 'd' });
    expect(result.cartUpdates).toMatchObject({ subtotalCents: 500, totalCents: 500 });
    expect(service.clearCart).toBeUndefined();
  });

  test('passes stable idempotency inputs and translates repository lifecycle errors', async () => {
    const { repo, service } = setup(); repo.getCart.mockResolvedValue({ cartId: 'c', customerId: 'sub-1', status: 'active' }); repo.listCartItems.mockResolvedValue([]);
    const error = Object.assign(new Error(), { code: 'CART_IDEMPOTENCY_CONFLICT' }); repo.createCartItem.mockRejectedValue(error);
    await expect(service.addItem({ context: customer, cartId: 'c', expectedCartVersion: 1, mutationId: 'm', item: { productId: 'p1', quantity: 1 } })).rejects.toMatchObject({ code: 'CART_IDEMPOTENCY_CONFLICT' });
    expect(repo.createCartItem.mock.calls[0][0].idempotencyInput).toEqual(expect.objectContaining({ operation: 'addItem', quantity: 1 }));
  });

  test('returns a matching add retry before product revalidation', async () => {
    const { repo, productService, service } = setup();
    repo.getMutationReplay.mockResolvedValue({ result: { cartItemId: 'original' } });
    repo.getCartItem.mockResolvedValue({ cartItemId: 'original', quantity: 1 });
    await expect(service.addItem({ context: customer, cartId: 'c', expectedCartVersion: 1, mutationId: 'same', item: { productId: 'p1', quantity: 1 } })).resolves.toMatchObject({ cartItemId: 'original' });
    expect(productService.getProduct).not.toHaveBeenCalled(); expect(repo.createCartItem).not.toHaveBeenCalled();
  });
});
