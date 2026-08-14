'use strict';

const { evaluateConfiguredProduct, constants } = require('../configuredProduct');

const product = {
  productId: 'configured-1',
  productType: 'configurable',
  sku: 'BASE-SKU',
  status: 'active',
  currency: 'USD',
  version: 3,
  pricingVersion: 7,
  options: [
    { optionId: 'color', required: true, values: ['Black', 'White'] },
    { optionId: 'placement', required: true, values: [{ placementId: 'center', displayName: 'Center' }] },
    { optionId: 'designSource', required: true, values: ['TEMPLATE', 'CUSTOM_ARTWORK'] },
    { optionId: 'finish', required: false, values: ['standard', 'premium'] },
  ],
  variants: [
    { size: 'M', surchargeCents: 0 },
    { size: '2XL', surchargeCents: 200 },
  ],
  quantityPricing: {
    ruleId: 'configured-price', ruleVersion: 2, aggregatableDimensions: ['size'],
    tiers: [
      { minimumQuantity: 1, maximumQuantity: 99, baseUnitPriceCents: 2000 },
      { minimumQuantity: 100, maximumQuantity: null, baseUnitPriceCents: 1500 },
    ],
    customizationSurcharges: [
      { surchargeId: 'premium-unit', optionPath: 'options.finish', equals: 'premium', application: 'PER_UNIT', amountCents: 50 },
      { surchargeId: 'premium-job', optionPath: 'options.finish', equals: 'premium', application: 'PER_JOB', amountCents: 100 },
    ],
  },
  designSnapshot: { schemaVersion: 'custom-design-v1', canvasVersion: 'canvas-v1' },
  designTemplates: [{ templateId: 'template-1', templateVersion: 1, displayName: 'Template' }],
};

function configuration(overrides = {}) {
  return {
    schemaVersion: 'custom-design-v1',
    options: { color: 'Black', placement: 'center', designSource: 'TEMPLATE', finish: 'premium' },
    designConfiguration: { canvasVersion: 'canvas-v1', templateId: 'template-1', templateVersion: 1, elements: [] },
    ...overrides,
  };
}

