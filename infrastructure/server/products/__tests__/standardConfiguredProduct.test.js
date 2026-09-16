'use strict';

const manifest = require('../data/product-seed.json');
const { evaluateStandardConfiguredProduct } = require('../standardConfiguredProduct');

const expected = {
  'Church Flyers - Standard 8.5x11': ['46a21984-0f64-4d57-9202-0b591c266f9b', 'DPT-CHURCH-FLYER-STD-8511'],
  'Church Magnets - Business Card Size': ['b2033b41-913f-46b8-8639-bd66dc1ab0fc', 'DPT-CHURCH-MAGNET-BUSCARD'],
  'Church Stickers - Round': ['8db500c6-c3ea-417f-8ce8-1c36940f36f6', 'DPT-CHURCH-STICKER-ROUND'],
  'Church Vinyl Banner - Standard Sizes': ['476a47bd-932f-4a71-81cc-7b4506662206', 'DPT-CHURCH-VINYL-BANNER-STD'],
  'Church Yard Sign - 18x24 Standard': ['379c7176-5ab7-45b3-a87e-524b6ff35867', 'DPT-CHURCH-YARD-SIGN-1824'],
  'Retractable Banner - Standard': ['30596774-a90b-4b33-ab94-9bcda66bf114', 'DPT-RETRACTABLE-BANNER-STD'],
};

const product = name => manifest.records.find(record => record.name === name);
const input = (dimension, value, quantity, extra = {}) => ({
  customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} },
  variantAllocations: [{ selections: { [dimension]: value }, quantity }],
  ...extra,
});

describe('Batch 1 standard configured catalog evaluator', () => {
  test('contains exactly the approved active standard products with permanent IDs and SKUs', () => {
    const active = manifest.records.filter(record => record.status === 'active' && record.productType === 'standard-configurable');
    expect(active).toHaveLength(6);
    for (const [name, [productId, sku]] of Object.entries(expected)) {
      expect(product(name)).toMatchObject({ productId, sku, status: 'active', availableForSale: true, requiresReview: false, productType: 'standard-configurable' });
    }
  });

  test.each([
    ['100', 100, 1500], ['250', 250, 3000], ['500', 500, 5000], ['1000', 1000, 8000],
  ])('prices flyer package %s only from its catalog record', (selection, physicalQuantity, total) => {
    const result = evaluateStandardConfiguredProduct(product('Church Flyers - Standard 8.5x11'), input('package', selection, 1, { price: 1, lineTotalCents: 1 }));
    expect(result).toMatchObject({ totalQuantity: physicalQuantity, lineTotalCents: total, pricingSnapshot: { subtotalCents: total, quantityMode: 'DISCRETE_SELECTION' } });
  });

  test.each([
    ['single', 3, 3, 447], ['25-pack', 2, 50, 5998], ['50-pack', 2, 100, 9998], ['100-pack', 2, 200, 15998],
  ])('prices magnets package %s with separate pack count', (selection, packs, physicalQuantity, total) => {
    const result = evaluateStandardConfiguredProduct(product('Church Magnets - Business Card Size'), input('package', selection, packs));
    expect(result).toMatchObject({ totalQuantity: physicalQuantity, lineTotalCents: total, pricingSnapshot: { allocations: [expect.objectContaining({ physicalQuantity, quantity: packs, lineTotalCents: total })] } });
  });

  test.each([
    ['2-inch', 50, 1250], ['3-inch', 100, 3500],
  ])('prices sticker variants by physical quantity', (selection, quantity, total) => {
    const result = evaluateStandardConfiguredProduct(product('Church Stickers - Round'), input('size', selection, quantity, { unitPriceCents: 1 }));
    expect(result).toMatchObject({ totalQuantity: quantity, lineTotalCents: total });
  });

  test.each([
    ['2x4-ft', 2, 5998], ['3x6-ft', 1, 4599], ['4x8-ft', 3, 20997],
  ])('prices vinyl banner variant %s', (selection, quantity, total) => {
    expect(evaluateStandardConfiguredProduct(product('Church Vinyl Banner - Standard Sizes'), input('size', selection, quantity))).toMatchObject({ totalQuantity: quantity, lineTotalCents: total });
  });

  test.each([
    ['single', 3, 3, 3897], ['5-pack', 2, 10, 9998], ['10-pack', 2, 20, 17998],
  ])('prices yard-sign package %s with pack count', (selection, packs, physicalQuantity, total) => {
    expect(evaluateStandardConfiguredProduct(product('Church Yard Sign - 18x24 Standard'), input('package', selection, packs))).toMatchObject({ totalQuantity: physicalQuantity, lineTotalCents: total });
  });

  test('prices the fixed rollup banner as a physical unit', () => {
    expect(evaluateStandardConfiguredProduct(product('Retractable Banner - Standard'), input('size', '33x80-in', 2))).toMatchObject({ totalQuantity: 2, lineTotalCents: 13998 });
  });

  test.each([
    ['Church Magnets - Business Card Size', 'package', '25 Pack', 1, 'CART_INVALID_VARIATION'],
    ['Church Yard Sign - 18x24 Standard', 'package', '5 Pack', 1, 'CART_INVALID_VARIATION'],
    ['Church Stickers - Round', 'size', '2 inch', 50, 'CART_INVALID_VARIATION'],
    ['Church Stickers - Round', 'size', '2-inch', 49, 'CART_QUANTITY_INVALID'],
    ['Church Stickers - Round', 'size', '2-inch', 51, 'CART_QUANTITY_INVALID'],
    ['Church Flyers - Standard 8.5x11', 'package', '100', 2, 'CART_QUANTITY_INVALID'],
  ])('strictly rejects noncanonical selection or invalid quantity', (name, dimension, selection, quantity, code) => {
    expect(() => evaluateStandardConfiguredProduct(product(name), input(dimension, selection, quantity))).toThrow(expect.objectContaining({ code }));
  });
});
