'use strict';

/**
 * seedProductsBatch2.test.js
 * Tests for the updated seedProducts.js:
 *   - MANAGED_FIELDS additions (quantityMode, variantDimensions, minimumQuantity, etc.)
 *   - allowSync update path
 *   - Batch 2 records stay in REQUIRES_REVIEW (requiresReview=true)
 *   - validateStandardConfigurableDefinition wired into the seed/sync validation path
 */

const { seedProducts, sameManagedRecord, MANAGED_FIELDS } = require('../seedProducts');

// ── MANAGED_FIELDS completeness ───────────────────────────────────────────────

describe('MANAGED_FIELDS completeness', () => {
  test('includes standard-configurable variant dimensions', () => {
    expect(MANAGED_FIELDS).toContain('quantityMode');
    expect(MANAGED_FIELDS).toContain('variantDimensions');
    expect(MANAGED_FIELDS).toContain('minimumQuantity');
    expect(MANAGED_FIELDS).toContain('quantityIncrement');
    expect(MANAGED_FIELDS).toContain('requiresReview');
    expect(MANAGED_FIELDS).toContain('reviewNotes');
  });

  test('sameManagedRecord detects quantityMode difference', () => {
    const base = { productId: 'a', quantityMode: 'UNIT', variantDimensions: ['size'] };
    const changed = { productId: 'a', quantityMode: 'PACKAGE_SELECTION', variantDimensions: ['size'] };
    expect(sameManagedRecord(base, changed)).toBe(false);
  });

  test('sameManagedRecord detects variantDimensions difference', () => {
    const base = { productId: 'a', variantDimensions: ['size'] };
    const changed = { productId: 'a', variantDimensions: ['size', 'finish'] };
    expect(sameManagedRecord(base, changed)).toBe(false);
  });

  test('sameManagedRecord detects requiresReview difference', () => {
    const base = { productId: 'a', requiresReview: true };
    const changed = { productId: 'a', requiresReview: false };
    expect(sameManagedRecord(base, changed)).toBe(false);
  });

  test('sameManagedRecord returns true for identical managed fields', () => {
    const record = {
      productId: 'a', name: 'Test', slug: 'test', sku: 'SKU', supportedSkus: ['SKU'],
      basePrice: 100, currency: 'USD', status: 'active', image: null, productType: 'standard-configurable',
      quantityMode: 'UNIT', variantDimensions: ['size'], options: [], variants: [],
      minimumQuantity: 1, quantityIncrement: 1, requiresReview: false, reviewNotes: [],
      sellable: true, availableForSale: true, version: 1, pricingVersion: 1, sourcePage: 'test.html',
    };
    expect(sameManagedRecord(record, { ...record })).toBe(true);
  });
});

// ── Batch 2 records stay in REQUIRES_REVIEW ────────────────────────────────────

describe('Batch 2 seed records', () => {
  const batch2Ids = [
    'ec5e1b7e-cb16-4d71-8966-0d2483ff0597', // church-flyer-bulletin
    'd0b9bcc6-7515-4d1b-8b9e-b80b130a2c0f', // church-fridge-magnet
    '68ea2471-7598-4368-8753-da6c665bf6a3', // church-tablecloth
    '8a423057-139c-49d3-a64d-d77855a5b5d2', // church-vinyl-sticker
    '23af57ea-243f-4ceb-993a-6b5ebd0ecc89', // custom-ministry-flag
    '9f22a476-4f58-436f-9609-491fb2077987', // magnetic-car-sign
  ];

  test('batch 2 products land in REQUIRES_REVIEW during dry-run seed', async () => {
    const mockProductService = {
      validateSeedProduct: () => { throw new Error('Should not be called for requiresReview records'); },
      getProduct: async () => null,
      getProductBySlug: async () => null,
      createSeedProduct: async () => {},
    };
    const summary = await seedProducts({ dryRun: true, productService: mockProductService });
    const reviewIds = summary.REQUIRES_REVIEW.map(r => r.productId);
    for (const id of batch2Ids) {
      expect(reviewIds).toContain(id);
    }
  });
});

// ── allowSync update path ─────────────────────────────────────────────────────

