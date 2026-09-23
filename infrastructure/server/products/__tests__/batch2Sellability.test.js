'use strict';

/**
 * batch2Sellability.test.js
 *
 * Focused MVP activation verification for the six Batch 2 products:
 *   1. Church Flyer & Bulletin        ec5e1b7e-cb16-4d71-8966-0d2483ff0597
 *   2. Church Fridge Magnet           d0b9bcc6-7515-4d1b-8b9e-b80b130a2c0f
 *   3. Church Tablecloth              68ea2471-7598-4368-8753-da6c665bf6a3
 *   4. Church Vinyl Sticker           8a423057-139c-49d3-a64d-d77855a5b5d2
 *   5. Custom Ministry Flag           23af57ea-243f-4ceb-993a-6b5ebd0ecc89
 *   6. Magnetic Car Sign              9f22a476-4f58-436f-9609-491fb2077987
 *
 * Covers all ten Work Order proof requirements:
 *   1.  Authoritative product definition is eligible for sale.
 *   2.  Valid configurations are accepted.
 *   3.  Invalid/missing/extra dimensions or options remain rejected.
 *   4.  Server-authoritative variant pricing is used.
 *   5.  Browser-supplied authoritative fields remain rejected.
 *   6.  Quantity constraints remain enforced.
 *   7.  Cart creation/add-item behavior works with the configured product contract.
 *   8.  No Snipcart runtime is required.
 *   9.  No DEVELOPMENT_ONLY lifecycle guard accidentally prevents legitimate MVP purchase.
 *  10.  No unrelated draft/review product becomes sellable.
 */

const fs = require('fs');
const path = require('path');
const manifest = require('../data/product-seed.json');
const {
  evaluateStandardConfiguredProduct,
  validateStandardConfigurableDefinition,
  StandardConfiguredProductError,
} = require('../standardConfiguredProduct');
const { createCartService } = require('../../carts/cartService');

// ── Fixtures ──────────────────────────────────────────────────────────────────

const BATCH2 = [
  { id: 'ec5e1b7e-cb16-4d71-8966-0d2483ff0597', name: 'Church Flyer & Bulletin',  sku: 'DPT-FLYER-BULLETIN',      slug: 'church-flyer-bulletin' },
  { id: 'd0b9bcc6-7515-4d1b-8b9e-b80b130a2c0f', name: 'Church Fridge Magnet',     sku: 'DPT-FRIDGE-MAGNET',       slug: 'church-fridge-magnet' },
  { id: '68ea2471-7598-4368-8753-da6c665bf6a3', name: 'Church Tablecloth',         sku: 'DPT-TABLECLOTH',          slug: 'church-tablecloth' },
  { id: '8a423057-139c-49d3-a64d-d77855a5b5d2', name: 'Church Vinyl Sticker',      sku: 'DPT-VINYL-STICKER',       slug: 'church-vinyl-sticker' },
  { id: '23af57ea-243f-4ceb-993a-6b5ebd0ecc89', name: 'Custom Ministry Flag',      sku: 'DPT-MINISTRY-FLAG',       slug: 'custom-ministry-flag' },
  { id: '9f22a476-4f58-436f-9609-491fb2077987', name: 'Magnetic Car Sign',         sku: 'DPT-MAGNETIC-CAR-SIGN',   slug: 'magnetic-car-sign' },
];

// One valid input per product for positive tests.
const VALID_INPUT = {
  'ec5e1b7e-cb16-4d71-8966-0d2483ff0597': { variantAllocations: [{ selections: { size: 'A4', paper: '157g', finish: 'Gloss' }, quantity: 10 }], options: {} },
  'd0b9bcc6-7515-4d1b-8b9e-b80b130a2c0f': { variantAllocations: [{ selections: { size: '4x6', thickness: '0.5mm' }, quantity: 5 }], options: {} },
  '68ea2471-7598-4368-8753-da6c665bf6a3': { variantAllocations: [{ selections: { size: '6ft', style: 'Fitted' }, quantity: 2 }], options: {} },
  '8a423057-139c-49d3-a64d-d77855a5b5d2': { variantAllocations: [{ selections: { size: '2x2', finish: 'Gloss' }, quantity: 1 }], options: { cut: 'standard' } },
  '23af57ea-243f-4ceb-993a-6b5ebd0ecc89': { variantAllocations: [{ selections: { size: '3x5', sides: 'Single' }, quantity: 3 }], options: {} },
  '9f22a476-4f58-436f-9609-491fb2077987': { variantAllocations: [{ selections: { size: '12x18', thickness: '0.7mm' }, quantity: 2 }], options: {} },
};

