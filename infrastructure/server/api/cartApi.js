'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const { jwtAuth } = require('../middleware/jwtAuth');
const { requireGroup } = require('../middleware/authorization');

const SIMPLE = 'SIMPLE';
const CONFIGURED_JOB = 'CONFIGURED_JOB';
const SIMPLE_ADD_FIELDS = new Set(['itemType', 'productId', 'quantity', 'sku', 'variation', 'options', 'personalization', 'designId', 'uploadId']);
const CONFIGURED_ADD_FIELDS = new Set(['itemType', 'productId', 'variantAllocations', 'customerConfiguration', 'customerInstructions']);
const SIMPLE_UPDATE_FIELDS = new Set(['itemType', 'quantity']);
const CONFIGURED_UPDATE_FIELDS = new Set(['itemType', 'variantAllocations', 'customerConfiguration', 'customerInstructions']);

const STATUS_BY_CODE = Object.freeze({
  CART_INVALID_INPUT: 400,
  CART_TOKEN_INVALID: 401,
  CUSTOMER_REQUIRED: 403,
  CART_NOT_FOUND: 404,
  CART_ITEM_NOT_FOUND: 404,
  CART_ACCESS_DENIED: 404,
  OWNERSHIP_REQUIRED: 404,
  CART_VERSION_CONFLICT: 409,
  CART_IDEMPOTENCY_CONFLICT: 409,
  CART_INSTRUCTIONS_CONFLICT: 409,
  CART_CONFIGURATION_CONFLICT: 409,
  CART_CHECKOUT_IN_PROGRESS: 409,
  CART_PENDING_CHECKOUT_LOCKED: 409,
  CART_ABANDONED: 409,
  CART_ALREADY_CONVERTED: 409,
  CART_EXPIRED: 410,
  CART_ITEM_TOO_LARGE: 413,
  CART_PRODUCT_UNAVAILABLE: 422,
  CART_PRODUCT_CHANGED: 422,
  CART_PRICE_CHANGED: 422,
  CART_CURRENCY_MISMATCH: 422,
  CART_INVALID_VARIATION: 422,
  CART_INVALID_PERSONALIZATION: 422,
  CART_QUANTITY_INVALID: 422,
  CART_QUANTITY_LIMIT_EXCEEDED: 422,
  CART_INVENTORY_UNAVAILABLE: 422,
  CART_ASSET_REFERENCE_INVALID: 422,
});

const SAFE_MESSAGES = Object.freeze({
  CART_INVALID_INPUT: 'The cart request is invalid.',
  CART_TOKEN_INVALID: 'The anonymous cart credential is invalid.',
  CART_NOT_FOUND: 'Cart not found.',
  CART_ITEM_NOT_FOUND: 'Cart item not found.',
  CART_VERSION_CONFLICT: 'The cart changed. Reload it and try again.',
  CART_IDEMPOTENCY_CONFLICT: 'The mutation key was already used for a different request.',
  CART_INSTRUCTIONS_CONFLICT: 'The cart items contain conflicting customer instructions.',
  CART_CONFIGURATION_CONFLICT: 'That configuration already exists as another cart item.',
  CART_EXPIRED: 'The cart has expired.',
  CART_ITEM_TOO_LARGE: 'The configured cart item is too large.',
  CART_ASSET_REFERENCE_INVALID: 'Custom artwork is not available for this cart configuration.',
});

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function invalidInput(message = 'The cart request is invalid.') {
  const error = new Error(message);
  error.code = 'CART_INVALID_INPUT';
  return error;
}

function tokenInvalid() {
  const error = new Error('Invalid anonymous cart credential');
  error.code = 'CART_TOKEN_INVALID';
  return error;
}

function assertExactFields(body, allowed) {
  if (!plainObject(body) || Object.keys(body).some((key) => !allowed.has(key))) throw invalidInput();
}

function requiredHeader(req, name) {
  const value = req.get(name);
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw invalidInput(`${name} is required.`);
  return value.trim();
}

function positiveVersion(value, name) {
  const match = typeof value === 'string' && value.trim().match(/^"?([1-9]\d*)"?$/);
  if (!match || !Number.isSafeInteger(Number(match[1]))) throw invalidInput(`${name} must be a positive integer.`);
  return Number(match[1]);
}

