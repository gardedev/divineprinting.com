'use strict';

const { randomUUID } = require('crypto');

/**
 * Returns a fresh, unique product payload each time it is called.
 * Using a unique suffix per call ensures tests never collide on slug/name
 * even if table cleanup is not 100% synchronised.
 */
function makeProduct(overrides = {}) {
  const suffix = randomUUID().split('-')[0]; // short unique tail e.g. "a3f2c1b0"
  return {
    name: `Test Product ${suffix}`,
    description: `Integration test product (${suffix})`,
    basePrice: 1999,
    slug: `test-product-${suffix}`,
    category: 'test',
    ...overrides,
  };
}

/**
 * Preset product payloads – used to make test intent clear.
 * Still unique because makeProduct() generates a fresh suffix each call.
 */
function makeBusinessCard(overrides = {}) {
  return makeProduct({ name: `Business Cards ${randomUUID().split('-')[0]}`, basePrice: 2499, category: 'cards', ...overrides });
}

function makeFlyer(overrides = {}) {
  return makeProduct({ name: `Flyers ${randomUUID().split('-')[0]}`, basePrice: 999, category: 'flyers', ...overrides });
}

function makeBanner(overrides = {}) {
  return makeProduct({ name: `Banner ${randomUUID().split('-')[0]}`, basePrice: 5999, category: 'banners', ...overrides });
}

module.exports = { makeProduct, makeBusinessCard, makeFlyer, makeBanner };