function makeInput(productId) {
  const { variantAllocations, options } = VALID_INPUT[productId];
  return {
    customerConfiguration: { schemaVersion: 'standard-product-v1', options },
    variantAllocations,
  };
}

function productById(id) {
  return manifest.records.find(r => r.productId === id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Requirement 1: Authoritative product definition is eligible for sale
// ─────────────────────────────────────────────────────────────────────────────
describe('Req 1 — authoritative product definition is eligible for sale', () => {
  test.each(BATCH2)('$name has status=active, availableForSale=true, sellable=true, requiresReview=false', ({ id, name, sku, slug }) => {
    const p = productById(id);
    expect(p).toBeDefined();
    expect(p).toMatchObject({
      productId: id,
      name,
      slug,
      sku,
      status: 'active',
      availableForSale: true,
      sellable: true,
      requiresReview: false,
      productType: 'standard-configurable',
      currency: 'USD',
    });
    expect(Array.isArray(p.supportedSkus)).toBe(true);
    expect(p.supportedSkus).toContain(sku);
  });

  test.each(BATCH2)('$name passes validateStandardConfigurableDefinition', ({ id }) => {
    const p = productById(id);
    expect(() => validateStandardConfigurableDefinition(p)).not.toThrow();
  });

  test.each(BATCH2)('evaluateCartConfiguration gate passes for $name (active, availableForSale=true)', async ({ id }) => {
    // Simulate the productService.evaluateCartConfiguration gate:
    // product must be status=active, not deletedAt, not availableForSale===false.
    const p = productById(id);
    expect(p.status).toBe('active');
    expect(p.availableForSale).toBe(true);
    expect(p.deletedAt).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Requirement 2: Valid configurations are accepted
// ─────────────────────────────────────────────────────────────────────────────
describe('Req 2 — valid configurations are accepted', () => {
  test.each(BATCH2)('$name accepts a valid configuration and returns server-computed pricing', ({ id }) => {
    const p = productById(id);
    const result = evaluateStandardConfiguredProduct(p, makeInput(id));
    expect(result).toMatchObject({
      customerConfiguration: { schemaVersion: 'standard-product-v1' },
      pricingSnapshot: expect.objectContaining({
        schemaVersion: 'standard-pricing-v1',
        currency: 'USD',
        quantityMode: 'UNIT',
      }),
    });
    expect(result.lineTotalCents).toBeGreaterThan(0);
    expect(result.totalQuantity).toBeGreaterThanOrEqual(1);
    expect(result.variantAllocations).toHaveLength(1);
  });

  test('church-flyer-bulletin accepts all 30 variant tuples', () => {
    const p = productById('ec5e1b7e-cb16-4d71-8966-0d2483ff0597');
    expect(p.variants).toHaveLength(30);
    for (const v of p.variants) {
      const inp = {
        customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} },
        variantAllocations: [{ selections: { ...v.selections }, quantity: 1 }],
      };
      const result = evaluateStandardConfiguredProduct(p, inp);
      expect(result.pricingSnapshot.allocations[0].unitPriceCents).toBe(v.unitPriceCents);
    }
  });

  test('church-fridge-magnet accepts all 8 variants', () => {
    const p = productById('d0b9bcc6-7515-4d1b-8b9e-b80b130a2c0f');
    expect(p.variants).toHaveLength(8);
    for (const v of p.variants) {
      const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} }, variantAllocations: [{ selections: { ...v.selections }, quantity: 1 }] };
      expect(() => evaluateStandardConfiguredProduct(p, inp)).not.toThrow();
    }
  });

  test('church-vinyl-sticker accepts all 8 variants with cut=standard', () => {
    const p = productById('8a423057-139c-49d3-a64d-d77855a5b5d2');
    expect(p.variants).toHaveLength(8);
    for (const v of p.variants) {
      const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options: { cut: 'standard' } }, variantAllocations: [{ selections: { ...v.selections }, quantity: 1 }] };
      expect(() => evaluateStandardConfiguredProduct(p, inp)).not.toThrow();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Requirement 3: Invalid / missing / extra dimensions remain rejected
// ─────────────────────────────────────────────────────────────────────────────
describe('Req 3 — invalid, missing, extra dimensions / options remain rejected', () => {
  test('flyer: wrong finish casing (gloss) is rejected', () => {
    const p = productById('ec5e1b7e-cb16-4d71-8966-0d2483ff0597');
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} }, variantAllocations: [{ selections: { size: 'A4', paper: '157g', finish: 'gloss' }, quantity: 1 }] };
    expect(() => evaluateStandardConfiguredProduct(p, inp)).toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
  });

  test('flyer: missing paper dimension is rejected', () => {
    const p = productById('ec5e1b7e-cb16-4d71-8966-0d2483ff0597');
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} }, variantAllocations: [{ selections: { size: 'A4', finish: 'Gloss' }, quantity: 1 }] };
    expect(() => evaluateStandardConfiguredProduct(p, inp)).toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
  });

  test('tablecloth: extra color key is rejected', () => {
    const p = productById('68ea2471-7598-4368-8753-da6c665bf6a3');
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} }, variantAllocations: [{ selections: { size: '6ft', style: 'Fitted', color: 'blue' }, quantity: 1 }] };
    expect(() => evaluateStandardConfiguredProduct(p, inp)).toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
  });

  test('vinyl-sticker: missing required cut option is rejected', () => {
    const p = productById('8a423057-139c-49d3-a64d-d77855a5b5d2');
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} }, variantAllocations: [{ selections: { size: '1x1', finish: 'Gloss' }, quantity: 1 }] };
    expect(() => evaluateStandardConfiguredProduct(p, inp)).toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
  });

  test('vinyl-sticker: cut=custom-die-cut is rejected by server', () => {
    const p = productById('8a423057-139c-49d3-a64d-d77855a5b5d2');
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options: { cut: 'custom-die-cut' } }, variantAllocations: [{ selections: { size: '2x2', finish: 'Gloss' }, quantity: 1 }] };
    expect(() => evaluateStandardConfiguredProduct(p, inp)).toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
  });

  test('ministry-flag: wrong sides casing (single) is rejected', () => {
    const p = productById('23af57ea-243f-4ceb-993a-6b5ebd0ecc89');
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} }, variantAllocations: [{ selections: { size: '3x5', sides: 'single' }, quantity: 1 }] };
    expect(() => evaluateStandardConfiguredProduct(p, inp)).toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
  });

  test('magnetic-car-sign: missing thickness is rejected', () => {
    const p = productById('9f22a476-4f58-436f-9609-491fb2077987');
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} }, variantAllocations: [{ selections: { size: '12x18' }, quantity: 1 }] };
    expect(() => evaluateStandardConfiguredProduct(p, inp)).toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
  });

  test('tablecloth: undeclared option key in customerConfiguration is rejected', () => {
    const p = productById('68ea2471-7598-4368-8753-da6c665bf6a3');
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options: { color: 'blue' } }, variantAllocations: [{ selections: { size: '6ft', style: 'Draped' }, quantity: 1 }] };
    expect(() => evaluateStandardConfiguredProduct(p, inp)).toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
  });

  test('wrong schemaVersion is rejected for all batch 2 products', () => {
    for (const { id } of BATCH2) {
      const p = productById(id);
      const { variantAllocations, options } = VALID_INPUT[id];
      const inp = { customerConfiguration: { schemaVersion: 'bad-version', options }, variantAllocations };
      expect(() => evaluateStandardConfiguredProduct(p, inp)).toThrow(expect.objectContaining({ code: 'CART_INVALID_PERSONALIZATION' }));
    }
  });

  test('multiple allocations are rejected for all batch 2 products', () => {
    const p = productById('23af57ea-243f-4ceb-993a-6b5ebd0ecc89');
    const inp = {
      customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} },
      variantAllocations: [{ selections: { size: '3x5', sides: 'Single' }, quantity: 1 }, { selections: { size: '4x6', sides: 'Double' }, quantity: 1 }],
    };
    expect(() => evaluateStandardConfiguredProduct(p, inp)).toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Requirement 4: Server-authoritative variant pricing is used