describe('seedProducts allowSync', () => {
  const makeActiveRecord = (overrides = {}) => ({
    productId: 'aaaaaaaa-0000-4000-8000-000000000001',
    name: 'Test Product',
    slug: 'test-product',
    sku: 'TEST-SKU',
    supportedSkus: ['TEST-SKU'],
    basePrice: 1000,
    currency: 'USD',
    status: 'active',
    image: null,
    productType: 'standard-configurable',
    quantityMode: 'UNIT',
    variantDimensions: ['size'],
    options: [],
    variants: [{ selections: { size: 'large' }, unitPriceCents: 1000 }],
    minimumQuantity: 1,
    quantityIncrement: 1,
    availableForSale: true,
    sellable: true,
    version: 1,
    pricingVersion: 1,
    sourcePage: 'products/test.html',
    requiresReview: false,
    reviewNotes: [],
    ...overrides,
  });

  test('without allowSync, changed existing record goes to CONFLICTING', async () => {
    const record = makeActiveRecord();
    const changed = { ...record, name: 'Updated Name' };
    const mockProductService = {
      validateSeedProduct: r => r,
      getProduct: async () => record, // existing record with old name
      getProductBySlug: async () => record,
      createSeedProduct: async () => {},
      updateSeedProduct: async () => {},
    };
    const manifest = { records: [changed] };
    const summary = await seedProducts({ manifest, productService: mockProductService, dryRun: false, allowSync: false });
    expect(summary.CONFLICTING).toHaveLength(1);
    expect(summary.UPDATED).toHaveLength(0);
  });

  test('with allowSync, changed existing record goes to UPDATED (dry-run: WOULD_UPDATE)', async () => {
    const record = makeActiveRecord();
    const changed = { ...record, name: 'Updated Name' };
    const mockProductService = {
      validateSeedProduct: r => r,
      getProduct: async () => record,
      getProductBySlug: async () => record,
      createSeedProduct: async () => {},
      updateSeedProduct: async () => {},
    };
    const manifest = { records: [changed] };
    const dryRunSummary = await seedProducts({ manifest, productService: mockProductService, dryRun: true, allowSync: true });
    expect(dryRunSummary.WOULD_UPDATE).toHaveLength(1);
    expect(dryRunSummary.UPDATED).toHaveLength(0);

    const liveSummary = await seedProducts({ manifest, productService: mockProductService, dryRun: false, allowSync: true });
    expect(liveSummary.UPDATED).toHaveLength(1);
    expect(liveSummary.CONFLICTING).toHaveLength(0);
  });

  test('slug hijack always goes to CONFLICTING regardless of allowSync', async () => {
    const record = makeActiveRecord();
    const hijacker = { ...record, productId: 'aaaaaaaa-0000-4000-8000-000000000002' };
    const mockProductService = {
      validateSeedProduct: r => r,
      getProduct: async (id) => id === hijacker.productId ? null : record,
      getProductBySlug: async () => record, // slug belongs to different productId
      createSeedProduct: async () => {},
      updateSeedProduct: async () => {},
    };
    const manifest = { records: [hijacker] };
    const summary = await seedProducts({ manifest, productService: mockProductService, allowSync: true });
    expect(summary.CONFLICTING).toHaveLength(1);
    expect(summary.CONFLICTING[0].reason).toMatch(/slug/);
  });

  test('unchanged existing record goes to UNCHANGED even with allowSync', async () => {
    const record = makeActiveRecord();
    const mockProductService = {
      validateSeedProduct: r => r,
      getProduct: async () => record,
      getProductBySlug: async () => record,
      createSeedProduct: async () => {},
      updateSeedProduct: async () => { throw new Error('should not be called'); },
    };
    const manifest = { records: [record] };
    const summary = await seedProducts({ manifest, productService: mockProductService, allowSync: true });
    expect(summary.UNCHANGED).toContain(record.productId);
    expect(summary.UPDATED).toHaveLength(0);
  });
});

// ── Standard-configurable definition validation in seed/sync path ─────────────
//
// Correction 1: validateStandardConfigurableDefinition() is now wired into
// seedProducts.js after validateSeedProduct() for standard-configurable records.
// These tests confirm:
//   (a) malformed definitions are rejected (go to INVALID)
//   (b) valid definitions are accepted when lifecycle-eligible
//   (c) draft/requiresReview Batch 2 records remain non-activatable/non-sellable
//   (d) Batch 1 (non-standard-configurable) behavior is unaffected

