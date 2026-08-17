'use strict';

jest.mock('../cartRepository', () => ({ createCartRepository: jest.fn(() => ({})) }));
jest.mock('../../products/productService', () => ({}));

const { createCartService, configuredJobDedupeKey } = require('../cartService');

const customer = { type: 'customer', sub: 'customer-sub' };
const anonymous = { type: 'anonymous', anonymousSessionHash: 'anonymous-hash' };
const customerCart = { cartId: 'customer-cart', cartType: 'customer', customerId: 'customer-sub', status: 'active', version: 4, idempotencyRecords: [] };
const sourceCart = { cartId: 'anonymous-cart', cartType: 'anonymous', anonymousSessionHash: 'anonymous-hash', status: 'active', version: 3, expiresAt: 9999999999 };
const configuration = { schemaVersion: 'custom-design-v1', options: { color: 'Black' }, designConfiguration: { canvasVersion: 'tshirt-800-v1', templateId: 'cross' } };

function evaluator(_productId, input) {
  const bySize = new Map();
  for (const allocation of input.variantAllocations) {
    const size = allocation.selections.size;
    bySize.set(size, (bySize.get(size) || 0) + allocation.quantity);
  }
  const allocations = [...bySize].map(([size, quantity]) => ({ selections: { size }, quantity, variantSurchargeCents: size === '2XL' ? 200 : 0 }));
  const totalQuantity = allocations.reduce((sum, entry) => sum + entry.quantity, 0);
  const base = totalQuantity >= 11 ? 1800 : 2500;
  const lineTotalCents = allocations.reduce((sum, entry) => sum + (base + entry.variantSurchargeCents) * entry.quantity, 0);
  return Promise.resolve({
    baseSku: 'DPT-CHURCH-TSHIRT', customerConfiguration: input.customerConfiguration,
    variantAllocations: allocations, totalQuantity, customerInstructions: input.customerInstructions,
    pricingSnapshot: { currency: 'USD', productVersion: 2, pricingVersion: 5, tier: { baseUnitPriceCents: base }, allocations, subtotalCents: lineTotalCents },
    lineTotalCents, dedupeVersion: 'configured-job-v1',
  });
}

function setup({ customerItems = [], sourceItems = [], source = sourceCart, product = {} } = {}) {
  const repo = {
    findOrCreateCustomerCart: jest.fn().mockResolvedValue(customerCart),
    getCart: jest.fn().mockImplementation(async (id) => id === source.cartId ? source : customerCart),
    listCartItems: jest.fn().mockImplementation(async (id) => id === customerCart.cartId ? customerItems : sourceItems),
    claimAnonymousCart: jest.fn().mockResolvedValue({}),
  };
  const productService = {
    getProduct: jest.fn().mockResolvedValue({ productId: 'simple', status: 'active', basePrice: 300, currency: 'USD', version: 2, pricingVersion: 3, ...product }),
    evaluateCartConfiguration: jest.fn().mockImplementation(evaluator),
  };
  return { repo, productService, service: createCartService({ cartRepository: repo, productService }) };
}

function claim(service, overrides = {}) {
  return service.claimAnonymousCart({ context: customer, anonymousContext: anonymous, anonymousCartId: 'anonymous-cart', expectedCustomerVersion: 4, expectedAnonymousVersion: 3, mutationId: 'merge-1', ...overrides });
}

