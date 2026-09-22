'use strict';

/**
 * cartServiceAllowlist.test.js
 * Verifies that cartService.addItem rejects browser-supplied server-authoritative
 * fields in configured-job submissions (baseSku, sku, physicalUnits, pricing,
 * snapshots, availability, sellability).
 */

const { createCartService, CartServiceError } = require('../cartService');

const goodEval = async () => ({
  baseSku: 'SKU',
  customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} },
  variantAllocations: [{ selections: { size: 'A4' }, quantity: 1 }],
  totalQuantity: 1,
  // pricingSnapshot must include tier because cartService reads pricingSnapshot.tier.baseUnitPriceCents
  pricingSnapshot: {
    schemaVersion: 'standard-pricing-v1',
    currency: 'USD',
    productName: 'Test',
    productVersion: 1,
    pricingVersion: 1,
    quantityMode: 'UNIT',
    allocations: [{ selections: { size: 'A4' }, quantity: 1, physicalQuantity: 1, unitPriceCents: 100, lineTotalCents: 100 }],
    subtotalCents: 100,
    calculatedAt: new Date().toISOString(),
    tier: { minimumQuantity: 1, maximumQuantity: null, baseUnitPriceCents: 100 },
  },
  lineTotalCents: 100,
  dedupeVersion: 'standard-configured-v1',
});

function makeCartService(productEval = goodEval) {
  const cartRepository = {
    getMutationReplay: async () => null,
    getCart: async () => ({ cartId: 'cart-1', status: 'active', customerId: 'user-1', version: 1 }),
    listCartItems: async () => [],
    createCartItem: async (args) => args.item,
    updateCartItem: async (args) => args.updates,
    getCartItem: async () => null,
  };
  const productService = {
    evaluateCartConfiguration: productEval,
  };
  return createCartService({ cartRepository, productService });
}

const customerContext = { type: 'customer', sub: 'user-1' };
const cartId = 'cart-1';
const baseConfiguredItem = {
  cartItemType: 'CONFIGURED_JOB',
  productId: 'product-1',
  customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} },
  variantAllocations: [{ selections: { size: 'A4' }, quantity: 1 }],
};

describe('cartService configured-job allowlist', () => {
  test('accepts a clean configured-job submission', async () => {
    const service = makeCartService();
    await expect(service.addItem({
      context: customerContext,
      cartId,
      expectedCartVersion: 1,
      mutationId: 'mut-1',
      item: baseConfiguredItem,
    })).resolves.toBeDefined();
  });

  test.each([
    'baseSku', 'sku', 'physicalUnits', 'price', 'unitPriceCents', 'lineTotalCents',
    'pricingSnapshot', 'availability', 'availableForSale', 'sellable',
    'fulfillment', 'productionMethod', 'productionStatus',
  ])('rejects configured-job with browser-supplied %s field', async (key) => {
    const service = makeCartService();
    const item = { ...baseConfiguredItem, [key]: 'injected' };
    await expect(service.addItem({
      context: customerContext,
      cartId,
      expectedCartVersion: 1,
      mutationId: `mut-${key}`,
      item,
    })).rejects.toMatchObject({ code: 'CART_INVALID_INPUT' });
  });

  test('non-configured-job items are not subject to configured allowlist', async () => {
    // Standard (non-CONFIGURED_JOB) items go through the product path.
    // Supplying price on a non-configured item does not hit the configured allowlist.
    // The call will fail for product-not-found (CART_PRODUCT_UNAVAILABLE), not CART_INVALID_INPUT.
    const serviceWithGetProduct = createCartService({
      cartRepository: {
        getMutationReplay: async () => null,
        getCart: async () => ({ cartId: 'cart-1', status: 'active', customerId: 'user-1', version: 1 }),
        listCartItems: async () => [],
        createCartItem: async (args) => args.item,
        updateCartItem: async (args) => args.updates,
        getCartItem: async () => null,
      },
      productService: {
        getProduct: async () => null, // product not found
        evaluateCartConfiguration: goodEval,
      },
    });
    const item = { productId: 'product-1', quantity: 1, price: 9.99 };
    const err = await serviceWithGetProduct.addItem({
      context: customerContext, cartId, expectedCartVersion: 1, mutationId: 'mut-non-cfg', item,
    }).catch(e => e);
    expect(err).toMatchObject({ name: 'CartServiceError' });
    // Must not be CART_INVALID_INPUT from the configured allowlist
    expect(err.code).not.toBe('CART_INVALID_INPUT');
  });
});
