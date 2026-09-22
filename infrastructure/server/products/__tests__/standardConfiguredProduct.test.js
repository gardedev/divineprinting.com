'use strict';

const manifest = require('../data/product-seed.json');
const {
  evaluateStandardConfiguredProduct,
  validateStandardConfigurableDefinition,
  StandardConfiguredProductError,
  REJECTED_ALLOCATION_KEYS,
  ALLOWED_CONFIGURATION_KEYS,
  REJECTED_CART_INPUT_KEYS,
} = require('../standardConfiguredProduct');

// ── Fixtures ─────────────────────────────────────────────────────────────────

const expected = {
  'Church Flyers - Standard 8.5x11': ['46a21984-0f64-4d57-9202-0b591c266f9b', 'DPT-CHURCH-FLYER-STD-8511'],
  'Church Magnets - Business Card Size': ['b2033b41-913f-46b8-8639-bd66dc1ab0fc', 'DPT-CHURCH-MAGNET-BUSCARD'],
  'Church Stickers - Round': ['8db500c6-c3ea-417f-8ce8-1c36940f36f6', 'DPT-CHURCH-STICKER-ROUND'],
  'Church Vinyl Banner - Standard Sizes': ['476a47bd-932f-4a71-81cc-7b4506662206', 'DPT-CHURCH-VINYL-BANNER-STD'],
  'Church Yard Sign - 18x24 Standard': ['379c7176-5ab7-45b3-a87e-524b6ff35867', 'DPT-CHURCH-YARD-SIGN-1824'],
  'Retractable Banner - Standard': ['30596774-a90b-4b33-ab94-9bcda66bf114', 'DPT-RETRACTABLE-BANNER-STD'],
};

// Batch 2 draft products (requiresReview=true, status=draft, sellable=false)
const batch2 = {
  'Church Flyer & Bulletin': 'ec5e1b7e-cb16-4d71-8966-0d2483ff0597',
  'Church Fridge Magnet': 'd0b9bcc6-7515-4d1b-8b9e-b80b130a2c0f',
  'Church Tablecloth': '68ea2471-7598-4368-8753-da6c665bf6a3',
  'Church Vinyl Sticker': '8a423057-139c-49d3-a64d-d77855a5b5d2',
  'Custom Ministry Flag': '23af57ea-243f-4ceb-993a-6b5ebd0ecc89',
  'Magnetic Car Sign': '9f22a476-4f58-436f-9609-491fb2077987',
};

const product = name => manifest.records.find(r => r.name === name);

const input = (selections, quantity, opts = {}, extra = {}) => ({
  customerConfiguration: { schemaVersion: 'standard-product-v1', options: opts },
  variantAllocations: [{ selections, quantity }],
  ...extra,
});

// ── Batch 1: existing active products ─────────────────────────────────────────