describe('validateStandardConfigurableDefinition wired into seed/sync path', () => {
  // A well-formed, lifecycle-eligible (active, requiresReview=false) standard-configurable record.
  const makeValidStdConf = (overrides = {}) => ({
    productId: 'bbbbbbbb-0000-4000-8000-000000000001',
    name: 'Valid Std Conf',
    slug: 'valid-std-conf',
    sku: null,
    supportedSkus: [],
    basePrice: 500,
    currency: 'USD',
    status: 'active',
    image: null,
    productType: 'standard-configurable',
    quantityMode: 'UNIT',
    variantDimensions: ['size'],
    options: [],
    variants: [{ selections: { size: 'small' }, unitPriceCents: 500 }],
    minimumQuantity: 1,
    quantityIncrement: 1,
    availableForSale: true,
    sellable: true,
    version: 1,
    pricingVersion: 1,
    sourcePage: 'products/valid-std-conf.html',
    requiresReview: false,
    reviewNotes: [],
    ...overrides,
  });

  // validateSeedProduct passthrough for lifecycle-eligible records
  const passThroughService = {
    validateSeedProduct: (r) => r,
    getProduct: async () => null,
    getProductBySlug: async () => null,
    createSeedProduct: async () => {},
    updateSeedProduct: async () => {},
  };

  test('malformed definition — empty variantDimensions — goes to INVALID', async () => {
    const bad = makeValidStdConf({ variantDimensions: [] });
    const manifest = { records: [bad] };
    const summary = await seedProducts({ manifest, productService: passThroughService, dryRun: true });
    expect(summary.INVALID).toHaveLength(1);
    expect(summary.INVALID[0].productId).toBe(bad.productId);
    expect(summary.INVALID[0].reason).toMatch(/variantDimensions/i);
    expect(summary.WOULD_CREATE).toHaveLength(0);
  });

  test('malformed definition — duplicate variantDimensions — goes to INVALID', async () => {
    const bad = makeValidStdConf({ variantDimensions: ['size', 'size'] });
    const manifest = { records: [bad] };
    const summary = await seedProducts({ manifest, productService: passThroughService, dryRun: true });
    expect(summary.INVALID).toHaveLength(1);
    expect(summary.INVALID[0].reason).toMatch(/variantDimensions/i);
  });

  test('malformed definition — variant selections mismatch dimensions — goes to INVALID', async () => {
    // variant references "finish" but variantDimensions only has "size"
    const bad = makeValidStdConf({
      variantDimensions: ['size'],
      variants: [{ selections: { finish: 'glossy' }, unitPriceCents: 500 }],
    });
    const manifest = { records: [bad] };
    const summary = await seedProducts({ manifest, productService: passThroughService, dryRun: true });
    expect(summary.INVALID).toHaveLength(1);
    expect(summary.INVALID[0].reason).toMatch(/variant selections/i);
  });

  test('malformed definition — no variants — goes to INVALID', async () => {
    const bad = makeValidStdConf({ variants: [] });
    const manifest = { records: [bad] };
    const summary = await seedProducts({ manifest, productService: passThroughService, dryRun: true });
    expect(summary.INVALID).toHaveLength(1);
    expect(summary.INVALID[0].reason).toMatch(/variants/i);
  });

  test('malformed definition — duplicate variant tuple — goes to INVALID', async () => {
    const bad = makeValidStdConf({
      variantDimensions: ['size'],
      variants: [
        { selections: { size: 'small' }, unitPriceCents: 500 },
        { selections: { size: 'small' }, unitPriceCents: 600 }, // duplicate tuple
      ],
    });
    const manifest = { records: [bad] };
    const summary = await seedProducts({ manifest, productService: passThroughService, dryRun: true });
    expect(summary.INVALID).toHaveLength(1);
    expect(summary.INVALID[0].reason).toMatch(/duplicate variant/i);
  });

  test('malformed definition — optionId conflicts with variantDimension — goes to INVALID', async () => {
    const bad = makeValidStdConf({
      variantDimensions: ['size'],
      options: [{ optionId: 'size', values: ['small'] }],
      variants: [{ selections: { size: 'small' }, unitPriceCents: 500 }],
    });
    const manifest = { records: [bad] };
    const summary = await seedProducts({ manifest, productService: passThroughService, dryRun: true });
    expect(summary.INVALID).toHaveLength(1);
    expect(summary.INVALID[0].reason).toMatch(/conflict/i);
  });

  test('valid standard-configurable definition — lifecycle-eligible — goes to WOULD_CREATE (dry-run)', async () => {
    const good = makeValidStdConf();
    const manifest = { records: [good] };
    const summary = await seedProducts({ manifest, productService: passThroughService, dryRun: true });
    expect(summary.INVALID).toHaveLength(0);
    expect(summary.WOULD_CREATE).toContain(good.productId);
  });

  test('valid standard-configurable with multiple dimensions — goes to WOULD_CREATE (dry-run)', async () => {
    const good = makeValidStdConf({
      productId: 'bbbbbbbb-0000-4000-8000-000000000002',
      variantDimensions: ['size', 'finish'],
      variants: [
        { selections: { size: 'small', finish: 'glossy' }, unitPriceCents: 400 },
        { selections: { size: 'large', finish: 'matte' }, unitPriceCents: 800 },
      ],
    });
    const manifest = { records: [good] };
    const summary = await seedProducts({ manifest, productService: passThroughService, dryRun: true });
    expect(summary.INVALID).toHaveLength(0);
    expect(summary.WOULD_CREATE).toContain(good.productId);
  });

  test('Batch 2 draft/requiresReview records bypass definition validation and remain non-activatable', async () => {
    // Batch 2 records have requiresReview=true, so seedProducts short-circuits them to
    // REQUIRES_REVIEW before validateSeedProduct or validateStandardConfigurableDefinition
    // are ever called. This confirms they cannot be accidentally activated or made sellable.
    const batch2DraftRecord = makeValidStdConf({
      productId: 'ec5e1b7e-cb16-4d71-8966-0d2483ff0597',
      status: 'draft',
      requiresReview: true,
      availableForSale: false,
      sellable: false,
    });
    let validateSeedProductCalled = false;
    const mockService = {
      validateSeedProduct: () => { validateSeedProductCalled = true; return batch2DraftRecord; },
      getProduct: async () => null,
      getProductBySlug: async () => null,
      createSeedProduct: async () => {},
    };
    const manifest = { records: [batch2DraftRecord] };
    const summary = await seedProducts({ manifest, productService: mockService, dryRun: true });
    expect(summary.REQUIRES_REVIEW).toHaveLength(1);
    expect(summary.REQUIRES_REVIEW[0].productId).toBe(batch2DraftRecord.productId);
    expect(validateSeedProductCalled).toBe(false);
    expect(summary.WOULD_CREATE).toHaveLength(0);
    expect(summary.INVALID).toHaveLength(0);
  });

  test('non-standard-configurable (Batch 1) records bypass definition validation entirely', async () => {
    // A plain product (no productType) still goes through validateSeedProduct only.
    // validateStandardConfigurableDefinition must never be called for it.
    const batch1Record = {
      productId: 'cccccccc-0000-4000-8000-000000000001',
      name: 'Batch 1 Product',
      slug: 'batch-1-product',
      sku: 'B1-SKU',
      supportedSkus: ['B1-SKU'],
      basePrice: 1000,
      currency: 'USD',
      status: 'active',
      image: null,
      productType: 'configured',
      version: 1,
      pricingVersion: 1,
      sourcePage: 'products/batch1.html',
      requiresReview: false,
      reviewNotes: [],
    };
    const manifest = { records: [batch1Record] };
    const summary = await seedProducts({ manifest, productService: passThroughService, dryRun: true });
    expect(summary.INVALID).toHaveLength(0);
    expect(summary.WOULD_CREATE).toContain(batch1Record.productId);
  });

  test('malformed definition on allowSync update path — goes to INVALID', async () => {
    // Even on the sync (update) path, a malformed standard-configurable definition
    // must be rejected before updateSeedProduct is called.
    const existingRecord = makeValidStdConf();
    const bad = makeValidStdConf({ variantDimensions: [] }); // malformed
    let updateCalled = false;
    const mockService = {
      validateSeedProduct: (r) => r,
      getProduct: async () => existingRecord,
      getProductBySlug: async () => existingRecord,
      createSeedProduct: async () => {},
      updateSeedProduct: async () => { updateCalled = true; },
    };
    const manifest = { records: [bad] };
    const summary = await seedProducts({ manifest, productService: mockService, dryRun: false, allowSync: true });
    expect(summary.INVALID).toHaveLength(1);
    expect(summary.INVALID[0].reason).toMatch(/variantDimensions/i);
    expect(updateCalled).toBe(false);
  });
});
