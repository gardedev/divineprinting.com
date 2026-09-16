'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function cartPage() {
  const document = { getElementById: () => null, addEventListener: () => {}, createElement: () => ({}) };
  const context = { document, Intl, setTimeout: () => {}, addEventListener: () => {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'js', 'cart-page.js'), 'utf8'), context);
  return context.DivineCartPage;
}

describe('Batch 1 cart authoritative unit-price rendering', () => {
  test('uses standard-product unitPriceCents', () => {
    expect(cartPage().authoritativeUnitPriceCents({ unitPriceCents: 2999 })).toBe(2999);
  });

  test('preserves configured-product configuredUnitPriceCents', () => {
    expect(cartPage().authoritativeUnitPriceCents({ configuredUnitPriceCents: 2050 })).toBe(2050);
  });

  test('does not invent an authoritative price when none is present', () => {
    expect(cartPage().authoritativeUnitPriceCents({})).toBeNull();
    expect(cartPage().authoritativeUnitPriceCents({ configuredUnitPriceCents: '2050', unitPriceCents: '2999' })).toBeNull();
  });
});
