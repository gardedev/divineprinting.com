'use strict';

// Data-driven evaluator for catalog products that do not use the T-shirt design canvas.
// Prices and allowed selections are read exclusively from the approved product record.
const { canonical } = require('./configuredProduct');

class StandardConfiguredProductError extends Error {
  constructor(code, message = code) { super(message); this.name = 'StandardConfiguredProductError'; this.code = code; }
}

const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

function optionValues(definition) {
  return (definition.values || []).map(value => object(value) ? (value.value ?? value.id) : value);
}

function validateOptions(product, configuration) {
  const selected = configuration.options || {};
  if (!object(selected)) throw new StandardConfiguredProductError('CART_INVALID_VARIATION');
  const definitions = new Map((product.options || []).map(entry => [entry.optionId, entry]));
  for (const key of Object.keys(selected)) if (!definitions.has(key)) throw new StandardConfiguredProductError('CART_INVALID_VARIATION');
  for (const [key, definition] of definitions) {
    const value = selected[key];
    if (definition.required && (value === undefined || value === '')) throw new StandardConfiguredProductError('CART_INVALID_VARIATION');
    if (value !== undefined && !optionValues(definition).includes(value)) throw new StandardConfiguredProductError('CART_INVALID_VARIATION');
  }
  return canonical(selected);
}

function evaluateStandardConfiguredProduct(product, input, { now = () => new Date() } = {}) {
  if (!object(product) || product.productType !== 'standard-configurable') throw new StandardConfiguredProductError('CART_PRODUCT_UNAVAILABLE');
  if (!object(input) || !object(input.customerConfiguration) || input.customerConfiguration.schemaVersion !== 'standard-product-v1') throw new StandardConfiguredProductError('CART_INVALID_PERSONALIZATION');
  const options = validateOptions(product, input.customerConfiguration);
  if (!Array.isArray(input.variantAllocations) || input.variantAllocations.length !== 1) throw new StandardConfiguredProductError('CART_INVALID_VARIATION');
  const allocation = input.variantAllocations[0];
  if (!object(allocation) || !object(allocation.selections) || !Number.isInteger(allocation.quantity) || allocation.quantity < 1) throw new StandardConfiguredProductError('CART_QUANTITY_INVALID');
  const dimensions = product.variantDimensions || [];
  if (Object.keys(allocation.selections).length !== dimensions.length || dimensions.some(key => allocation.selections[key] === undefined)) throw new StandardConfiguredProductError('CART_INVALID_VARIATION');
  const variant = (product.variants || []).find(entry => dimensions.every(key => entry.selections?.[key] === allocation.selections[key]));
  if (!variant || !Number.isInteger(variant.unitPriceCents) || variant.unitPriceCents < 0) throw new StandardConfiguredProductError('CART_INVALID_VARIATION');
  const mode = product.quantityMode || 'UNIT';
  // Package and discrete selections carry their physical-unit count in the
  // catalog variant. A discrete selection is still one cart allocation, but
  // its selected catalog package (for example, 100 flyers) is the physical
  // quantity for minimum and increment validation.
  const multiplier = mode === 'PACKAGE_SELECTION' || mode === 'DISCRETE_SELECTION' ? variant.physicalUnits : 1;
  if (!Number.isInteger(multiplier) || multiplier < 1) throw new StandardConfiguredProductError('CART_PRICE_CHANGED');
  if (mode === 'DISCRETE_SELECTION' && allocation.quantity !== 1) throw new StandardConfiguredProductError('CART_QUANTITY_INVALID');
  const physicalQuantity = allocation.quantity * multiplier;
  const minimum = product.minimumQuantity || 1;
  const increment = product.quantityIncrement || 1;
  if (physicalQuantity < minimum || (physicalQuantity - minimum) % increment !== 0) throw new StandardConfiguredProductError('CART_QUANTITY_INVALID');
  const lineTotalCents = allocation.quantity * variant.unitPriceCents;
  if (!Number.isSafeInteger(lineTotalCents)) throw new StandardConfiguredProductError('CART_PRICE_CHANGED');
  const customerConfiguration = canonical({ schemaVersion: 'standard-product-v1', options });
  const priced = { selections: canonical(allocation.selections), quantity: allocation.quantity, physicalQuantity, unitPriceCents: variant.unitPriceCents, lineTotalCents };
  return {
    baseSku: product.sku, customerConfiguration, variantAllocations: [{ selections: priced.selections, quantity: priced.quantity }], totalQuantity: physicalQuantity,
    pricingSnapshot: { schemaVersion: 'standard-pricing-v1', productName: product.name, productVersion: product.version, pricingVersion: product.pricingVersion, currency: 'USD', quantityMode: mode, allocations: [priced], subtotalCents: lineTotalCents, calculatedAt: now().toISOString() },
    lineTotalCents, dedupeVersion: 'standard-configured-v1',
  };
}

module.exports = { evaluateStandardConfiguredProduct, StandardConfiguredProductError };
