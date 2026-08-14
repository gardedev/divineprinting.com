'use strict';

const MAX_CONFIGURED_JOB_QUANTITY = 10000;
const MAX_ALLOCATIONS = 100;
const MAX_CONFIGURATION_BYTES = 128 * 1024;
const PRICING_SNAPSHOT_VERSION = 'configured-pricing-v1';
const DEDUPE_VERSION = 'configured-job-v1';
const FORBIDDEN_CUSTOMER_KEYS = new Set([
  'price', 'unitPrice', 'unitPriceCents', 'lineTotal', 'lineTotalCents', 'subtotalCents', 'totalCents',
  'pricingSnapshot', 'productionMethod', 'internalProductionNotes', 'productionStatus',
  'supplierGarmentMapping', 'productionIdentifiers', 'fulfillment', 'customerId', 'owner',
  'role', 'roles', 'groups', 'isAdmin', 'accessToken', 'idToken', 'refreshToken',
]);

class ConfiguredProductError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'ConfiguredProductError';
    this.code = code;
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function serializedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function assertSafeCustomerData(value, path = 'customerConfiguration', depth = 0) {
  if (depth > 12) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', `${path} is too deeply nested`);
  if (typeof value === 'string') {
    if (value.length > 5000 || /^\s*(?:data:|blob:)/i.test(value) || /;base64,/i.test(value)) {
      throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', `${path} contains unsafe embedded data`);
    }
    return;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean' || value === undefined) return;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', `${path} cannot contain binary data`);
  }
  if (Array.isArray(value)) {
    if (value.length > 200) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', `${path} has too many values`);
    value.forEach((entry, index) => assertSafeCustomerData(entry, `${path}[${index}]`, depth + 1));
    return;
  }
  if (!plainObject(value)) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', `${path} must contain JSON data only`);
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_CUSTOMER_KEYS.has(key)) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', `${path}.${key} is not customer-controlled`);
    assertSafeCustomerData(entry, `${path}.${key}`, depth + 1);
  }
}

function optionValues(definition) {
  return (definition.values || []).map((entry) => plainObject(entry)
    ? entry[`${definition.optionId}Id`] ?? entry.value ?? entry.id
    : entry);
}

function validateOptions(product, configuration) {
  const selected = configuration.options || {};
  if (!plainObject(selected)) throw new ConfiguredProductError('CART_INVALID_VARIATION');
  const definitions = new Map((product.options || []).map((entry) => [entry.optionId, entry]));
  for (const key of Object.keys(selected)) {
    if (!definitions.has(key)) throw new ConfiguredProductError('CART_INVALID_VARIATION', `Unsupported option: ${key}`);
  }
  for (const [optionId, definition] of definitions) {
    const value = selected[optionId];
    if (definition.required && (value === undefined || value === null || value === '')) throw new ConfiguredProductError('CART_INVALID_VARIATION', `${optionId} is required`);
    if (value !== undefined && !optionValues(definition).includes(value)) throw new ConfiguredProductError('CART_INVALID_VARIATION', `${optionId} is unsupported`);
  }
  return canonical(selected);
}

function matchingVariant(product, selections) {
  return (product.variants || []).find((variant) => Object.entries(selections).every(([key, value]) => variant[key] === value));
}

function normalizeAllocations(product, allocations) {
  if (!Array.isArray(allocations) || allocations.length === 0 || allocations.length > MAX_ALLOCATIONS) {
    throw new ConfiguredProductError('CART_QUANTITY_INVALID');
  }
  const dimensions = product.quantityPricing?.aggregatableDimensions;
  if (!Array.isArray(dimensions) || dimensions.length === 0) throw new ConfiguredProductError('CART_INVALID_VARIATION', 'Product has no aggregatable dimensions');
  const combined = new Map();
  for (const allocation of allocations) {
    if (!plainObject(allocation) || !plainObject(allocation.selections)) throw new ConfiguredProductError('CART_INVALID_VARIATION');
    const keys = Object.keys(allocation.selections).sort();
    if (keys.length !== dimensions.length || keys.some((key) => !dimensions.includes(key)) || dimensions.some((key) => !keys.includes(key))) throw new ConfiguredProductError('CART_INVALID_VARIATION');
    if (!Number.isInteger(allocation.quantity) || allocation.quantity < 1) throw new ConfiguredProductError('CART_QUANTITY_INVALID');
    const selections = canonical(allocation.selections);
    const variant = matchingVariant(product, selections);
    if (!variant) throw new ConfiguredProductError('CART_INVALID_VARIATION');
    if (variant.surchargeCents !== undefined && (!Number.isInteger(variant.surchargeCents) || variant.surchargeCents < 0)) {
      throw new ConfiguredProductError('CART_PRICE_CHANGED');
    }
    const key = JSON.stringify(selections);
    const prior = combined.get(key);
    const quantity = (prior?.quantity || 0) + allocation.quantity;
    if (!Number.isSafeInteger(quantity)) throw new ConfiguredProductError('CART_QUANTITY_LIMIT_EXCEEDED');
    combined.set(key, { selections, quantity, variantSurchargeCents: variant.surchargeCents || 0 });
  }
  return [...combined.values()].sort((left, right) => JSON.stringify(left.selections).localeCompare(JSON.stringify(right.selections)));
}