function mutationTransport(req, { itemVersion = false } = {}) {
  return {
    mutationId: requiredHeader(req, 'Idempotency-Key'),
    expectedCartVersion: positiveVersion(requiredHeader(req, 'If-Match'), 'If-Match'),
    ...(itemVersion ? { expectedItemVersion: positiveVersion(requiredHeader(req, 'X-Cart-Item-Version'), 'X-Cart-Item-Version') } : {}),
  };
}

function customerContext(req) {
  return { type: 'customer', sub: req.auth.sub };
}

function anonymousContext(req) {
  const raw = req.get('X-Cart-Token');
  if (typeof raw !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(raw)) throw tokenInvalid();
  return { type: 'anonymous', anonymousSessionHash: crypto.createHash('sha256').update(raw).digest('hex') };
}

function sanitizeAssetReferences(value) {
  if (Array.isArray(value)) return value.map(sanitizeAssetReferences);
  if (!plainObject(value)) return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['storageKey', 'anonymousSessionHash', 'customerId', 'dedupeKey', 'idempotencyRecords', 'fingerprint', 'fulfillment', 'productionMethod', 'productionStatus', 'internalProductionNotes'].includes(key))
    .map(([key, entry]) => [key, sanitizeAssetReferences(entry)]));
}

function sanitizeCart(cart) {
  if (!cart) return null;
  const fields = ['cartId', 'cartType', 'status', 'currency', 'subtotalCents', 'discountCents', 'taxCents', 'shippingCents', 'totalCents', 'validationStatus', 'validationErrors', 'expiresAt', 'createdAt', 'updatedAt', 'version'];
  return Object.fromEntries(fields.filter((key) => cart[key] !== undefined).map((key) => [key, sanitizeAssetReferences(cart[key])]));
}

function sanitizeItem(item) {
  if (!item) return null;
  const fields = ['cartItemId', 'cartItemType', 'productId', 'sku', 'baseSku', 'quantity', 'totalQuantity', 'currency', 'unitPriceCents', 'lineTotalCents', 'variation', 'options', 'personalization', 'designId', 'uploadId', 'variantAllocations', 'customerConfiguration', 'customerInstructions', 'pricingSnapshot', 'productVersion', 'pricingVersion', 'dedupeVersion', 'validationStatus', 'validationErrors', 'inventoryStatus', 'createdAt', 'updatedAt', 'version'];
  return Object.fromEntries(fields.filter((key) => item[key] !== undefined).map((key) => [key, sanitizeAssetReferences(item[key])]));
}

function sendCart(res, state, extra = {}) {
  const cart = sanitizeCart(state.cart);
  if (cart?.version) res.set('ETag', `"${cart.version}"`);
  return res.status(extra.status || 200).json({ success: true, cart, items: (state.items || []).map(sanitizeItem), warnings: [], ...extra.body });
}

function sendError(res, error, { anonymousCredential = false } = {}) {
  let code = error?.code;
  if (anonymousCredential && ['CART_NOT_FOUND', 'CART_ACCESS_DENIED', 'OWNERSHIP_REQUIRED'].includes(code)) code = 'CART_TOKEN_INVALID';
  else if (['CART_ACCESS_DENIED', 'OWNERSHIP_REQUIRED'].includes(code)) code = 'CART_NOT_FOUND';
  if (!STATUS_BY_CODE[code]) code = 'CART_API_FAILED';
  const status = STATUS_BY_CODE[code] || 500;
  const message = SAFE_MESSAGES[code] || (status === 500 ? 'An unexpected cart error occurred.' : 'The cart request could not be completed.');
  return res.status(status).json({ error: message, code });
}

function asyncRoute(handler, options) {
  return async (req, res) => {
    try { return await handler(req, res); } catch (error) { return sendError(res, error, options); }
  };
}

