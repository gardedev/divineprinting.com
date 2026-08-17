'use strict';
jest.mock('../productRepository', () => ({ getProductById: jest.fn(), createProductWithId: jest.fn() }));
const manifest = require('../data/product-seed.json');
const { validateSeedProduct, evaluateCartConfiguration } = require('../productService');

const product = manifest.records.find(record => record.slug === 'church-t-shirt');
const configuration = designSource => ({
  schemaVersion: 'custom-design-v1',
  options: { color: 'Black', placement: 'center-chest', designSource },
  designConfiguration: { canvasVersion: 'tshirt-800-v1', templateId: 'cross-modern', templateVersion: 1, designGeometry: { x: 400, y: 240 }, designScale: 1, textElements: [] },
});

describe('approved Custom Church T-Shirt seed record', () => {
  test('is the only reviewed active manifest product and validates exactly', () => {
    expect(manifest.records.filter(record => !record.requiresReview)).toEqual([product]);
    expect(validateSeedProduct(product)).toMatchObject({ productId: 'd204cea4-ce22-4bc5-ad04-530f19fb3878', sku: 'DPT-CHURCH-TSHIRT', status: 'active' });
    expect(product.designTemplates).toHaveLength(16);
    expect(product.variants.map(entry => [entry.size, entry.surchargeCents])).toEqual([['S',0],['M',0],['L',0],['XL',0],['2XL',200],['3XL',300],['4XL',400],['5XL',500]]);
  });

  test('prices template allocations authoritatively using grouped quantity and size surcharge', async () => {
    const result = await evaluateCartConfiguration(product.productId, { customerConfiguration: configuration('TEMPLATE'), variantAllocations: [{ selections: { size: 'M' }, quantity: 10 }, { selections: { size: '2XL' }, quantity: 5 }] }, { repo: { getProductById: jest.fn().mockResolvedValue(product) } });
    expect(result.pricingSnapshot).toMatchObject({ totalQuantity: 15, tier: { baseUnitPriceCents: 1800 }, subtotalCents: 28000 });
  });

  test('keeps CUSTOM_ARTWORK capability fail-closed without a trusted verifier', async () => {
    await expect(evaluateCartConfiguration(product.productId, { customerConfiguration: configuration('CUSTOM_ARTWORK'), variantAllocations: [{ selections: { size: 'M' }, quantity: 1 }] }, { repo: { getProductById: jest.fn().mockResolvedValue(product) } })).rejects.toMatchObject({ code: 'CART_ASSET_REFERENCE_INVALID' });
    expect(product.operationalReadiness.customArtworkOperational).toBe(false);
  });
});
