'use strict';

// Data-driven evaluator for catalog products that do not use the T-shirt design canvas.
// Prices and allowed selections are read exclusively from the approved product record.
const { canonical } = require('./configuredProduct');

class StandardConfiguredProductError extends Error {
  constructor(code, message = code) { super(message); this.name = 'StandardConfiguredProductError'; this.code = code; }
}

const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;

// REJECTED_ALLOCATION_KEYS: browser-supplied fields that must never appear in an allocation.
const REJECTED_ALLOCATION_KEYS = new Set([
  'price', 'unitPriceCents', 'lineTotalCents', 'physicalUnits', 'physicalQuantity',
  'pricingSnapshot', 'baseSku', 'sku', 'availability', 'availableForSale', 'sellable',
]);

// ALLOWED_CONFIGURATION_KEYS: only schemaVersion and options are permitted in customerConfiguration.
const ALLOWED_CONFIGURATION_KEYS = new Set(['schemaVersion', 'options']);

// REJECTED_CART_INPUT_KEYS: browser-supplied top-level fields rejected by the cart API.
const REJECTED_CART_INPUT_KEYS = new Set([
  'baseSku', 'sku', 'physicalUnits', 'price', 'unitPriceCents', 'lineTotalCents',
  'pricingSnapshot', 'availability', 'availableForSale', 'sellable',
]);

function optionValues(definition) {
  return (definition.values || []).map(value => object(value) ? (value.value ?? value.id) : value);
}

/**
 * Validate customerConfiguration strictly:
 * - Only schemaVersion and options are allowed as keys.
 * - Every declared required option must be present with an exact, case-sensitive value match.
 * - Undeclared options are rejected.
 */
function validateOptions(product, configuration) {
  if (!object(configuration)) throw new StandardConfiguredProductError('CART_INVALID_PERSONALIZATION');

  // Reject any key other than schemaVersion and options.
  for (const key of Object.keys(configuration)) {
    if (!ALLOWED_CONFIGURATION_KEYS.has(key)) throw new StandardConfiguredProductError('CART_INVALID_PERSONALIZATION');
  }

  const selected = configuration.options;
  if (selected === undefined) {
    // options may be absent only when the product has no options defined.
    if ((product.options || []).length > 0) throw new StandardConfiguredProductError('CART_INVALID_VARIATION');
    return {};
  }
  if (!object(selected)) throw new StandardConfiguredProductError('CART_INVALID_VARIATION');

  const definitions = new Map((product.options || []).map(entry => [entry.optionId, entry]));

  // Reject undeclared option keys.
  for (const key of Object.keys(selected)) {
    if (!definitions.has(key)) throw new StandardConfiguredProductError('CART_INVALID_VARIATION');
  }

  // Require every declared required option and validate exact type-sensitive value match.
  for (const [key, definition] of definitions) {
    const value = selected[key];
    if (definition.required) {
      if (value === undefined || value === null || value === '') throw new StandardConfiguredProductError('CART_INVALID_VARIATION');
      // Exact type-sensitive match required.
      if (!optionValues(definition).some(v => v === value)) throw new StandardConfiguredProductError('CART_INVALID_VARIATION');
    } else if (value !== undefined && value !== null && value !== '') {
      if (!optionValues(definition).some(v => v === value)) throw new StandardConfiguredProductError('CART_INVALID_VARIATION');
    }
  }
  return canonical(selected);
}

/**
 * Validate a single allocation object.
 * Allocation must contain only `selections` and `quantity`.
 * Any browser-supplied field (price, SKU, totals, physicalUnits, snapshots, availability, sellability)
 * is rejected, not silently ignored.
 */
function validateAllocation(allocation) {
  if (!object(allocation)) throw new StandardConfiguredProductError('CART_INVALID_VARIATION');
  for (const key of Object.keys(allocation)) {
    if (REJECTED_ALLOCATION_KEYS.has(key)) throw new StandardConfiguredProductError('CART_INVALID_VARIATION');
    if (key !== 'selections' && key !== 'quantity') throw new StandardConfiguredProductError('CART_INVALID_VARIATION');
  }
  if (!object(allocation.selections)) throw new StandardConfiguredProductError('CART_INVALID_VARIATION');
  if (!Number.isInteger(allocation.quantity) || allocation.quantity < 1) throw new StandardConfiguredProductError('CART_QUANTITY_INVALID');
}

/**
 * Validate a standard-configurable product definition as read from the seed/catalog.
 * Called during seeding to ensure the definition is internally consistent before persisting.
 */