describe('Batch 1 standard configured catalog evaluator', () => {
  test('contains exactly the approved active standard products with permanent IDs and SKUs', () => {
    const active = manifest.records.filter(r => r.status === 'active' && r.productType === 'standard-configurable');
    expect(active).toHaveLength(6);
    for (const [name, [productId, sku]] of Object.entries(expected)) {
      expect(product(name)).toMatchObject({ productId, sku, status: 'active', availableForSale: true, requiresReview: false, productType: 'standard-configurable' });
    }
  });

  test.each([
    ['100', 100, 1500], ['250', 250, 3000], ['500', 500, 5000], ['1000', 1000, 8000],
  ])('prices flyer package %s only from its catalog record', (selection, physicalQuantity, total) => {
    // price/lineTotalCents must NOT be submitted; server derives all pricing from catalog.
    const result = evaluateStandardConfiguredProduct(
      product('Church Flyers - Standard 8.5x11'),
      input({ package: selection }, 1)
    );
    expect(result).toMatchObject({ totalQuantity: physicalQuantity, lineTotalCents: total, pricingSnapshot: { subtotalCents: total, quantityMode: 'DISCRETE_SELECTION' } });
  });

  test.each([
    ['single', 3, 3, 447], ['25-pack', 2, 50, 5998], ['50-pack', 2, 100, 9998], ['100-pack', 2, 200, 15998],
  ])('prices magnets package %s with separate pack count', (selection, packs, physicalQuantity, total) => {
    const result = evaluateStandardConfiguredProduct(
      product('Church Magnets - Business Card Size'),
      input({ package: selection }, packs)
    );
    expect(result).toMatchObject({ totalQuantity: physicalQuantity, lineTotalCents: total, pricingSnapshot: { allocations: [expect.objectContaining({ physicalQuantity, quantity: packs, lineTotalCents: total })] } });
  });

  test.each([
    ['2-inch', 50, 1250], ['3-inch', 100, 3500],
  ])('prices sticker variants by physical quantity', (selection, quantity, total) => {
    // unitPriceCents must NOT be submitted; server derives from catalog.
    const result = evaluateStandardConfiguredProduct(
      product('Church Stickers - Round'),
      input({ size: selection }, quantity)
    );
    expect(result).toMatchObject({ totalQuantity: quantity, lineTotalCents: total });
  });

  test.each([
    ['2x4-ft', 2, 5998], ['3x6-ft', 1, 4599], ['4x8-ft', 3, 20997],
  ])('prices vinyl banner variant %s', (selection, quantity, total) => {
    expect(evaluateStandardConfiguredProduct(product('Church Vinyl Banner - Standard Sizes'), input({ size: selection }, quantity))).toMatchObject({ totalQuantity: quantity, lineTotalCents: total });
  });

  test.each([
    ['single', 3, 3, 3897], ['5-pack', 2, 10, 9998], ['10-pack', 2, 20, 17998],
  ])('prices yard-sign package %s with pack count', (selection, packs, physicalQuantity, total) => {
    expect(evaluateStandardConfiguredProduct(product('Church Yard Sign - 18x24 Standard'), input({ package: selection }, packs))).toMatchObject({ totalQuantity: physicalQuantity, lineTotalCents: total });
  });

  test('prices the fixed rollup banner as a physical unit', () => {
    expect(evaluateStandardConfiguredProduct(product('Retractable Banner - Standard'), input({ size: '33x80-in' }, 2))).toMatchObject({ totalQuantity: 2, lineTotalCents: 13998 });
  });

  test.each([
    ['Church Magnets - Business Card Size', { package: '25 Pack' }, 1, 'CART_INVALID_VARIATION'],
    ['Church Yard Sign - 18x24 Standard', { package: '5 Pack' }, 1, 'CART_INVALID_VARIATION'],
    ['Church Stickers - Round', { size: '2 inch' }, 50, 'CART_INVALID_VARIATION'],
    ['Church Stickers - Round', { size: '2-inch' }, 49, 'CART_QUANTITY_INVALID'],
    ['Church Stickers - Round', { size: '2-inch' }, 51, 'CART_QUANTITY_INVALID'],
    ['Church Flyers - Standard 8.5x11', { package: '100' }, 2, 'CART_QUANTITY_INVALID'],
  ])('strictly rejects noncanonical selection or invalid quantity (%s)', (name, selections, quantity, code) => {
    expect(() => evaluateStandardConfiguredProduct(product(name), input(selections, quantity))).toThrow(expect.objectContaining({ code }));
  });
});

// ── Batch 2: seed record structure ───────────────────────────────────────────