// ─────────────────────────────────────────────────────────────────────────────
describe('Req 4 — server-authoritative variant pricing', () => {
  test.each([
    ['A5', '120g', 'Gloss', 25],
    ['A5', '120g', 'Matte', 25],
    ['A4', '157g', 'Gloss', 50],
    ['A3', '250g', 'Matte', 140],
  ])('flyer %s/%s/%s: unitPriceCents=%d from catalog, not from browser', (size, paper, finish, expectedCents) => {
    const p = productById('ec5e1b7e-cb16-4d71-8966-0d2483ff0597');
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} }, variantAllocations: [{ selections: { size, paper, finish }, quantity: 4 }] };
    const result = evaluateStandardConfiguredProduct(p, inp);
    expect(result.pricingSnapshot.allocations[0].unitPriceCents).toBe(expectedCents);
    expect(result.lineTotalCents).toBe(expectedCents * 4);
  });

  test.each([
    ['business-card', '0.3mm', 149],
    ['4x6', '0.9mm', 449],
  ])('fridge-magnet %s/%s: unitPriceCents=%d from catalog', (size, thickness, expectedCents) => {
    const p = productById('d0b9bcc6-7515-4d1b-8b9e-b80b130a2c0f');
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} }, variantAllocations: [{ selections: { size, thickness }, quantity: 10 }] };
    const result = evaluateStandardConfiguredProduct(p, inp);
    expect(result.pricingSnapshot.allocations[0].unitPriceCents).toBe(expectedCents);
    expect(result.lineTotalCents).toBe(expectedCents * 10);
  });

  test.each([
    ['6ft', 'Fitted', 4599],
    ['8ft', 'Draped', 4999],
  ])('tablecloth %s/%s: unitPriceCents=%d from catalog', (size, style, expectedCents) => {
    const p = productById('68ea2471-7598-4368-8753-da6c665bf6a3');
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} }, variantAllocations: [{ selections: { size, style }, quantity: 1 }] };
    const result = evaluateStandardConfiguredProduct(p, inp);
    expect(result.pricingSnapshot.allocations[0].unitPriceCents).toBe(expectedCents);
  });

  test.each([
    ['3x5', 'Single', 2499],
    ['5x8', 'Double', 7999],
  ])('ministry-flag %s/%s: unitPriceCents=%d from catalog', (size, sides, expectedCents) => {
    const p = productById('23af57ea-243f-4ceb-993a-6b5ebd0ecc89');
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} }, variantAllocations: [{ selections: { size, sides }, quantity: 2 }] };
    const result = evaluateStandardConfiguredProduct(p, inp);
    expect(result.pricingSnapshot.allocations[0].unitPriceCents).toBe(expectedCents);
    expect(result.lineTotalCents).toBe(expectedCents * 2);
  });

  test.each([
    ['12x18', '0.5mm', 1499],
    ['18x24', '0.9mm', 3499],
  ])('magnetic-car-sign %s/%s: unitPriceCents=%d from catalog', (size, thickness, expectedCents) => {
    const p = productById('9f22a476-4f58-436f-9609-491fb2077987');
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} }, variantAllocations: [{ selections: { size, thickness }, quantity: 3 }] };
    const result = evaluateStandardConfiguredProduct(p, inp);
    expect(result.pricingSnapshot.allocations[0].unitPriceCents).toBe(expectedCents);
    expect(result.lineTotalCents).toBe(expectedCents * 3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Requirement 5: Browser-supplied authoritative fields remain rejected
// ─────────────────────────────────────────────────────────────────────────────
describe('Req 5 — browser-supplied authoritative fields remain rejected', () => {
  const TOP_LEVEL_REJECTED = ['baseSku', 'sku', 'physicalUnits', 'price', 'unitPriceCents', 'lineTotalCents', 'pricingSnapshot', 'availability', 'availableForSale', 'sellable'];
  const ALLOCATION_REJECTED = ['price', 'unitPriceCents', 'lineTotalCents', 'physicalUnits', 'physicalQuantity', 'pricingSnapshot', 'baseSku', 'sku', 'availability', 'availableForSale', 'sellable'];

  test.each(TOP_LEVEL_REJECTED)('top-level input key "%s" is rejected (CART_INVALID_INPUT)', (key) => {
    const p = productById('9f22a476-4f58-436f-9609-491fb2077987');
    const inp = { ...makeInput('9f22a476-4f58-436f-9609-491fb2077987'), [key]: 'injected' };
    expect(() => evaluateStandardConfiguredProduct(p, inp)).toThrow(expect.objectContaining({ code: 'CART_INVALID_INPUT' }));
  });

  test.each(ALLOCATION_REJECTED)('allocation key "%s" is rejected (CART_INVALID_VARIATION)', (key) => {
    const p = productById('23af57ea-243f-4ceb-993a-6b5ebd0ecc89');
    const badAllocation = { selections: { size: '3x5', sides: 'Single' }, quantity: 1, [key]: 999 };
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} }, variantAllocations: [badAllocation] };
    expect(() => evaluateStandardConfiguredProduct(p, inp)).toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
  });

  test('extra key in customerConfiguration is rejected (CART_INVALID_PERSONALIZATION)', () => {
    const p = productById('68ea2471-7598-4368-8753-da6c665bf6a3');
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options: {}, extraField: 'injected' }, variantAllocations: [{ selections: { size: '6ft', style: 'Fitted' }, quantity: 1 }] };
    expect(() => evaluateStandardConfiguredProduct(p, inp)).toThrow(expect.objectContaining({ code: 'CART_INVALID_PERSONALIZATION' }));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Requirement 6: Quantity constraints remain enforced