function boundedPlainText(value, maximumLength, field, { optional = true } = {}) {
  if (value === undefined || value === null || value === '') {
    if (optional) return undefined;
    throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', `${field} is required`);
  }
  if (typeof value !== 'string') throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', `${field} must be plain text`);
  const trimmed = value.trim();
  if (!trimmed && optional) return undefined;
  if (trimmed.length > maximumLength) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', `${field} is too long`);
  return trimmed;
}

function validateDesignConfiguration(product, configuration) {
  const design = configuration.designConfiguration;
  if (!plainObject(design)) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', 'designConfiguration is required');
  const snapshot = product.designSnapshot || {};
  const canvas = snapshot.canvas || {};
  const geometry = design.designGeometry;
  if (snapshot.persistResolvedCoordinates) {
    if (!plainObject(geometry) || !Number.isFinite(geometry.x) || !Number.isFinite(geometry.y) || !Number.isFinite(design.designScale)) {
      throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', 'Resolved design geometry and scale are required');
    }
    if (geometry.x < 0 || geometry.x > canvas.width || geometry.y < 0 || geometry.y > canvas.height) {
      throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', 'Design cannot be completely outside the canvas');
    }
    const scale = snapshot.allowedDesignScale || {};
    if (design.designScale < scale.minimum || design.designScale > scale.maximum) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', 'Design scale is unsupported');
  }

  const customization = product.customization || {};
  const organizationRule = customization.organizationName;
  const organizationName = organizationRule
    ? boundedPlainText(configuration.organizationName, organizationRule.maximumLength, 'organizationName')
    : configuration.organizationName;
  const elements = design.textElements || [];
  if (!Array.isArray(elements)) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', 'textElements must be an array');
  const organizationElements = elements.filter((entry) => entry?.elementRole === 'organizationName');
  const additionalElements = elements.filter((entry) => entry?.elementRole !== 'organizationName');
  if (organizationElements.length > 1 || additionalElements.length > (customization.additionalTextElements?.maximumElements ?? 200)) {
    throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', 'Too many text elements');
  }
  const fontIds = new Set((customization.fonts || []).map((entry) => entry.fontId));
  const orders = new Set();
  for (const element of elements) {
    if (!plainObject(element)) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION');
    const maximum = element.elementRole === 'organizationName' ? organizationRule?.maximumLength : customization.additionalTextElements?.maximumLengthPerElement;
    const text = boundedPlainText(element.text, maximum || 5000, 'text element', { optional: false });
    if (element.elementRole === 'organizationName' && text !== organizationName) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', 'Rendered organization name must match organizationName');
    if (fontIds.size && !fontIds.has(element.fontId)) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', 'Unsupported font');
    if (!/^#[0-9A-Fa-f]{6}$/.test(element.color || '')) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', 'Invalid text color');
    if (!Number.isInteger(element.fontSize) || element.fontSize < customization.fontSize?.minimum || element.fontSize > customization.fontSize?.maximum) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', 'Invalid text size');
    if (!Number.isInteger(element.archDegrees) || element.archDegrees < customization.archDegrees?.minimum || element.archDegrees > customization.archDegrees?.maximum) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', 'Invalid text arch');
    if (!Number.isFinite(element.position?.x) || !Number.isFinite(element.position?.y) || element.position.x < 0 || element.position.x > canvas.width || element.position.y < 0 || element.position.y > canvas.height) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', 'Invalid text position');
    if (!Number.isInteger(element.order) || orders.has(element.order)) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', 'Text order must be unique integers');
    orders.add(element.order);
  }
  return canonical({ ...configuration, ...(organizationName ? { organizationName } : { organizationName: undefined }), designConfiguration: { ...design, textElements: elements.map((entry) => ({ ...entry, text: entry.text.trim(), color: entry.color.toUpperCase() })) } });
}

function readPath(value, path) {
  return String(path || '').split('.').filter(Boolean).reduce((current, key) => current?.[key], value);
}

function applicableSurcharges(product, configuration) {
  return (product.quantityPricing?.customizationSurcharges || []).filter((rule) =>
    readPath(configuration, rule.optionPath) === rule.equals).map((rule) => {
    if (!['PER_UNIT', 'PER_JOB'].includes(rule.application) || !Number.isInteger(rule.amountCents) || rule.amountCents < 0) {
      throw new ConfiguredProductError('CART_PRICE_CHANGED');
    }
    return { surchargeId: rule.surchargeId, application: rule.application, amountCents: rule.amountCents };
  });
}

async function trustedAssets(product, configuration, assetVerifier) {
  const source = configuration.options?.designSource;
  const references = configuration.assetReferences || [];
  if (source !== 'CUSTOM_ARTWORK') {
    if (references.length) throw new ConfiguredProductError('CART_ASSET_REFERENCE_INVALID');
    return [];
  }
  if (!Array.isArray(references) || references.length === 0 || typeof assetVerifier !== 'function') {
    throw new ConfiguredProductError('CART_ASSET_REFERENCE_INVALID');
  }
  const verified = [];
  for (const reference of references) {
    const trusted = await assetVerifier(reference);
    if (!plainObject(trusted) || !trusted.assetId || !trusted.storageKey || !trusted.mediaType || trusted.uploadStatus !== 'ready') {
      throw new ConfiguredProductError('CART_ASSET_REFERENCE_INVALID');
    }
    const accepted = product.designSnapshot?.customArtwork?.acceptedMediaTypes;
    if (Array.isArray(accepted) && !accepted.includes(trusted.mediaType)) throw new ConfiguredProductError('CART_ASSET_REFERENCE_INVALID');
    verified.push(canonical({ assetId: trusted.assetId, storageKey: trusted.storageKey, originalFilename: trusted.originalFilename, mediaType: trusted.mediaType, uploadStatus: trusted.uploadStatus }));
  }
  return verified;
}

async function evaluateConfiguredProduct(product, input, { assetVerifier, now = () => new Date() } = {}) {
  if (!plainObject(product) || product.productType !== 'configurable') throw new ConfiguredProductError('CART_PRODUCT_UNAVAILABLE');
  if (product.currency !== 'USD') throw new ConfiguredProductError('CART_CURRENCY_MISMATCH');
  if (!plainObject(input) || !plainObject(input.customerConfiguration)) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION');
  assertSafeCustomerData(input.customerConfiguration);
  if (serializedBytes(input.customerConfiguration) > MAX_CONFIGURATION_BYTES) throw new ConfiguredProductError('CART_ITEM_TOO_LARGE');

  const expectedSchema = product.designSnapshot?.schemaVersion;
  const expectedCanvas = product.designSnapshot?.canvasVersion;
  if (input.customerConfiguration.schemaVersion !== expectedSchema || input.customerConfiguration.designConfiguration?.canvasVersion !== expectedCanvas) {
    throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', 'Unsupported configuration schema or canvas version');
  }
  const options = validateOptions(product, input.customerConfiguration);
  const designSource = options.designSource;
  if (designSource === 'TEMPLATE') {
    const selected = (product.designTemplates || []).find((entry) => entry.templateId === input.customerConfiguration.designConfiguration?.templateId && entry.templateVersion === input.customerConfiguration.designConfiguration?.templateVersion);
    if (!selected) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION', 'Unsupported template');
  }
  const assetReferences = await trustedAssets(product, { ...input.customerConfiguration, options }, assetVerifier);
  const customerConfiguration = validateDesignConfiguration(product, canonical({ ...input.customerConfiguration, options, assetReferences }));
  const variantAllocations = normalizeAllocations(product, input.variantAllocations);
  const totalQuantity = variantAllocations.reduce((sum, entry) => sum + entry.quantity, 0);
  const technicalMaximum = MAX_CONFIGURED_JOB_QUANTITY;
  const productMaximum = Number.isInteger(product.maximumQuantity) ? Math.min(product.maximumQuantity, technicalMaximum) : technicalMaximum;
  const productMinimum = Number.isInteger(product.minimumQuantity) ? Math.max(1, product.minimumQuantity) : 1;
  const increment = Number.isInteger(product.quantityIncrement) && product.quantityIncrement > 0 ? product.quantityIncrement : 1;
  if (totalQuantity < productMinimum || totalQuantity > productMaximum || (totalQuantity - productMinimum) % increment !== 0) {
    throw new ConfiguredProductError(totalQuantity > productMaximum ? 'CART_QUANTITY_LIMIT_EXCEEDED' : 'CART_QUANTITY_INVALID');
  }
  const tier = (product.quantityPricing?.tiers || []).find((entry) => totalQuantity >= entry.minimumQuantity && (entry.maximumQuantity === null || totalQuantity <= entry.maximumQuantity));
  if (!tier || !Number.isInteger(tier.baseUnitPriceCents) || tier.baseUnitPriceCents < 0) throw new ConfiguredProductError('CART_PRICE_CHANGED');
  const surcharges = applicableSurcharges(product, customerConfiguration);
  const perUnitSurchargeCents = surcharges.filter((entry) => entry.application === 'PER_UNIT').reduce((sum, entry) => sum + entry.amountCents, 0);
  const perJobSurchargeCents = surcharges.filter((entry) => entry.application === 'PER_JOB').reduce((sum, entry) => sum + entry.amountCents, 0);
  const pricedAllocations = variantAllocations.map((entry) => {
    const configuredUnitPriceCents = tier.baseUnitPriceCents + entry.variantSurchargeCents + perUnitSurchargeCents;
    const lineTotalCents = configuredUnitPriceCents * entry.quantity;
    if (!Number.isSafeInteger(lineTotalCents)) throw new ConfiguredProductError('CART_PRICE_CHANGED');
    return { ...entry, baseUnitPriceCents: tier.baseUnitPriceCents, customizationSurchargeCents: perUnitSurchargeCents, configuredUnitPriceCents, lineTotalCents };
  });
  const allocationsSubtotal = pricedAllocations.reduce((sum, entry) => sum + entry.lineTotalCents, 0);
  const subtotalCents = allocationsSubtotal + perJobSurchargeCents;
  if (!Number.isSafeInteger(subtotalCents)) throw new ConfiguredProductError('CART_PRICE_CHANGED');
  const instructionMaximum = product.customization?.customerInstructions?.maximumLength || 500;
  const customerInstructions = typeof input.customerInstructions === 'string' ? input.customerInstructions.trim() : '';
  if (input.customerInstructions !== undefined && input.customerInstructions !== null && typeof input.customerInstructions !== 'string') {
    throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION');
  }
  if (customerInstructions.length > instructionMaximum) throw new ConfiguredProductError('CART_INVALID_PERSONALIZATION');
  return {
    baseSku: product.sku,
    customerConfiguration,
    variantAllocations: pricedAllocations.map(({ baseUnitPriceCents, customizationSurchargeCents, configuredUnitPriceCents, lineTotalCents, ...entry }) => entry),
    totalQuantity,
    customerInstructions: customerInstructions || undefined,
    pricingSnapshot: {
      schemaVersion: PRICING_SNAPSHOT_VERSION,
      productVersion: product.version,
      pricingVersion: product.pricingVersion,
      currency: product.currency || 'USD',
      ruleId: product.quantityPricing.ruleId || `${product.productId}:quantity-pricing`,
      ruleVersion: product.quantityPricing.ruleVersion || product.pricingVersion,
      totalQuantity,
      tier: { minimumQuantity: tier.minimumQuantity, maximumQuantity: tier.maximumQuantity, baseUnitPriceCents: tier.baseUnitPriceCents },
      allocations: pricedAllocations,
      customizationSurcharges: surcharges,
      perJobSurchargeCents,
      subtotalCents,
      calculatedAt: now().toISOString(),
    },
    lineTotalCents: subtotalCents,
    dedupeVersion: DEDUPE_VERSION,
  };
}

module.exports = {
  evaluateConfiguredProduct,
  ConfiguredProductError,
  canonical,
  constants: { MAX_CONFIGURED_JOB_QUANTITY, MAX_ALLOCATIONS, MAX_CONFIGURATION_BYTES, PRICING_SNAPSHOT_VERSION, DEDUPE_VERSION },
};