describe('Batch 2 seed record structure', () => {
  test.each(Object.entries(batch2))('%s is present with correct draft flags', (name, productId) => {
    const p = product(name);
    expect(p).toBeDefined();
    expect(p).toMatchObject({
      productId,
      productType: 'standard-configurable',
      status: 'draft',
      requiresReview: true,
      availableForSale: false,
      sellable: false,
      sku: null,
    });
  });

  test('church-flyer-bulletin has 30 variants (A5/A4/A3 × 5 papers × 2 finishes)', () => {
    const p = product('Church Flyer & Bulletin');
    expect(p.variantDimensions).toEqual(['size', 'paper', 'finish']);
    expect(p.variants).toHaveLength(30);
    // Spot-check one tuple
    const v = p.variants.find(v => v.selections.size === 'A4' && v.selections.paper === '157g' && v.selections.finish === 'Gloss');
    expect(v).toBeDefined();
    expect(Number.isInteger(v.unitPriceCents)).toBe(true);
  });

  test('church-fridge-magnet has 8 variants (business-card/4x6 × 4 thicknesses)', () => {
    const p = product('Church Fridge Magnet');
    expect(p.variantDimensions).toEqual(['size', 'thickness']);
    expect(p.variants).toHaveLength(8);
    const v = p.variants.find(v => v.selections.size === '4x6' && v.selections.thickness === '0.9mm');
    expect(v).toBeDefined();
  });

  test('church-tablecloth has 4 variants (6ft/8ft × Fitted/Draped) and no color dimension', () => {
    const p = product('Church Tablecloth');
    expect(p.variantDimensions).toEqual(['size', 'style']);
    expect(p.variants).toHaveLength(4);
    expect(p.variantDimensions).not.toContain('color');
    const v = p.variants.find(v => v.selections.size === '8ft' && v.selections.style === 'Fitted');
    expect(v).toBeDefined();
  });

  test('church-vinyl-sticker has 8 variants (4 sizes × Gloss/Matte), cut option is standard-only', () => {
    const p = product('Church Vinyl Sticker');
    expect(p.variantDimensions).toEqual(['size', 'finish']);
    expect(p.variants).toHaveLength(8);
    const cutOption = (p.options || []).find(o => o.optionId === 'cut');
    expect(cutOption).toBeDefined();
    expect(cutOption.required).toBe(true);
    expect(cutOption.values).toEqual(['standard']);
    // No custom die-cut in variants
    const hasDieCut = p.variants.some(v => v.selections.cut !== undefined);
    expect(hasDieCut).toBe(false);
  });

  test('custom-ministry-flag has 6 variants (3x5/4x6/5x8 × Single/Double)', () => {
    const p = product('Custom Ministry Flag');
    expect(p.variantDimensions).toEqual(['size', 'sides']);
    expect(p.variants).toHaveLength(6);
    const v = p.variants.find(v => v.selections.size === '5x8' && v.selections.sides === 'Double');
    expect(v).toBeDefined();
  });

  test('magnetic-car-sign has 6 variants (12x18/18x24 × 3 thicknesses)', () => {
    const p = product('Magnetic Car Sign');
    expect(p.variantDimensions).toEqual(['size', 'thickness']);
    expect(p.variants).toHaveLength(6);
    const v = p.variants.find(v => v.selections.size === '18x24' && v.selections.thickness === '0.9mm');
    expect(v).toBeDefined();
  });

  test.each(Object.keys(batch2))('%s has no duplicate variant tuples', (name) => {
    const p = product(name);
    const dims = p.variantDimensions;
    const tuples = p.variants.map(v => JSON.stringify(dims.map(d => v.selections[d])));
    expect(new Set(tuples).size).toBe(tuples.length);
  });

  test.each(Object.keys(batch2))('%s variants all have non-negative integer unitPriceCents', (name) => {
    const p = product(name);
    for (const v of p.variants) {
      expect(Number.isInteger(v.unitPriceCents)).toBe(true);
      expect(v.unitPriceCents).toBeGreaterThanOrEqual(0);
    }
  });
});

// ── validateStandardConfigurableDefinition ────────────────────────────────────