function createCartRouter({ cartService, productService, jwtAuthMiddleware = jwtAuth, tokenGenerator = () => crypto.randomBytes(32).toString('base64url') } = {}) {
  const router = Router();
  const service = cartService || require('../carts/cartService').createCartService({ productService });
  const requireCustomer = requireGroup('customer');

  async function loadAnonymous(req) {
    const context = anonymousContext(req);
    let state;
    try { state = await service.getCurrentCart(context); } catch (error) {
      if (['CART_NOT_FOUND', 'CART_ACCESS_DENIED', 'OWNERSHIP_REQUIRED'].includes(error?.code)) throw tokenInvalid();
      throw error;
    }
    if (state?.cart?.cartId !== req.params.cartId) throw tokenInvalid();
    return { context, state };
  }

  async function loadCustomer(req) {
    const context = customerContext(req);
    return { context, state: await service.getCurrentCart(context) };
  }

  async function mutate(req, res, load) {
    const { context, state } = await load(req);
    const cartId = state.cart.cartId;
    const itemType = req.body?.itemType;
    if (req.method === 'POST') {
      const transport = mutationTransport(req);
      if (itemType === SIMPLE) {
        assertExactFields(req.body, SIMPLE_ADD_FIELDS);
        if (typeof req.body.productId !== 'string' || !Number.isInteger(req.body.quantity)) throw invalidInput();
        const { itemType: _itemType, ...item } = req.body;
        await service.addItem({ context, cartId, ...transport, item });
      } else if (itemType === CONFIGURED_JOB) {
        assertExactFields(req.body, CONFIGURED_ADD_FIELDS);
        if (typeof req.body.productId !== 'string' || !Array.isArray(req.body.variantAllocations) || !plainObject(req.body.customerConfiguration)) throw invalidInput();
        const { itemType: _itemType, ...item } = req.body;
        await service.addItem({ context, cartId, ...transport, item: { ...item, cartItemType: CONFIGURED_JOB } });
      } else throw invalidInput();
    } else if (req.method === 'PATCH') {
      const transport = mutationTransport(req, { itemVersion: true });
      if (itemType === SIMPLE) {
        assertExactFields(req.body, SIMPLE_UPDATE_FIELDS);
        if (!Number.isInteger(req.body.quantity)) throw invalidInput();
        await service.updateItemQuantity({ context, cartId, cartItemId: req.params.cartItemId, ...transport, quantity: req.body.quantity });
      } else if (itemType === CONFIGURED_JOB) {
        assertExactFields(req.body, CONFIGURED_UPDATE_FIELDS);
        if (req.body.variantAllocations !== undefined && !Array.isArray(req.body.variantAllocations)) throw invalidInput();
        if (req.body.customerConfiguration !== undefined && !plainObject(req.body.customerConfiguration)) throw invalidInput();
        await service.updateConfiguredJob({ context, cartId, cartItemId: req.params.cartItemId, ...transport, variantAllocations: req.body.variantAllocations, customerConfiguration: req.body.customerConfiguration, customerInstructions: req.body.customerInstructions });
      } else throw invalidInput();
    } else {
      const transport = mutationTransport(req, { itemVersion: true });
      await service.removeItem({ context, cartId, cartItemId: req.params.cartItemId, ...transport });
    }
    return sendCart(res, await service.getCurrentCart(context));
  }

  router.post('/anonymous', asyncRoute(async (_req, res) => {
    const token = tokenGenerator();
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Invalid token generator output');
    const context = { type: 'anonymous', anonymousSessionHash: crypto.createHash('sha256').update(token).digest('hex') };
    const cart = await service.createCart(context);
    return sendCart(res, { cart, items: [] }, { status: 201, body: { cartToken: token } });
  }));
  router.get('/anonymous/:cartId', asyncRoute(async (req, res) => sendCart(res, (await loadAnonymous(req)).state), { anonymousCredential: true }));
  router.post('/anonymous/:cartId/items', asyncRoute((req, res) => mutate(req, res, loadAnonymous), { anonymousCredential: true }));
  router.patch('/anonymous/:cartId/items/:cartItemId', asyncRoute((req, res) => mutate(req, res, loadAnonymous), { anonymousCredential: true }));
  router.delete('/anonymous/:cartId/items/:cartItemId', asyncRoute((req, res) => mutate(req, res, loadAnonymous), { anonymousCredential: true }));

  router.get('/current', jwtAuthMiddleware, requireCustomer, asyncRoute(async (req, res) => sendCart(res, (await loadCustomer(req)).state)));
  router.post('/current/items', jwtAuthMiddleware, requireCustomer, asyncRoute((req, res) => mutate(req, res, loadCustomer)));
  router.patch('/current/items/:cartItemId', jwtAuthMiddleware, requireCustomer, asyncRoute((req, res) => mutate(req, res, loadCustomer)));
  router.delete('/current/items/:cartItemId', jwtAuthMiddleware, requireCustomer, asyncRoute((req, res) => mutate(req, res, loadCustomer)));
  return router;
}

module.exports = { createCartRouter, sanitizeCart, sanitizeItem, STATUS_BY_CODE };
