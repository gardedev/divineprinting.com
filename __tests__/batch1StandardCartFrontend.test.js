'use strict';

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const pages = {
  'products/church-flyers-standard.html': { id: '46a21984-0f64-4d57-9202-0b591c266f9b', values: ['100', '250', '500', '1000'], mode: 'DISCRETE_SELECTION' },
  'products/church-magnets-business-card.html': { id: 'b2033b41-913f-46b8-8639-bd66dc1ab0fc', values: ['single', '25-pack', '50-pack', '100-pack'], mode: 'PACKAGE_SELECTION' },
  'products/church-stickers-round.html': { id: '8db500c6-c3ea-417f-8ce8-1c36940f36f6', values: ['2-inch', '3-inch'], mode: 'UNIT', quantity: '50' },
  'products/church-vinyl-banner-standard.html': { id: '476a47bd-932f-4a71-81cc-7b4506662206', values: ['2x4-ft', '3x6-ft', '4x8-ft'], mode: 'UNIT' },
  'products/church-yard-sign-standard.html': { id: '379c7176-5ab7-45b3-a87e-524b6ff35867', values: ['single', '5-pack', '10-pack'], mode: 'PACKAGE_SELECTION' },
  'products/rollup-banner-standard.html': { id: '30596774-a90b-4b33-ab94-9bcda66bf114', values: ['33x80-in'], mode: 'UNIT' },
};

describe('Batch 1 standard-product frontend contract', () => {
  test.each(Object.entries(pages))('%s uses only the shared adapter and canonical catalog values', (file, contract) => {
    const html = read(file);
    expect(html).toContain('/js/standard-product-cart.js');
    expect(html).toContain('data-add-standard-product');
    expect(html).toContain(`data-product-id="${contract.id}"`);
    expect(html).toContain(`data-quantity-mode="${contract.mode}"`);
    expect(html).toContain('href="/cart.html" class="header-icon cart-icon"');
    expect(html).toContain('class="cart-count" id="cart-count"');
    for (const value of contract.values) expect(html).toContain(`data-variant="${value}"`);
    expect(html).not.toMatch(/\.\.\/cart\.js|addToSnipcart|Snipcart\.api|Snipcart\.events|snipcart-checkout|snipcart-items-count|snipcart-add-item|data-item-/);
    expect(html).not.toMatch(/cdn\.snipcart/i);
  });

  test('sticker physical quantity has a valid default, minimum, increment, and safe feedback target', () => {
    const html = read('products/church-stickers-round.html');
    expect(html).toMatch(/data-cart-quantity[^>]*type="number"[^>]*min="50"[^>]*step="50"[^>]*value="50"/);
    expect(html).toContain('data-cart-error');
  });

  test.each([
    ['products/church-magnets-business-card.html', 'magnets'],
    ['products/church-yard-sign-standard.html', 'signs'],
  ])('%s exposes package physical-unit presentation without a browser price', (file, physicalLabel) => {
    const html = read(file);
    expect(html).toContain('data-package-units');
    expect(html).toContain(`data-physical-label="${physicalLabel}"`);
    expect(html).toContain('data-physical-quantity');
    expect(html).not.toMatch(/data-item-price|data-price|unitPriceCents/);
  });

  test('adapter sends selections and quantity only, validates obvious invalid quantities, and never submits a price', () => {
    const source = read('js/standard-product-cart.js');
    expect(source).toContain('global.DivineCart.addConfiguredJob');
    expect(source).toContain('function updateCartBadge');
    expect(source).toContain('global.toggleMobileMenu = toggleMobileMenu');
    expect(source).toContain("schemaVersion: 'standard-product-v1'");
    expect(source).toContain('variantAllocations');
    expect(source).toContain('quantity < minimum');
    expect(source).toContain('(quantity - minimum) % increment');
    expect(source).not.toMatch(/price(?:Cents)?\s*:/);
  });

  test('cart renderer displays authoritative standard names and package physical-unit summaries', () => {
    const source = read('js/cart-page.js');
    expect(source).toContain('function standardSummary');
    expect(source).toContain('pricingSnapshot?.productName');
    expect(source).toContain("quantityMode === 'PACKAGE_SELECTION'");
    expect(source).toContain('physicalQuantity');
    expect(source).toContain('physical units');
  });
});