describe('validateStandardConfigurableDefinition', () => {
  const baseProduct = {
    productType: 'standard-configurable',
    variantDimensions: ['size', 'finish'],
    options: [],
    variants: [
      { selections: { size: 'A4', finish: 'Gloss' }, unitPriceCents: 100 },
      { selections: { size: 'A4', finish: 'Matte' }, unitPriceCents: 120 },
    ],
    minimumQuantity: 1,
    quantityIncrement: 1,
  };

  test('accepts a valid definition', () => {
    expect(validateStandardConfigurableDefinition(baseProduct)).toBe(true);
  });

  test('rejects wrong productType', () => {
    expect(() => validateStandardConfigurableDefinition({ ...baseProduct, productType: 'configurable' })).toThrow();
  });

  test('rejects empty variantDimensions', () => {
    expect(() => validateStandardConfigurableDefinition({ ...baseProduct, variantDimensions: [] })).toThrow(/variantDimensions/);
  });

  test('rejects duplicate variantDimensions', () => {
    expect(() => validateStandardConfigurableDefinition({ ...baseProduct, variantDimensions: ['size', 'size'] })).toThrow(/unique/);
  });

  test('rejects duplicate optionIds', () => {
    const withDupOptions = {
      ...baseProduct,
      options: [{ optionId: 'cut', required: true, values: ['standard'] }, { optionId: 'cut', required: false, values: ['standard'] }],
    };
    expect(() => validateStandardConfigurableDefinition(withDupOptions)).toThrow(/unique/);
  });

  test('rejects optionId that conflicts with a dimension', () => {
    const conflict = {
      ...baseProduct,
      options: [{ optionId: 'size', required: true, values: ['standard'] }],
    };
    expect(() => validateStandardConfigurableDefinition(conflict)).toThrow(/conflicts/);
  });

  test('rejects variant with missing dimension key', () => {
    const bad = {
      ...baseProduct,
      variants: [{ selections: { size: 'A4' }, unitPriceCents: 100 }], // missing finish
    };
    expect(() => validateStandardConfigurableDefinition(bad)).toThrow(/variantDimensions/);
  });

  test('rejects variant with extra dimension key', () => {
    const bad = {
      ...baseProduct,
      variants: [{ selections: { size: 'A4', finish: 'Gloss', color: 'red' }, unitPriceCents: 100 }],
    };
    expect(() => validateStandardConfigurableDefinition(bad)).toThrow(/variantDimensions/);
  });

  test('rejects duplicate variant tuple', () => {
    const bad = {
      ...baseProduct,
      variants: [
        { selections: { size: 'A4', finish: 'Gloss' }, unitPriceCents: 100 },
        { selections: { size: 'A4', finish: 'Gloss' }, unitPriceCents: 200 },
      ],
    };
    expect(() => validateStandardConfigurableDefinition(bad)).toThrow(/duplicate/);
  });

  test('rejects negative unitPriceCents', () => {
    const bad = {
      ...baseProduct,
      variants: [{ selections: { size: 'A4', finish: 'Gloss' }, unitPriceCents: -1 }],
    };
    expect(() => validateStandardConfigurableDefinition(bad)).toThrow(/unitPriceCents/);
  });

  test('rejects non-integer unitPriceCents', () => {
    const bad = {
      ...baseProduct,
      variants: [{ selections: { size: 'A4', finish: 'Gloss' }, unitPriceCents: 9.99 }],
    };
    expect(() => validateStandardConfigurableDefinition(bad)).toThrow(/unitPriceCents/);
  });

  test('accepts zero unitPriceCents', () => {
    const zero = {
      ...baseProduct,
      variants: [
        { selections: { size: 'A4', finish: 'Gloss' }, unitPriceCents: 0 },
        { selections: { size: 'A4', finish: 'Matte' }, unitPriceCents: 0 },
      ],
    };
    expect(validateStandardConfigurableDefinition(zero)).toBe(true);
  });

  test('rejects invalid minimumQuantity', () => {
    expect(() => validateStandardConfigurableDefinition({ ...baseProduct, minimumQuantity: 0 })).toThrow(/minimumQuantity/);
    expect(() => validateStandardConfigurableDefinition({ ...baseProduct, minimumQuantity: 1.5 })).toThrow(/minimumQuantity/);
  });

  test('rejects invalid quantityIncrement', () => {
    expect(() => validateStandardConfigurableDefinition({ ...baseProduct, quantityIncrement: 0 })).toThrow(/quantityIncrement/);
  });
});

// ── Batch 2: evaluator — approved tuple acceptance ────────────────────────────

