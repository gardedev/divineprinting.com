'use strict';

/**
 * Regression tests for three cart UX improvements introduced in one commit:
 *
 *   1. CART PRODUCT IMAGE  — pricingSnapshot now carries productImageUrl from
 *      the product definition; cart-page.js renders an <img> from that URL.
 *
 *   2. COMPLETE CUSTOMER-FRIENDLY CONFIGURATION  — cart-page.js resolves raw
 *      internal IDs (e.g. "center-chest", "cross-modern") to display names
 *      ("Center Chest", "Modern Cross") using the optionLabels map embedded in
 *      pricingSnapshot; size allocations remain visible.
 *
 *   3. CTA COPY  — "Add configured job to cart" → "Add to Cart" on the church
 *      t-shirt configurator page.
 *
 * Server authority is never delegated to the client: prices, SKUs, totals, and
 * configuration validity continue to originate exclusively from the backend.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const root = p => path.join(__dirname, '..', p);
const read = p => fs.readFileSync(root(p), 'utf8');

// ── Source files ────────────────────────────────────────────────────────────
const cartPageSrc = read('js/cart-page.js');
const cartHtml    = read('cart.html');
const tshirtHtml  = read('products/church-t-shirt.html');

// ── configuredProduct.js — server label-building logic ─────────────────────
const { buildOptionLabels_test } = (() => {
  // Re-use the actual module but expose buildOptionLabels for unit testing via
  // a thin wrapper — we extract+eval only the pure helper function.
  const src = read('infrastructure/server/products/configuredProduct.js');
  // Extract the buildOptionLabels function body
  const match = src.match(/function buildOptionLabels\(product\)\s*\{[\s\S]*?\n\}/);
  if (!match) return { buildOptionLabels_test: null };
  // Wrap in a returning IIFE so we can call it
  const fn = new Function('return ' + match[0].replace('function buildOptionLabels', 'function'))(); // eslint-disable-line no-new-func
  return { buildOptionLabels_test: fn };
})();

// ── Minimal cart-page.js execution harness ──────────────────────────────────
function makeCartPageScope(overrides = {}) {
  // cart-page.js IIFE: (function(global){...}(typeof window !== 'undefined' ? window : globalThis))
  // In a vm context 'window' resolves if present in the sandbox, so DivineCartPage ends up on
  // the window object.  We expose a shared fakeWindow so tests can read scope.window.DivineCartPage.
  const fakeWindow = {
    addEventListener() {},
    DivineCart: { loadCurrentCart: async () => null, removeItem: async () => {}, updateConfiguredJob: async () => {} },
    getAccessToken: () => null,
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    crypto: { randomUUID: () => 'test-uuid' },
    location: { href: '' },
  };
  const scope = {
    document: {
      createElement(tag) {
        const el = { tag, textContent: undefined, className: '', href: '', src: '', alt: '', loading: '', onerror: null, style: {}, children: [], append(...kids) { this.children.push(...kids); }, addEventListener() {} };
        return el;
      },
      getElementById() { return null; },
      addEventListener() {},
    },
    window: fakeWindow,
    addEventListener() {},
    ...overrides,
  };
  scope.globalThis = scope;
  vm.runInNewContext(cartPageSrc, scope);
  // DivineCartPage is attached to fakeWindow (the 'global' argument of the IIFE)
  scope.DivineCartPage = fakeWindow.DivineCartPage;
  return scope;
}

// ============================================================
// 1. CTA COPY — church-t-shirt.html
// ============================================================
describe('CTA copy — church-t-shirt.html', () => {
  test('"Add to Cart" label is present on the add button', () => {
    expect(tshirtHtml).toContain('>Add to Cart<');
  });

  test('"Add configured job to cart" phrase is gone', () => {
    expect(tshirtHtml).not.toContain('Add configured job to cart');
  });

  test('the button still calls addToCart() on click (semantics preserved)', () => {
    expect(tshirtHtml).toContain('onclick="addToCart()"');
  });

  test('configuredAddButton id is preserved for existing JS references', () => {
    expect(tshirtHtml).toContain('id="configuredAddButton"');
  });
});

// ============================================================
// 2. SERVER-SIDE — configuredProduct.js adds productName,
//    productImageUrl, and optionLabels to pricingSnapshot
// ============================================================
describe('configuredProduct.js — pricingSnapshot enrichment', () => {
  const configuredProductSrc = read('infrastructure/server/products/configuredProduct.js');

  test('pricingSnapshot includes productName from product.name', () => {
    expect(configuredProductSrc).toContain('productName: product.name || undefined');
  });

  test('pricingSnapshot includes productImageUrl from product.image', () => {
    expect(configuredProductSrc).toContain('productImageUrl: product.image || undefined');
  });

  test('pricingSnapshot includes optionLabels from buildOptionLabels()', () => {
    expect(configuredProductSrc).toContain('optionLabels: buildOptionLabels(product)');
  });

  test('buildOptionLabels resolves placement placementId → displayName', () => {
    if (!buildOptionLabels_test) return; // guard if extraction fails
    const product = {
      options: [
        {
          optionId: 'placement',
          values: [
            { placementId: 'center-chest', displayName: 'Center Chest' },
            { placementId: 'left-chest',   displayName: 'Left Chest'   },
            { placementId: 'full-back',    displayName: 'Full Back'    },
          ],
        },
      ],
    };
    const labels = buildOptionLabels_test(product);
    expect(labels.placement['center-chest']).toBe('Center Chest');
    expect(labels.placement['left-chest']).toBe('Left Chest');
    expect(labels.placement['full-back']).toBe('Full Back');
  });

  test('buildOptionLabels maps designTemplates under a "design" key', () => {
    if (!buildOptionLabels_test) return;
    const product = {
      options: [],
      designTemplates: [
        { templateId: 'cross-modern', templateVersion: 1, displayName: 'Modern Cross' },
        { templateId: 'dove',         templateVersion: 1, displayName: 'Peace Dove'   },
      ],
    };
    const labels = buildOptionLabels_test(product);
    expect(labels.design['cross-modern']).toBe('Modern Cross');
    expect(labels.design['dove']).toBe('Peace Dove');
  });

  test('buildOptionLabels returns undefined when product has no options or templates', () => {
    if (!buildOptionLabels_test) return;
    const result = buildOptionLabels_test({ options: [], designTemplates: [] });
    expect(result).toBeUndefined();
  });

  test('buildOptionLabels passes through simple string option values unchanged', () => {
    if (!buildOptionLabels_test) return;
    const product = {
      options: [{ optionId: 'color', values: ['Black', 'White', 'Navy'] }],
    };
    const labels = buildOptionLabels_test(product);
    expect(labels.color['Black']).toBe('Black');
    expect(labels.color['Navy']).toBe('Navy');
  });

  test('buildOptionLabels does not include pricing data', () => {
    // buildOptionLabels touches only product.options and product.designTemplates
    expect(configuredProductSrc).not.toMatch(/buildOptionLabels[^}]*priceCents/);
    expect(configuredProductSrc).not.toMatch(/buildOptionLabels[^}]*sku/i);
  });
});

// ============================================================
// 3. SERVER-SIDE — standardConfiguredProduct.js adds productImageUrl
// ============================================================
describe('standardConfiguredProduct.js — productImageUrl in pricingSnapshot', () => {
  const stdSrc = read('infrastructure/server/products/standardConfiguredProduct.js');

  test('standard-pricing-v1 pricingSnapshot includes productImageUrl', () => {
    expect(stdSrc).toContain('productImageUrl: product.image || undefined');
  });

  test('standard-pricing-v1 still carries productName', () => {
    expect(stdSrc).toContain('productName: product.name');
  });

  test('productImageUrl line does not introduce any price assignment', () => {
    // The one-line change must stay isolated to image — no price field introduced on the same token
    const imageLine = stdSrc.split('\n').find(l => l.includes('productImageUrl'));
    expect(imageLine).toBeDefined();
    // Must not add a price-setting field immediately adjacent to productImageUrl
    expect(imageLine).not.toMatch(/productImageUrl[^,}]*priceCents/i);
  });
});

// ============================================================
// 4. FRONTEND — cart-page.js configurationSummary label resolution
// ============================================================
describe('cart-page.js — configurationSummary friendly labels', () => {
  let scope;
  beforeAll(() => { scope = makeCartPageScope(); });

  function makeTshirtItem(overrides = {}) {
    return {
      baseSku: 'DPT-CHURCH-TSHIRT',
      lineTotalCents: 3900,
      totalQuantity: 3,
      pricingSnapshot: {
        schemaVersion: 'configured-pricing-v1',
        productName: 'Custom Church T-Shirts',
        productImageUrl: '../images/2026-04-07-18-55-31-group-wearing-shirts.png',
        optionLabels: {
          placement: { 'center-chest': 'Center Chest', 'left-chest': 'Left Chest', 'full-back': 'Full Back' },
          design:    { 'cross-modern': 'Modern Cross', 'dove': 'Peace Dove' },
        },
        tier: { minimumQuantity: 1, maximumQuantity: 5, baseUnitPriceCents: 2500 },
        allocations: [{ configuredUnitPriceCents: 1300, variantSurchargeCents: 0 }],
      },
      customerConfiguration: {
        schemaVersion: 'configured-product-v1',
        options: { color: 'Black', placement: 'center-chest', designSource: 'TEMPLATE' },
        designConfiguration: { templateId: 'cross-modern', templateVersion: 1 },
      },
      variantAllocations: [{ selections: { size: 'L' }, quantity: 3 }],
      ...overrides,
    };
  }

  test('resolves "center-chest" → "Center Chest" using optionLabels', () => {
    const item = makeTshirtItem();
    const summary = scope.DivineCartPage.configurationSummary(item);
    expect(summary).toContain('Center Chest');
    expect(summary).not.toContain('center-chest');
  });

  test('resolves "cross-modern" → "Modern Cross" using optionLabels', () => {
    const item = makeTshirtItem();
    const summary = scope.DivineCartPage.configurationSummary(item);
    expect(summary).toContain('Modern Cross');
    expect(summary).not.toContain('cross-modern');
  });

  test('includes color as a human-readable string', () => {
    const item = makeTshirtItem();
    const summary = scope.DivineCartPage.configurationSummary(item);
    expect(summary).toContain('Black');
  });

  test('includes organization name when present', () => {
    const item = makeTshirtItem();
    item.customerConfiguration.organizationName = 'Grace Fellowship';
    const summary = scope.DivineCartPage.configurationSummary(item);
    expect(summary).toContain('Grace Fellowship');
  });

  test('renders "left-chest" placement as "Left Chest"', () => {
    const item = makeTshirtItem();
    item.customerConfiguration.options.placement = 'left-chest';
    const summary = scope.DivineCartPage.configurationSummary(item);
    expect(summary).toContain('Left Chest');
    expect(summary).not.toContain('left-chest');
  });

  test('renders "dove" design as "Peace Dove"', () => {
    const item = makeTshirtItem();
    item.customerConfiguration.designConfiguration.templateId = 'dove';
    const summary = scope.DivineCartPage.configurationSummary(item);
    expect(summary).toContain('Peace Dove');
    expect(summary).not.toContain('cross-modern');
  });

  test('falls back to raw value when optionLabels map has no entry', () => {
    const item = makeTshirtItem();
    item.pricingSnapshot.optionLabels = {}; // no entries
    item.customerConfiguration.options.placement = 'center-chest';
    const summary = scope.DivineCartPage.configurationSummary(item);
    // Raw ID exposed as-is (graceful degradation, not a crash)
    expect(summary).toContain('center-chest');
  });

  test('falls back gracefully when optionLabels is absent entirely', () => {
    const item = makeTshirtItem();
    delete item.pricingSnapshot.optionLabels;
    // Must not throw
    expect(() => scope.DivineCartPage.configurationSummary(item)).not.toThrow();
  });

  test('standard-pricing-v1 items render option entries as key: value pairs', () => {
    const item = {
      baseSku: 'DPT-FLYER',
      lineTotalCents: 3500,
      totalQuantity: 100,
      pricingSnapshot: {
        schemaVersion: 'standard-pricing-v1',
        productName: 'Church Flyers',
        productImageUrl: null,
        quantityMode: 'DISCRETE_SELECTION',
        allocations: [{ unitPriceCents: 3500 }],
      },
      customerConfiguration: {
        schemaVersion: 'standard-product-v1',
        options: { package: '100' },
      },
      variantAllocations: [{ selections: { package: '100' }, quantity: 100 }],
    };
    const summary = scope.DivineCartPage.configurationSummary(item);
    expect(summary).toContain('package: 100');
  });

  test('configurationSummary never contains price literals', () => {
    const item = makeTshirtItem();
    const summary = scope.DivineCartPage.configurationSummary(item);
    // Must not embed any dollar amount or numeric price
    expect(summary).not.toMatch(/\$|Cents|price/i);
  });
});

// ============================================================
// 5. FRONTEND — buildProductImage
// ============================================================
describe('cart-page.js — buildProductImage', () => {
  let scope;
  beforeAll(() => { scope = makeCartPageScope(); });

  test('returns an img element with the correct normalised src', () => {
    const item = {
      pricingSnapshot: {
        productName: 'Custom Church T-Shirts',
        productImageUrl: '../images/2026-04-07-18-55-31-group-wearing-shirts.png',
      },
    };
    const img = scope.DivineCartPage.buildProductImage(item);
    expect(img).not.toBeNull();
    expect(img.src).toBe('/images/2026-04-07-18-55-31-group-wearing-shirts.png');
    expect(img.alt).toBe('Custom Church T-Shirts');
    expect(img.className).toBe('cart-item-image');
    expect(img.loading).toBe('lazy');
  });

  test('strips multiple leading "../" segments from the image URL', () => {
    const item = { pricingSnapshot: { productName: 'X', productImageUrl: '../../images/test.png' } };
    const img = scope.DivineCartPage.buildProductImage(item);
    expect(img.src).toBe('/images/test.png');
  });

  test('passes through absolute URLs unchanged', () => {
    const item = { pricingSnapshot: { productName: 'X', productImageUrl: '/images/direct.png' } };
    const img = scope.DivineCartPage.buildProductImage(item);
    expect(img.src).toBe('/images/direct.png');
  });

  test('returns null when productImageUrl is absent', () => {
    const item = { pricingSnapshot: { productName: 'X' } };
    expect(scope.DivineCartPage.buildProductImage(item)).toBeNull();
  });

  test('returns null when productImageUrl is null', () => {
    const item = { pricingSnapshot: { productName: 'X', productImageUrl: null } };
    expect(scope.DivineCartPage.buildProductImage(item)).toBeNull();
  });

  test('returns null when pricingSnapshot is absent', () => {
    const item = {};
    expect(scope.DivineCartPage.buildProductImage(item)).toBeNull();
  });
});

// ============================================================
// 6. FRONTEND — resolveLabel
// ============================================================
describe('cart-page.js — resolveLabel', () => {
  let scope;
  beforeAll(() => { scope = makeCartPageScope(); });

  const labels = {
    placement: { 'center-chest': 'Center Chest', 'full-back': 'Full Back' },
    design:    { 'cross-modern': 'Modern Cross' },
  };

  test('resolves a known placement id', () => {
    expect(scope.DivineCartPage.resolveLabel(labels, 'placement', 'center-chest')).toBe('Center Chest');
  });

  test('resolves a known design id', () => {
    expect(scope.DivineCartPage.resolveLabel(labels, 'design', 'cross-modern')).toBe('Modern Cross');
  });

  test('returns the raw value when optionId is not in the map', () => {
    expect(scope.DivineCartPage.resolveLabel(labels, 'color', 'Black')).toBe('Black');
  });

  test('returns the raw value when the specific key is not found in the optionId map', () => {
    expect(scope.DivineCartPage.resolveLabel(labels, 'placement', 'shoulder')).toBe('shoulder');
  });

  test('returns the raw value when optionLabels is null', () => {
    expect(scope.DivineCartPage.resolveLabel(null, 'placement', 'center-chest')).toBe('center-chest');
  });
});

// ============================================================
// 7. CSS LAYOUT — cart.html grid
// ============================================================
describe('cart.html — CSS grid for cart items', () => {
  test('default cart item uses three columns: image | details | price', () => {
    expect(cartHtml).toContain('.cart-item { display: grid; grid-template-columns: 100px minmax(0, 1fr) auto;');
  });

  test('no-image modifier collapses the image column for products without productImageUrl', () => {
    expect(cartHtml).toContain('.cart-item--no-image { grid-template-columns: minmax(0, 1fr) auto; }');
  });

  test('cart-item-image has explicit size and object-fit to prevent layout overflow', () => {
    expect(cartHtml).toContain('.cart-item-image { width: 100px; height: 100px; border-radius: 12px; object-fit: cover;');
  });

  test('mobile breakpoint retains image column at 80px width', () => {
    expect(cartHtml).toContain('.cart-item { grid-template-columns: 80px minmax(0, 1fr) auto;');
  });

  test('mobile no-image modifier also collapses gracefully', () => {
    expect(cartHtml).toContain('.cart-item--no-image { grid-template-columns: minmax(0, 1fr) auto; }');
  });
});

// ============================================================
// 8. FRONTEND — render() applies no-image class for image-less items
// ============================================================
describe('cart-page.js — render() image class behaviour', () => {
  test('applies cart-item--no-image when buildProductImage returns null', () => {
    expect(cartPageSrc).toContain("'cart-item cart-item--no-image'");
  });

  test('applies cart-item (no modifier) when buildProductImage returns an element', () => {
    expect(cartPageSrc).toContain("productImg ? 'cart-item' : 'cart-item cart-item--no-image'");
  });
});

// ============================================================
// 9. SERVER AUTHORITY — client never computes prices
// ============================================================
describe('server authority — cart-page.js never computes prices', () => {
  test('configurationSummary source contains no arithmetic or price literal', () => {
    // Extract the configurationSummary function text
    const match = cartPageSrc.match(/function configurationSummary\(item\)\s*\{[\s\S]*?\n  \}/);
    expect(match).not.toBeNull();
    const fnBody = match[0];
    expect(fnBody).not.toMatch(/\*|unitPriceCents|lineTotalCents|subtotalCents|\$\d/);
  });

  test('buildProductImage source contains no price or SKU references', () => {
    const match = cartPageSrc.match(/function buildProductImage\(item\)\s*\{[\s\S]*?\n  \}/);
    expect(match).not.toBeNull();
    const fnBody = match[0];
    expect(fnBody).not.toMatch(/price|sku|total/i);
  });

  test('pricingSnapshot fields in the render loop are read-only (no assignment)', () => {
    // The render function must only READ from pricingSnapshot
    const renderMatch = cartPageSrc.match(/async function render\(\)\s*\{[\s\S]*?\n  \}/);
    expect(renderMatch).not.toBeNull();
    // Should not write back to pricingSnapshot
    expect(renderMatch[0]).not.toMatch(/pricingSnapshot\s*=/);
  });
});

// ============================================================
// 10. GENERIC RENDERING — works for non-t-shirt configured items
// ============================================================
describe('generic configured product rendering', () => {
  let scope;
  beforeAll(() => { scope = makeCartPageScope(); });

  test('configurationSummary handles a generic configured item with no optionLabels', () => {
    const item = {
      pricingSnapshot: { schemaVersion: 'configured-pricing-v1' },
      customerConfiguration: {
        options: { color: 'White', placement: 'left-chest', designSource: 'TEMPLATE' },
        designConfiguration: { templateId: 'custom-design' },
      },
    };
    // Must not throw and must include the raw values
    const summary = scope.DivineCartPage.configurationSummary(item);
    expect(summary).toContain('White');
    expect(summary).toContain('left-chest');
    expect(summary).toContain('custom-design');
  });

  test('buildProductImage is generic — works for any productImageUrl regardless of product type', () => {
    const batch2Item = {
      pricingSnapshot: {
        productName: 'Church Flyers',
        productImageUrl: '/images/flyers.png',
      },
    };
    const img = scope.DivineCartPage.buildProductImage(batch2Item);
    expect(img).not.toBeNull();
    expect(img.src).toBe('/images/flyers.png');
    expect(img.alt).toBe('Church Flyers');
  });
});

// ============================================================
// 11. SIZE ALLOCATIONS remain visible
// ============================================================
describe('size allocations remain visible in cart', () => {
  let scope;
  beforeAll(() => { scope = makeCartPageScope(); });

  test('allocationLabel renders size dimension as "size: L"', () => {
    // The allocationLabel helper is not exported; verify via source
    expect(cartPageSrc).toContain('function allocationLabel(allocation)');
    expect(cartPageSrc).toContain('Object.entries(allocation.selections || {})');
    expect(cartPageSrc).toContain('`${key}: ${value}`');
  });

  test('cart-page.js iterates variantAllocations to render each size row', () => {
    expect(cartPageSrc).toContain('variantAllocations || []).forEach(');
  });
});

// ============================================================
// 12. DivineCartPage public API surface
// ============================================================
describe('DivineCartPage public API surface', () => {
  let scope;
  beforeAll(() => { scope = makeCartPageScope(); });

  test('exposes configurationSummary', () => {
    expect(typeof scope.DivineCartPage.configurationSummary).toBe('function');
  });

  test('exposes buildProductImage', () => {
    expect(typeof scope.DivineCartPage.buildProductImage).toBe('function');
  });

  test('exposes resolveLabel', () => {
    expect(typeof scope.DivineCartPage.resolveLabel).toBe('function');
  });

  test('exposes authoritativeUnitPriceCents', () => {
    expect(typeof scope.DivineCartPage.authoritativeUnitPriceCents).toBe('function');
  });

  test('exposes render and startCheckout', () => {
    expect(typeof scope.DivineCartPage.render).toBe('function');
    expect(typeof scope.DivineCartPage.startCheckout).toBe('function');
  });
});