function validateStandardConfigurableDefinition(product) {
  if (!object(product) || product.productType !== 'standard-configurable') {
    throw new Error('Product must be standard-configurable');
  }
  const dimensions = product.variantDimensions;
  if (!Array.isArray(dimensions) || dimensions.length === 0) {
    throw new Error('variantDimensions must be a non-empty array');
  }
  if (new Set(dimensions).size !== dimensions.length) {
    throw new Error('variantDimensions must be unique');
  }

  // Validate options definitions: unique optionIds, no overlap with dimensions.
  const options = product.options || [];
  const optionIds = options.map(o => o.optionId);
  if (new Set(optionIds).size !== optionIds.length) {
    throw new Error('options must have unique optionIds');
  }
  for (const optId of optionIds) {
    if (dimensions.includes(optId)) {
      throw new Error(`optionId "${optId}" conflicts with a variantDimension`);
    }
  }

  // Validate variants.
  const variants = product.variants || [];
  if (variants.length === 0) throw new Error('variants must be a non-empty array');
  const tupleSet = new Set();
  for (const variant of variants) {
    if (!object(variant) || !object(variant.selections)) {
      throw new Error('each variant must have a selections object');
    }
    const selKeys = Object.keys(variant.selections);
    // Require exactly the persisted variantDimensions, no more, no less.
    if (selKeys.length !== dimensions.length || !dimensions.every(d => variant.selections[d] !== undefined)) {
      throw new Error(`variant selections must contain exactly variantDimensions: ${dimensions.join(', ')}`);
    }
    if (!Number.isInteger(variant.unitPriceCents) || variant.unitPriceCents < 0) {
      throw new Error('each variant must have a valid non-negative integer unitPriceCents');
    }
    // No duplicate tuples.
    const tupleKey = JSON.stringify(canonical(Object.fromEntries(dimensions.map(d => [d, variant.selections[d]]))));
    if (tupleSet.has(tupleKey)) throw new Error(`duplicate variant tuple: ${tupleKey}`);
    tupleSet.add(tupleKey);
  }

  // Validate quantity rules.
  const minimum = product.minimumQuantity;
  const increment = product.quantityIncrement;
  if (minimum !== undefined && minimum !== null && (!Number.isInteger(minimum) || minimum < 1)) {
    throw new Error('minimumQuantity must be a positive integer when present');
  }
  if (increment !== undefined && increment !== null && (!Number.isInteger(increment) || increment < 1)) {
    throw new Error('quantityIncrement must be a positive integer when present');
  }

  return true;
}

function evaluateStandardConfiguredProduct(product, input, { now = () => new Date() } = {}) {
  if (!object(product) || product.productType !== 'standard-configurable') throw new StandardConfiguredProductError('CART_PRODUCT_UNAVAILABLE');
  if (!object(input)) throw new StandardConfiguredProductError('CART_INVALID_PERSONALIZATION');

  // Reject browser-supplied top-level pricing/SKU/snapshot fields.
  for (const key of Object.keys(input)) {
    if (REJECTED_CART_INPUT_KEYS.has(key)) throw new StandardConfiguredProductError('CART_INVALID_INPUT');
  }

  if (!object(input.customerConfiguration) || input.customerConfiguration.schemaVersion !== 'standard-product-v1') throw new StandardConfiguredProductError('CART_INVALID_PERSONALIZATION');

  const options = validateOptions(product, input.customerConfiguration);

  if (!Array.isArray(input.variantAllocations) || input.variantAllocations.length !== 1) throw new StandardConfiguredProductError('CART_INVALID_VARIATION');

  const rawAllocation = input.variantAllocations[0];
  validateAllocation(rawAllocation);

  const allocation = rawAllocation;
  const dimensions = product.variantDimensions || [];

  // Require exactly the persisted variantDimensions in selections — no missing, no additional keys.
  const selKeys = Object.keys(allocation.selections);
  if (selKeys.length !== dimensions.length || !dimensions.every(key => allocation.selections[key] !== undefined)) {
    throw new StandardConfiguredProductError('CART_INVALID_VARIATION');
  }

  // Exact type-sensitive value match against one persisted variant.
  const variant = (product.variants || []).find(entry =>
    dimensions.every(key => entry.selections?.[key] === allocation.selections[key])
  );
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

module.exports = { evaluateStandardConfiguredProduct, validateStandardConfigurableDefinition, StandardConfiguredProductError, REJECTED_ALLOCATION_KEYS, ALLOWED_CONFIGURATION_KEYS, REJECTED_CART_INPUT_KEYS };