describe('Batch 2 evaluator — approved tuples accepted', () => {
  // Use draft product definition directly (evaluateStandardConfiguredProduct does not
  // enforce status/sellable; that gate is at productService/cartService level).
  // Override status to active for evaluator tests only.
  const activate = p => ({ ...p, status: 'active', availableForSale: true, sellable: true });

  test.each([
    ['A5', '120g', 'Gloss'], ['A4', '200g', 'Matte'], ['A3', '250g', 'Gloss'],
  ])('church-flyer-bulletin accepts size=%s paper=%s finish=%s', (size, paper, finish) => {
    const p = activate(product('Church Flyer & Bulletin'));
    const result = evaluateStandardConfiguredProduct(p, input({ size, paper, finish }, 10));
    expect(result.variantAllocations[0].selections).toEqual({ size, paper, finish });
    expect(result.lineTotalCents).toBeGreaterThan(0);
  });

  test.each([
    ['business-card', '0.3mm'], ['4x6', '0.9mm'],
  ])('church-fridge-magnet accepts size=%s thickness=%s', (size, thickness) => {
    const p = activate(product('Church Fridge Magnet'));
    const result = evaluateStandardConfiguredProduct(p, input({ size, thickness }, 5));
    expect(result.variantAllocations[0].selections).toEqual({ size, thickness });
  });

  test.each([
    ['6ft', 'Fitted'], ['8ft', 'Draped'],
  ])('church-tablecloth accepts size=%s style=%s', (size, style) => {
    const p = activate(product('Church Tablecloth'));
    const result = evaluateStandardConfiguredProduct(p, input({ size, style }, 2));
    expect(result.variantAllocations[0].selections).toEqual({ size, style });
  });

  test.each([
    ['1x1', 'Gloss', 'standard'], ['4x4', 'Matte', 'standard'],
  ])('church-vinyl-sticker accepts size=%s finish=%s cut=%s', (size, finish, cut) => {
    const p = activate(product('Church Vinyl Sticker'));
    const result = evaluateStandardConfiguredProduct(p, input({ size, finish }, 10, { cut }));
    expect(result.variantAllocations[0].selections).toEqual({ size, finish });
    expect(result.customerConfiguration.options.cut).toBe('standard');
  });

  test.each([
    ['3x5', 'Single'], ['4x6', 'Double'], ['5x8', 'Single'],
  ])('custom-ministry-flag accepts size=%s sides=%s', (size, sides) => {
    const p = activate(product('Custom Ministry Flag'));
    const result = evaluateStandardConfiguredProduct(p, input({ size, sides }, 3));
    expect(result.variantAllocations[0].selections).toEqual({ size, sides });
  });

  test.each([
    ['12x18', '0.5mm'], ['18x24', '0.9mm'],
  ])('magnetic-car-sign accepts size=%s thickness=%s', (size, thickness) => {
    const p = activate(product('Magnetic Car Sign'));
    const result = evaluateStandardConfiguredProduct(p, input({ size, thickness }, 2));
    expect(result.variantAllocations[0].selections).toEqual({ size, thickness });
  });
});

// ── Batch 2: evaluator — rejection cases ─────────────────────────────────────