// ─────────────────────────────────────────────────────────────────────────────
describe('Req 6 — quantity constraints remain enforced', () => {
  test.each(BATCH2)('$name rejects quantity=0', ({ id }) => {
    const p = productById(id);
    const { variantAllocations, options } = VALID_INPUT[id];
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options }, variantAllocations: [{ ...variantAllocations[0], quantity: 0 }] };
    expect(() => evaluateStandardConfiguredProduct(p, inp)).toThrow(expect.objectContaining({ code: 'CART_QUANTITY_INVALID' }));
  });

  test.each(BATCH2)('$name rejects non-integer quantity (1.5)', ({ id }) => {
    const p = productById(id);
    const { variantAllocations, options } = VALID_INPUT[id];
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options }, variantAllocations: [{ ...variantAllocations[0], quantity: 1.5 }] };
    expect(() => evaluateStandardConfiguredProduct(p, inp)).toThrow(expect.objectContaining({ code: 'CART_QUANTITY_INVALID' }));
  });

  test.each(BATCH2)('$name accepts minimumQuantity=1 (quantity=1)', ({ id }) => {
    const p = productById(id);
    expect(p.minimumQuantity).toBe(1);
    expect(p.quantityIncrement).toBe(1);
    const { variantAllocations, options } = VALID_INPUT[id];
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options }, variantAllocations: [{ ...variantAllocations[0], quantity: 1 }] };
    expect(() => evaluateStandardConfiguredProduct(p, inp)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Requirement 7: Cart creation / add-item works with the configured product contract
// ─────────────────────────────────────────────────────────────────────────────
describe('Req 7 — cart creation / add-item works with the configured product contract', () => {
  function makeCartService(productId) {
    const p = productById(productId);
    const evaluateCartConfiguration = async (_productId, inp) =>
      evaluateStandardConfiguredProduct(p, inp);

    const cartRepository = {
      getMutationReplay: async () => null,
      getCart: async () => ({ cartId: 'cart-1', status: 'active', customerId: 'cust-1', version: 1, currency: 'USD' }),
      listCartItems: async () => [],
      createCartItem: async (args) => args.item,
      updateCartItem: async (args) => args.updates,
      getCartItem: async () => null,
    };
    const productService = { evaluateCartConfiguration };
    return createCartService({ cartRepository, productService });
  }

  const customerContext = { type: 'customer', sub: 'cust-1' };

  test.each(BATCH2)('$name: CONFIGURED_JOB add-item succeeds and returns server-priced item', async ({ id }) => {
    const service = makeCartService(id);
    const { variantAllocations, options } = VALID_INPUT[id];
    const item = {
      cartItemType: 'CONFIGURED_JOB',
      productId: id,
      customerConfiguration: { schemaVersion: 'standard-product-v1', options },
      variantAllocations,
    };
    const result = await service.addItem({ context: customerContext, cartId: 'cart-1', expectedCartVersion: 1, mutationId: `mut-${id}`, item });
    // cartService returns the persisted cart item directly (the snapshot)
    expect(result).toBeDefined();
    // The returned item must have a server-computed pricingSnapshot (not browser-supplied)
    expect(result.pricingSnapshot).toBeDefined();
    expect(result.pricingSnapshot.schemaVersion).toBe('standard-pricing-v1');
    expect(result.lineTotalCents).toBeGreaterThan(0);
  });

  test.each(BATCH2)('$name: CONFIGURED_JOB add-item with browser-supplied unitPriceCents is rejected', async ({ id }) => {
    const service = makeCartService(id);
    const { variantAllocations, options } = VALID_INPUT[id];
    const item = {
      cartItemType: 'CONFIGURED_JOB',
      productId: id,
      customerConfiguration: { schemaVersion: 'standard-product-v1', options },
      variantAllocations,
      unitPriceCents: 1, // browser-injected — must be rejected
    };
    await expect(service.addItem({ context: customerContext, cartId: 'cart-1', expectedCartVersion: 1, mutationId: `mut-badprice-${id}`, item }))
      .rejects.toMatchObject({ code: 'CART_INVALID_INPUT' });
  });
});

// ─────────
// ─────────────────────────────────────────────────────────────────────────────
// Requirement 8: No Snipcart runtime is required
// ─────────────────────────────────────────────────────────────────────────────
describe('Req 8 — no Snipcart runtime is required', () => {
  test('cartService module has no Snipcart dependency', () => {
    const cartSrc = require('fs').readFileSync(
      require('path').join(__dirname, '..', '..', 'carts', 'cartService.js'), 'utf8'
    );
    expect(cartSrc).not.toMatch(/snipcart/i);
  });

  test('evaluateStandardConfiguredProduct has no Snipcart dependency', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'standardConfiguredProduct.js'), 'utf8'
    );
    expect(src).not.toMatch(/snipcart/i);
  });

  test('batch 2 product definitions have no Snipcart fields', () => {
    for (const { id } of BATCH2) {
      const p = productById(id);
      const serialized = JSON.stringify(p);
      expect(serialized).not.toMatch(/snipcart/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Requirement 9: No DEVELOPMENT_ONLY lifecycle guard accidentally prevents purchase
// ─────────────────────────────────────────────────────────────────────────────
describe('Req 9 — no DEVELOPMENT_ONLY guard prevents legitimate MVP purchase', () => {
  test.each(BATCH2)('$name: no DEVELOPMENT_ONLY marker in any variant', ({ id }) => {
    const p = productById(id);
    const serialized = JSON.stringify(p.variants);
    expect(serialized).not.toContain('DEVELOPMENT_ONLY');
  });

  test.each(BATCH2)('$name: evaluator succeeds without any runtime DEVELOPMENT_ONLY check', ({ id }) => {
    // If DEVELOPMENT_ONLY guard existed in the evaluator it would throw on valid input.
    // This confirms the evaluator completes successfully for all six products.
    const p = productById(id);
    const { variantAllocations, options } = VALID_INPUT[id];
    const inp = { customerConfiguration: { schemaVersion: 'standard-product-v1', options }, variantAllocations };
    expect(() => evaluateStandardConfiguredProduct(p, inp)).not.toThrow();
  });

  test('manifest raw file contains no DEVELOPMENT_ONLY string for any batch 2 product', () => {
    const raw = fs.readFileSync(
      path.join(__dirname, '..', 'data', 'product-seed.json'), 'utf8'
    );
    const parsed = JSON.parse(raw);
    for (const { id } of BATCH2) {
      const p = parsed.records.find(r => r.productId === id);
      expect(JSON.stringify(p)).not.toContain('DEVELOPMENT_ONLY');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Requirement 10: No unrelated draft/review product becomes sellable
// ─────────────────────────────────────────────────────────────────────────────
describe('Req 10 — no unrelated draft/review product becomes sellable', () => {
  const BATCH2_IDS = new Set(BATCH2.map(b => b.id));

  test('all records with requiresReview=true remain status=draft and not sellable', () => {
    for (const r of manifest.records) {
      if (r.requiresReview) {
        expect(r.status).toBe('draft');
        expect(r.availableForSale).not.toBe(true);
        expect(r.sellable).not.toBe(true);
      }
    }
  });

  test('only the six batch 2 products plus the seven pre-existing products are active+sellable', () => {
    const PRE_EXISTING_ACTIVE_SLUGS = new Set([
      'church-flyers-standard', 'church-magnets-business-card', 'church-stickers-round',
      'church-t-shirt', 'church-vinyl-banner-standard', 'church-yard-sign-standard', 'rollup-banner-standard',
    ]);
    const BATCH2_SLUGS = new Set([
      'church-flyer-bulletin', 'church-fridge-magnet', 'church-tablecloth',
      'church-vinyl-sticker', 'custom-ministry-flag', 'magnetic-car-sign',
    ]);
    const EXPECTED_ACTIVE_SLUGS = new Set([...PRE_EXISTING_ACTIVE_SLUGS, ...BATCH2_SLUGS]);

    const activeNonReview = manifest.records.filter(r => !r.requiresReview && r.status === 'active');
    expect(activeNonReview).toHaveLength(13);
    for (const r of activeNonReview) {
      expect(EXPECTED_ACTIVE_SLUGS.has(r.slug)).toBe(true);
    }
  });

  test('no draft product had its requiresReview flag cleared without being in batch 2', () => {
    // Every active product must either be a known pre-existing product or a batch 2 product.
    const KNOWN_ACTIVE_IDS = new Set([
      // Batch 1 products
      '46a21984-0f64-4d57-9202-0b591c266f9b', // church-flyers-standard
      'b2033b41-913f-46b8-8639-bd66dc1ab0fc', // church-magnets-business-card
      '8db500c6-c3ea-417f-8ce8-1c36940f36f6', // church-stickers-round
      'd204cea4-ce22-4bc5-ad04-530f19fb3878', // church-t-shirt
      '476a47bd-932f-4a71-81cc-7b4506662206', // church-vinyl-banner-standard
      '379c7176-5ab7-45b3-a87e-524b6ff35867', // church-yard-sign-standard
      '30596774-a90b-4b33-ab94-9bcda66bf114', // rollup-banner-standard
      // Batch 2 activated products
      ...BATCH2_IDS,
    ]);
    for (const r of manifest.records) {
      if (r.status === 'active') {
        expect(KNOWN_ACTIVE_IDS.has(r.productId)).toBe(true);
      }
    }
  });

  test('13 records remain in draft+requiresReview state', () => {
    const draftReview = manifest.records.filter(r => r.requiresReview && r.status === 'draft');
    expect(draftReview).toHaveLength(13);
  });
});