describe('Task 5.6 cart claim service', () => {
  test('converts an empty anonymous cart into the existing empty customer cart', async () => {
    const { repo, service } = setup();
    await expect(claim(service)).resolves.toMatchObject({ cart: customerCart, items: [] });
    expect(repo.claimAnonymousCart).toHaveBeenCalledWith(expect.objectContaining({ items: [], cartUpdates: expect.objectContaining({ totalCents: 0 }) }));
  });

  test('atomically combines SIMPLE lines and reprices from ProductService', async () => {
    const common = { productId: 'simple', quantity: 2, unitPriceCents: 100, lineTotalCents: 200, version: 2 };
    const { repo, service } = setup({ customerItems: [{ ...common, cartItemId: 'target-item' }], sourceItems: [{ ...common, cartItemId: 'source-item', quantity: 3, version: 1 }] });
    const result = await claim(service);
    expect(repo.claimAnonymousCart).toHaveBeenCalledWith(expect.objectContaining({
      customerId: 'customer-sub', anonymousSessionHash: 'anonymous-hash', mutationId: 'merge-1',
      items: [expect.objectContaining({ cartItemId: 'target-item', quantity: 5, unitPriceCents: 300, lineTotalCents: 1500 })],
      priceUpdated: true,
    }));
    expect(result.warnings).toEqual(['CART_PRICE_UPDATED']);
  });

  test('combines configured jobs and generic allocations while preserving one instruction', async () => {
    const key = configuredJobDedupeKey({ productId: 'shirt', baseSku: 'DPT-CHURCH-TSHIRT', customerConfiguration: configuration });
    const shared = { cartItemType: 'CONFIGURED_JOB', productId: 'shirt', baseSku: 'DPT-CHURCH-TSHIRT', customerConfiguration: configuration, dedupeKey: key, unitPriceCents: 2500, pricingVersion: 1, productVersion: 1 };
    const { repo, productService, service } = setup({
      customerItems: [{ ...shared, cartItemId: 'target-job', version: 2, variantAllocations: [{ selections: { size: 'M' }, quantity: 5 }], quantity: 5, lineTotalCents: 12500, customerInstructions: '' }],
      sourceItems: [{ ...shared, cartItemId: 'source-job', version: 1, variantAllocations: [{ selections: { size: 'M' }, quantity: 5 }, { selections: { size: '2XL' }, quantity: 5 }], quantity: 10, lineTotalCents: 25000, customerInstructions: 'Handle carefully' }],
    });
    await claim(service);
    expect(productService.evaluateCartConfiguration).toHaveBeenCalledWith('shirt', expect.objectContaining({ customerInstructions: 'Handle carefully' }), expect.any(Object));
    expect(repo.claimAnonymousCart.mock.calls[0][0].items[0]).toMatchObject({ totalQuantity: 15, customerInstructions: 'Handle carefully', variantAllocations: expect.arrayContaining([{ selections: { size: 'M' }, quantity: 10, variantSurchargeCents: 0 }]) });
  });

  test('fails the whole merge for conflicting nonempty instructions', async () => {
    const shared = { cartItemType: 'CONFIGURED_JOB', productId: 'shirt', baseSku: 'base', customerConfiguration: configuration, variantAllocations: [{ selections: { size: 'M' }, quantity: 1 }], quantity: 1, lineTotalCents: 2500 };
    const { repo, service } = setup({ customerItems: [{ ...shared, cartItemId: 'one', version: 1, customerInstructions: 'A' }], sourceItems: [{ ...shared, cartItemId: 'two', version: 1, customerInstructions: 'B' }] });
    await expect(claim(service)).rejects.toMatchObject({ code: 'CART_INSTRUCTIONS_CONFLICT' });
    expect(repo.claimAnonymousCart).not.toHaveBeenCalled();
  });

  test('rejects stale versions and expired/unavailable carts without writes', async () => {
    const stale = setup();
    await expect(claim(stale.service, { expectedAnonymousVersion: 2 })).rejects.toMatchObject({ code: 'CART_VERSION_CONFLICT' });
    expect(stale.repo.claimAnonymousCart).not.toHaveBeenCalled();
    const expired = setup({ source: { ...sourceCart, expiresAt: 1 } });
    await expect(claim(expired.service)).rejects.toMatchObject({ code: 'CART_EXPIRED' });
    expect(expired.repo.claimAnonymousCart).not.toHaveBeenCalled();
  });

  test('fails all-or-nothing when current product validation or combined quantity fails', async () => {
    const line = { cartItemId: 'source', productId: 'simple', quantity: 60, unitPriceCents: 300, lineTotalCents: 18000, version: 1 };
    const unavailable = setup({ sourceItems: [line], product: { status: 'draft' } });
    await expect(claim(unavailable.service)).rejects.toMatchObject({ code: 'CART_PRODUCT_UNAVAILABLE' });
    expect(unavailable.repo.claimAnonymousCart).not.toHaveBeenCalled();
    const overflow = setup({ customerItems: [{ ...line, cartItemId: 'target' }], sourceItems: [line] });
    await expect(claim(overflow.service)).rejects.toMatchObject({ code: 'CART_QUANTITY_INVALID' });
    expect(overflow.repo.claimAnonymousCart).not.toHaveBeenCalled();
  });

  test('requires ownership of both carts before validation or writes', async () => {
    const { repo, productService, service } = setup({ source: { ...sourceCart, anonymousSessionHash: 'different-hash' } });
    await expect(claim(service)).rejects.toMatchObject({ code: 'CART_ACCESS_DENIED' });
    expect(productService.getProduct).not.toHaveBeenCalled();
    expect(repo.claimAnonymousCart).not.toHaveBeenCalled();
  });

  test('returns an already completed claim only for the same trusted owner and mutation', async () => {
    const converted = { ...sourceCart, status: 'converted', migrationId: 'merge-1', mergedIntoCartId: 'customer-cart', priceUpdated: true };
    const { repo, service } = setup({ source: converted });
    repo.getCart.mockImplementation(async (id) => id === 'anonymous-cart' ? converted : customerCart);
    await expect(claim(service)).resolves.toMatchObject({ cart: customerCart, warnings: ['CART_PRICE_UPDATED'] });
    expect(repo.claimAnonymousCart).not.toHaveBeenCalled();
    await expect(claim(service, { mutationId: 'different' })).rejects.toMatchObject({ code: 'CART_ALREADY_CONVERTED' });
  });
});