describe('Batch 2 evaluator — rejection of invalid inputs', () => {
  const activate = p => ({ ...p, status: 'active', availableForSale: true, sellable: true });

  describe('custom die-cut rejected (vinyl sticker)', () => {
    test('cut=custom-die-cut is rejected by server', () => {
      const p = activate(product('Church Vinyl Sticker'));
      expect(() => evaluateStandardConfiguredProduct(p, input({ size: '2x2', finish: 'Gloss' }, 5, { cut: 'custom-die-cut' })))
        .toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
    });

    test('missing cut option is rejected when required', () => {
      const p = activate(product('Church Vinyl Sticker'));
      // options={} — no cut key
      expect(() => evaluateStandardConfiguredProduct(p, {
        customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} },
        variantAllocations: [{ selections: { size: '1x1', finish: 'Gloss' }, quantity: 1 }],
      })).toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
    });
  });

  describe('case-altered selections rejected', () => {
    test('finish=gloss (lowercase) is rejected for church-flyer-bulletin', () => {
      const p = activate(product('Church Flyer & Bulletin'));
      expect(() => evaluateStandardConfiguredProduct(p, input({ size: 'A5', paper: '120g', finish: 'gloss' }, 1)))
        .toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
    });

    test('sides=single (lowercase) is rejected for custom-ministry-flag', () => {
      const p = activate(product('Custom Ministry Flag'));
      expect(() => evaluateStandardConfiguredProduct(p, input({ size: '3x5', sides: 'single' }, 1)))
        .toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
    });
  });

  describe('missing dimension keys rejected', () => {
    test('missing paper for flyer rejected', () => {
      const p = activate(product('Church Flyer & Bulletin'));
      expect(() => evaluateStandardConfiguredProduct(p, input({ size: 'A4', finish: 'Gloss' }, 1)))
        .toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
    });

    test('missing finish for vinyl sticker rejected', () => {
      const p = activate(product('Church Vinyl Sticker'));
      expect(() => evaluateStandardConfiguredProduct(p, input({ size: '2x2' }, 1, { cut: 'standard' })))
        .toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
    });
  });

  describe('extra dimension keys rejected', () => {
    test('extra color key rejected for tablecloth', () => {
      const p = activate(product('Church Tablecloth'));
      expect(() => evaluateStandardConfiguredProduct(p, input({ size: '6ft', style: 'Fitted', color: 'blue' }, 1)))
        .toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
    });
  });

  describe('browser-supplied price/SKU/totals rejected from allocation', () => {
    test.each([
      'price', 'unitPriceCents', 'lineTotalCents', 'physicalUnits', 'baseSku', 'sku',
    ])('allocation with %s key is rejected', (key) => {
      const p = activate(product('Magnetic Car Sign'));
      const badAllocation = { selections: { size: '12x18', thickness: '0.5mm' }, quantity: 1, [key]: 999 };
      expect(() => evaluateStandardConfiguredProduct(p, {
        customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} },
        variantAllocations: [badAllocation],
      })).toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
    });
  });

  describe('browser-supplied top-level pricing fields rejected from input', () => {
    test.each([
      'baseSku', 'sku', 'physicalUnits', 'price', 'unitPriceCents', 'lineTotalCents', 'pricingSnapshot',
    ])('top-level input with %s key is rejected', (key) => {
      const p = activate(product('Custom Ministry Flag'));
      expect(() => evaluateStandardConfiguredProduct(p, {
        customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} },
        variantAllocations: [{ selections: { size: '3x5', sides: 'Single' }, quantity: 1 }],
        [key]: 'injected',
      })).toThrow(expect.objectContaining({ code: 'CART_INVALID_INPUT' }));
    });
  });

  describe('extra customerConfiguration keys rejected', () => {
    test('extra key in customerConfiguration is rejected', () => {
      const p = activate(product('Magnetic Car Sign'));
      expect(() => evaluateStandardConfiguredProduct(p, {
        customerConfiguration: { schemaVersion: 'standard-product-v1', options: {}, extraKey: 'injected' },
        variantAllocations: [{ selections: { size: '12x18', thickness: '0.5mm' }, quantity: 1 }],
      })).toThrow(expect.objectContaining({ code: 'CART_INVALID_PERSONALIZATION' }));
    });
  });

  describe('undeclared options rejected', () => {
    test('undeclared option key is rejected for church-tablecloth', () => {
      const p = activate(product('Church Tablecloth'));
      expect(() => evaluateStandardConfiguredProduct(p, input({ size: '6ft', style: 'Fitted' }, 1, { color: 'blue' })))
        .toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
    });
  });

  describe('malformed inputs rejected', () => {
    test('non-integer quantity is rejected', () => {
      const p = activate(product('Custom Ministry Flag'));
      expect(() => evaluateStandardConfiguredProduct(p, input({ size: '3x5', sides: 'Single' }, 1.5)))
        .toThrow(expect.objectContaining({ code: 'CART_QUANTITY_INVALID' }));
    });

    test('zero quantity is rejected', () => {
      const p = activate(product('Magnetic Car Sign'));
      expect(() => evaluateStandardConfiguredProduct(p, input({ size: '12x18', thickness: '0.5mm' }, 0)))
        .toThrow(expect.objectContaining({ code: 'CART_QUANTITY_INVALID' }));
    });

    test('wrong schemaVersion is rejected', () => {
      const p = activate(product('Custom Ministry Flag'));
      expect(() => evaluateStandardConfiguredProduct(p, {
        customerConfiguration: { schemaVersion: 'wrong-v1', options: {} },
        variantAllocations: [{ selections: { size: '3x5', sides: 'Single' }, quantity: 1 }],
      })).toThrow(expect.objectContaining({ code: 'CART_INVALID_PERSONALIZATION' }));
    });

    test('multiple allocations are rejected', () => {
      const p = activate(product('Custom Ministry Flag'));
      expect(() => evaluateStandardConfiguredProduct(p, {
        customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} },
        variantAllocations: [
          { selections: { size: '3x5', sides: 'Single' }, quantity: 1 },
          { selections: { size: '4x6', sides: 'Double' }, quantity: 1 },
        ],
      })).toThrow(expect.objectContaining({ code: 'CART_INVALID_VARIATION' }));
    });
  });
});

