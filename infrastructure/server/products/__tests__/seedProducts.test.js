'use strict';

jest.mock('../productService', () => ({}));

const fs = require('fs');
const path = require('path');
const { seedProducts, DEFAULT_MANIFEST } = require('../seedProducts');

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ID = '22222222-2222-4222-8222-222222222222';
const valid = {
  productId: ID, name: 'Reviewed Product', slug: 'reviewed-product', sku: 'SKU-1',
  supportedSkus: ['SKU-1'], basePrice: 1299, currency: 'USD', status: 'active',
  image: '/images/product.jpg', options: [{ name: 'size', values: ['L'] }], variants: [],
  version: 1, pricingVersion: 1, sourcePage: 'products/reviewed.html', requiresReview: false,
};

function service(overrides = {}) {
  return {
    validateSeedProduct: jest.fn((record) => record),
    getProduct: jest.fn().mockResolvedValue(null),
    getProductBySlug: jest.fn().mockResolvedValue(null),
    createSeedProduct: jest.fn().mockImplementation(async (record) => record),
    ...overrides,
  };
}

describe('seedProducts', () => {
  test('manifest contains all 26 static products with permanent unique IDs and source pages', () => {
    const manifest = JSON.parse(fs.readFileSync(DEFAULT_MANIFEST, 'utf8'));
    expect(manifest.records).toHaveLength(26);
    expect(new Set(manifest.records.map((record) => record.productId))).toHaveProperty('size', 26);
    expect(new Set(manifest.records.map((record) => record.slug))).toHaveProperty('size', 26);
    expect(manifest.records.every((record) => record.sourcePage.startsWith('products/'))).toBe(true);
    expect(manifest.records.filter((record) => record.requiresReview && record.status === 'draft')).toHaveLength(19);
    expect(manifest.records.filter((record) => !record.requiresReview && record.status === 'active').map((record) => record.slug).sort()).toEqual(['church-flyers-standard','church-magnets-business-card','church-stickers-round','church-t-shirt','church-vinyl-banner-standard','church-yard-sign-standard','rollup-banner-standard']);
  });

  test('imports a valid reviewed record through ProductService and preserves its stable ID', async () => {
    const productService = service();
    const summary = await seedProducts({ manifest: { records: [valid] }, productService });
    expect(summary.CREATED).toEqual([ID]);
    expect(productService.createSeedProduct).toHaveBeenCalledWith(expect.objectContaining({ productId: ID, supportedSkus: ['SKU-1'], options: valid.options, variants: [] }));
  });

  test.each([
    [{ ...valid, name: '' }, 'name'],
    [{ ...valid, basePrice: -1 }, 'basePrice'],
    [{ ...valid, basePrice: 12.5 }, 'basePrice'],
    [{ ...valid, currency: 'EUR' }, 'currency'],
  ])('reports invalid contract data without writing', async (record, reason) => {
    const productService = service({ validateSeedProduct: jest.fn(() => { throw new Error(`${reason} invalid`); }) });
    const summary = await seedProducts({ manifest: { records: [record] }, productService });
    expect(summary.INVALID).toHaveLength(1); expect(summary.CREATED).toHaveLength(0); expect(productService.createSeedProduct).not.toHaveBeenCalled();
  });

  test('detects duplicate manifest product IDs and slugs', async () => {
    const productService = service();
    const duplicateId = { ...valid, slug: 'other' };
    const duplicateSlug = { ...valid, productId: OTHER_ID };
    const summary = await seedProducts({ manifest: { records: [valid, duplicateId, duplicateSlug] }, productService });
    expect(summary.INVALID.map((entry) => entry.reason)).toEqual(expect.arrayContaining(['duplicate productId in manifest', 'duplicate slug in manifest']));
    expect(productService.createSeedProduct).not.toHaveBeenCalled();
  });

  test('skips inactive review-required and starting-at records without validation or writes', async () => {
    const productService = service();
    const record = { ...valid, status: 'draft', basePrice: null, requiresReview: true, reviewNotes: ['Starting at price is not authoritative.'] };
    const summary = await seedProducts({ manifest: { records: [record] }, productService });
    expect(summary.REQUIRES_REVIEW).toEqual([{ productId: ID, sourcePage: valid.sourcePage }]);
    expect(productService.validateSeedProduct).not.toHaveBeenCalled(); expect(productService.createSeedProduct).not.toHaveBeenCalled();
  });

  test('treats an identical existing product as unchanged on rerun', async () => {
    const productService = service({ getProduct: jest.fn().mockResolvedValue(valid), getProductBySlug: jest.fn().mockResolvedValue(valid) });
    const summary = await seedProducts({ manifest: { records: [valid] }, productService });
    expect(summary.UNCHANGED).toEqual([ID]); expect(productService.createSeedProduct).not.toHaveBeenCalled();
  });

  test('reports conflicting records by ID without overwrite', async () => {
    const productService = service({ getProduct: jest.fn().mockResolvedValue({ ...valid, basePrice: 999 }), getProductBySlug: jest.fn().mockResolvedValue({ ...valid, basePrice: 999 }) });
    const summary = await seedProducts({ manifest: { records: [valid] }, productService });
    expect(summary.CONFLICTING).toHaveLength(1); expect(productService.createSeedProduct).not.toHaveBeenCalled();
  });

  test('reports conflicting records by slug owned by another product', async () => {
    const productService = service({ getProductBySlug: jest.fn().mockResolvedValue({ ...valid, productId: OTHER_ID }) });
    const summary = await seedProducts({ manifest: { records: [valid] }, productService });
    expect(summary.CONFLICTING[0].reason).toBe('slug belongs to another product');
  });

  test('dry-run validates and reports would-create with zero writes', async () => {
    const productService = service();
    const summary = await seedProducts({ manifest: { records: [valid] }, productService, dryRun: true });
    expect(summary.WOULD_CREATE).toEqual([ID]); expect(summary.CREATED).toEqual([]); expect(productService.createSeedProduct).not.toHaveBeenCalled();
  });

  test('reports conditional-create collisions safely in the explicit summary', async () => {
    const error = Object.assign(new Error('collision'), { name: 'ConditionalCheckFailedException' });
    const productService = service({ createSeedProduct: jest.fn().mockRejectedValue(error) });
    const summary = await seedProducts({ manifest: { records: [valid] }, productService });
    expect(summary.CONFLICTING).toEqual([{ productId: ID, reason: 'conditional create collision' }]);
  });

  test('has no runtime scraper, network, or vendor dependency', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'seedProducts.js'), 'utf8');
    expect(source).not.toMatch(/fetch\s*\(|https?:\/\/|vendor|supplier/i);
  });
});

test('managed comparison includes configurable-product pricing and schema fields', () => {
  const { sameManagedRecord } = require('../seedProducts');
  const base = { productId: 'p', quantityPricing: { tiers: [{ minimumQuantity: 1, baseUnitPriceCents: 2500 }] }, designSnapshot: { schemaVersion: 'v1' } };
  expect(sameManagedRecord(base, { ...base, quantityPricing: { tiers: [{ minimumQuantity: 1, baseUnitPriceCents: 1500 }] } })).toBe(false);
  expect(sameManagedRecord(base, { ...base, designSnapshot: { schemaVersion: 'v2' } })).toBe(false);
});