describe('configured product evaluation', () => {
  test('fails closed for non-USD products and invalid variant surcharges', async () => {
    const input = { customerConfiguration: configuration(), variantAllocations: [{ selections: { size: 'M' }, quantity: 1 }] };
    await expect(evaluateConfiguredProduct({ ...product, currency: 'EUR' }, input))
      .rejects.toMatchObject({ code: 'CART_CURRENCY_MISMATCH' });
    await expect(evaluateConfiguredProduct({
      ...product,
      variants: product.variants.map((variant, index) => index === 0 ? { ...variant, surchargeCents: -1 } : variant),
    }, input))
      .rejects.toMatchObject({ code: 'CART_PRICE_CHANGED' });
  });

  test('derives total quantity, combines allocations, and produces an explainable authoritative price', async () => {
    const result = await evaluateConfiguredProduct(product, {
      customerConfiguration: configuration(),
      variantAllocations: [
        { selections: { size: 'M' }, quantity: 4 },
        { selections: { size: '2XL' }, quantity: 5 },
        { selections: { size: 'M' }, quantity: 6 },
      ],
      customerInstructions: '  Keep lines centered.  ',
    }, { now: () => new Date('2026-08-14T00:00:00.000Z') });
    expect(result.totalQuantity).toBe(15);
    expect(result.variantAllocations).toEqual([
      { selections: { size: '2XL' }, quantity: 5, variantSurchargeCents: 200 },
      { selections: { size: 'M' }, quantity: 10, variantSurchargeCents: 0 },
    ]);
    expect(result.pricingSnapshot).toMatchObject({
      schemaVersion: 'configured-pricing-v1', pricingVersion: 7, totalQuantity: 15,
      allocations: expect.arrayContaining([
        expect.objectContaining({ selections: { size: 'M' }, configuredUnitPriceCents: 2050, lineTotalCents: 20500 }),
        expect.objectContaining({ selections: { size: '2XL' }, configuredUnitPriceCents: 2250, lineTotalCents: 11250 }),
      ]),
      perJobSurchargeCents: 100, subtotalCents: 31850,
    });
    expect(result.customerInstructions).toBe('Keep lines centered.');
  });

  test('accepts the 100+ tier and enforces the 10,000 technical ceiling', async () => {
    const at100 = await evaluateConfiguredProduct(product, { customerConfiguration: configuration(), variantAllocations: [{ selections: { size: 'M' }, quantity: 100 }] });
    expect(at100.pricingSnapshot.tier.baseUnitPriceCents).toBe(1500);
    await expect(evaluateConfiguredProduct(product, { customerConfiguration: configuration(), variantAllocations: [{ selections: { size: 'M' }, quantity: constants.MAX_CONFIGURED_JOB_QUANTITY + 1 }] })).rejects.toMatchObject({ code: 'CART_QUANTITY_LIMIT_EXCEEDED' });
  });

  test('honors lower product maximum and quantity increments', async () => {
    const limited = { ...product, minimumQuantity: 5, maximumQuantity: 20, quantityIncrement: 5 };
    await expect(evaluateConfiguredProduct(limited, { customerConfiguration: configuration(), variantAllocations: [{ selections: { size: 'M' }, quantity: 21 }] })).rejects.toMatchObject({ code: 'CART_QUANTITY_LIMIT_EXCEEDED' });
    await expect(evaluateConfiguredProduct(limited, { customerConfiguration: configuration(), variantAllocations: [{ selections: { size: 'M' }, quantity: 6 }] })).rejects.toMatchObject({ code: 'CART_QUANTITY_INVALID' });
  });

  test('rejects unknown dimensions, variants, options, schemas, and templates', async () => {
    const valid = { customerConfiguration: configuration(), variantAllocations: [{ selections: { size: 'M' }, quantity: 1 }] };
    await expect(evaluateConfiguredProduct(product, { ...valid, variantAllocations: [{ selections: { material: 'cotton' }, quantity: 1 }] })).rejects.toMatchObject({ code: 'CART_INVALID_VARIATION' });
    await expect(evaluateConfiguredProduct(product, { ...valid, variantAllocations: [{ selections: { size: 'XL' }, quantity: 1 }] })).rejects.toMatchObject({ code: 'CART_INVALID_VARIATION' });
    await expect(evaluateConfiguredProduct(product, { ...valid, customerConfiguration: configuration({ options: { ...configuration().options, color: 'Blue' } }) })).rejects.toMatchObject({ code: 'CART_INVALID_VARIATION' });
    await expect(evaluateConfiguredProduct(product, { ...valid, customerConfiguration: configuration({ schemaVersion: 'unknown' }) })).rejects.toMatchObject({ code: 'CART_INVALID_PERSONALIZATION' });
    await expect(evaluateConfiguredProduct(product, { ...valid, customerConfiguration: configuration({ designConfiguration: { canvasVersion: 'canvas-v1', templateId: 'unknown', templateVersion: 1 } }) })).rejects.toMatchObject({ code: 'CART_INVALID_PERSONALIZATION' });
  });

  test('keeps custom artwork fail-closed without a verifier and persists only verifier-returned references', async () => {
    const custom = configuration({
      options: { color: 'Black', placement: 'center', designSource: 'CUSTOM_ARTWORK', finish: 'standard' },
      designConfiguration: { canvasVersion: 'canvas-v1', scale: 1 },
      assetReferences: [{ assetId: 'claimed', storageKey: 'client/chosen', mediaType: 'image/png' }],
    });
    const input = { customerConfiguration: custom, variantAllocations: [{ selections: { size: 'M' }, quantity: 1 }] };
    await expect(evaluateConfiguredProduct(product, input)).rejects.toMatchObject({ code: 'CART_ASSET_REFERENCE_INVALID' });
    const assetVerifier = jest.fn().mockResolvedValue({ assetId: 'trusted', storageKey: 'trusted/key', originalFilename: 'art.png', mediaType: 'image/png', uploadStatus: 'ready' });
    const result = await evaluateConfiguredProduct(product, input, { assetVerifier });
    expect(result.customerConfiguration.assetReferences).toEqual([{ assetId: 'trusted', mediaType: 'image/png', originalFilename: 'art.png', storageKey: 'trusted/key', uploadStatus: 'ready' }]);
  });

  test.each([
    [{ data: 'data:image/png;base64,AAAA' }, 'CART_INVALID_PERSONALIZATION'],
    [{ productionMethod: 'DTG' }, 'CART_INVALID_PERSONALIZATION'],
    [{ accessToken: 'secret' }, 'CART_INVALID_PERSONALIZATION'],
  ])('rejects embedded or fulfillment/auth-controlled customer data', async (unsafe, code) => {
    await expect(evaluateConfiguredProduct(product, {
      customerConfiguration: configuration({ unsafe }),
      variantAllocations: [{ selections: { size: 'M' }, quantity: 1 }],
    })).rejects.toMatchObject({ code });
  });

  test('rejects oversized configurations and invalid instructions', async () => {
    await expect(evaluateConfiguredProduct(product, {
      customerConfiguration: configuration({ personalization: { text: 'x'.repeat(constants.MAX_CONFIGURATION_BYTES) } }),
      variantAllocations: [{ selections: { size: 'M' }, quantity: 1 }],
    })).rejects.toMatchObject({ code: expect.stringMatching(/CART_INVALID_PERSONALIZATION|CART_ITEM_TOO_LARGE/) });
    await expect(evaluateConfiguredProduct(product, {
      customerConfiguration: configuration(), variantAllocations: [{ selections: { size: 'M' }, quantity: 1 }], customerInstructions: {},
    })).rejects.toMatchObject({ code: 'CART_INVALID_PERSONALIZATION' });
  });

  test('validates versioned generic design geometry and structured text rules', async () => {
    const designed = {
      ...product,
      designSnapshot: { schemaVersion: 'custom-design-v1', canvasVersion: 'canvas-v1', canvas: { width: 800, height: 800 }, persistResolvedCoordinates: true, allowedDesignScale: { minimum: 0.5, maximum: 2 } },
      customization: {
        organizationName: { maximumLength: 100 }, additionalTextElements: { maximumElements: 4, maximumLengthPerElement: 100 },
        fonts: [{ fontId: 'cinzel' }], fontSize: { minimum: 10, maximum: 48 }, archDegrees: { minimum: -30, maximum: 30 },
        customerInstructions: { maximumLength: 500 },
      },
    };
    const designConfiguration = {
      canvasVersion: 'canvas-v1', templateId: 'template-1', templateVersion: 1,
      designGeometry: { x: 400, y: 200 }, designScale: 1,
      textElements: [{ elementRole: 'organizationName', text: 'Grace Church', fontId: 'cinzel', color: '#ffffff', fontSize: 24, archDegrees: 0, position: { x: 400, y: 350 }, order: 1 }],
    };
    const result = await evaluateConfiguredProduct(designed, { customerConfiguration: configuration({ organizationName: ' Grace Church ', designConfiguration }), variantAllocations: [{ selections: { size: 'M' }, quantity: 1 }] });
    expect(result.customerConfiguration).toMatchObject({ organizationName: 'Grace Church', designConfiguration: { textElements: [{ color: '#FFFFFF', order: 1 }] } });
    await expect(evaluateConfiguredProduct(designed, { customerConfiguration: configuration({ organizationName: 'Grace Church', designConfiguration: { ...designConfiguration, designGeometry: { x: 900, y: 200 } } }), variantAllocations: [{ selections: { size: 'M' }, quantity: 1 }] })).rejects.toMatchObject({ code: 'CART_INVALID_PERSONALIZATION' });
  });
});