// ── Quote-isolation: die-cut / custom values must not be in variants ──────────

describe('Quote-isolation: custom/die-cut values not present in sellable catalog', () => {
  test('church-vinyl-sticker variants contain no custom-die-cut value', () => {
    const p = product('Church Vinyl Sticker');
    const allSelectionValues = p.variants.flatMap(v => Object.values(v.selections));
    expect(allSelectionValues).not.toContain('custom-die-cut');
    expect(allSelectionValues).not.toContain('die-cut');
    expect(allSelectionValues).not.toContain('custom');
  });

  test('church-vinyl-sticker cut option has only standard value (no custom-die-cut)', () => {
    const p = product('Church Vinyl Sticker');
    const cutOption = (p.options || []).find(o => o.optionId === 'cut');
    expect(cutOption).toBeDefined();
    expect(cutOption.values).toEqual(['standard']);
    expect(cutOption.values).not.toContain('custom-die-cut');
    expect(cutOption.values).not.toContain('die-cut');
  });

  test('batch 2 products have no sellable variants with custom/die-cut values', () => {
    // None of the batch 2 products should have custom size/shape in their fixed variant definitions.
    for (const name of Object.keys(batch2)) {
      const p = product(name);
      for (const v of (p.variants || [])) {
        for (const val of Object.values(v.selections)) {
          expect(String(val).toLowerCase()).not.toMatch(/custom|die.?cut/);
        }
      }
    }
  });
});

// ── REJECTED_ALLOCATION_KEYS / ALLOWED_CONFIGURATION_KEYS / REJECTED_CART_INPUT_KEYS ─

describe('Exported constant sets', () => {
  test('REJECTED_ALLOCATION_KEYS includes all browser-supplied allocation fields', () => {
    for (const key of ['price', 'unitPriceCents', 'lineTotalCents', 'physicalUnits', 'physicalQuantity',
      'pricingSnapshot', 'baseSku', 'sku', 'availability', 'availableForSale', 'sellable']) {
      expect(REJECTED_ALLOCATION_KEYS.has(key)).toBe(true);
    }
  });

  test('ALLOWED_CONFIGURATION_KEYS contains only schemaVersion and options', () => {
    expect([...ALLOWED_CONFIGURATION_KEYS].sort()).toEqual(['options', 'schemaVersion']);
  });

  test('REJECTED_CART_INPUT_KEYS includes baseSku, sku, physicalUnits, pricing, snapshot fields', () => {
    for (const key of ['baseSku', 'sku', 'physicalUnits', 'price', 'unitPriceCents',
      'lineTotalCents', 'pricingSnapshot', 'availability', 'availableForSale', 'sellable']) {
      expect(REJECTED_CART_INPUT_KEYS.has(key)).toBe(true);
    }
  });
});
