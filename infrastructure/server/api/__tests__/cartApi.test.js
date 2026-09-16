'use strict';

const crypto = require('crypto');
const express = require('express');
const request = require('supertest');
jest.mock('../../carts/cartService', () => ({ createCartService: jest.fn(() => ({})) }));
jest.mock('../../utils/logger', () => ({ error: jest.fn(), info: jest.fn(), warn: jest.fn() }));
const logger = require('../../utils/logger');
const { createCartRouter } = require('../cartApi');

const TOKEN = 'A'.repeat(43);
const HASH = crypto.createHash('sha256').update(TOKEN).digest('hex');
const baseCart = { cartId: 'cart-1', cartType: 'customer', customerId: 'trusted-sub', status: 'active', currency: 'USD', subtotalCents: 0, totalCents: 0, version: 3, idempotencyRecords: [{ fingerprint: 'secret' }] };

function jwt(mode = 'customer') {
  return (req, res, next) => {
    if (mode === 'missing') return res.status(401).json({ code: 'AUTH_REQUIRED' });
    const groups = mode === 'customer' ? ['customer'] : mode === 'admin-customer' ? ['admin', 'customer'] : [mode];
    req.auth = { sub: 'trusted-sub', groups };
    return next();
  };
}

function setup({ mode = 'customer', service: overrides = {} } = {}) {
  const service = {
    createCart: jest.fn().mockResolvedValue({ ...baseCart, cartType: 'anonymous', customerId: undefined, status: 'draft', version: 1 }),
    getCurrentCart: jest.fn().mockImplementation(async (context) => ({ cart: context.type === 'anonymous' ? { ...baseCart, cartType: 'anonymous', customerId: undefined, anonymousSessionHash: context.anonymousSessionHash } : baseCart, items: [] })),
    addItem: jest.fn().mockResolvedValue({}), updateItemQuantity: jest.fn().mockResolvedValue({}), updateConfiguredJob: jest.fn().mockResolvedValue({}), removeItem: jest.fn().mockResolvedValue(true),
    claimAnonymousCart: jest.fn().mockResolvedValue({ cart: baseCart, items: [], warnings: [] }),
    ...overrides,
  };
  const app = express();
  app.use(express.json({ limit: '256kb' }));
  app.use('/api/carts', createCartRouter({ cartService: service, jwtAuthMiddleware: jwt(mode), tokenGenerator: () => TOKEN }));
  app.use((error, _req, res, _next) => res.status(error.type === 'entity.too.large' ? 413 : 400).json({ code: error.type === 'entity.too.large' ? 'CART_ITEM_TOO_LARGE' : 'CART_INVALID_INPUT' }));
  return { app, service };
}

function mutationHeaders(req, { item = false } = {}) {
  let result = req.set('Idempotency-Key', 'mutation-1').set('If-Match', '"3"');
  if (item) result = result.set('X-Cart-Item-Version', '2');
  return result;
}

describe('shopping cart API', () => {
  test('creates a 256-bit anonymous credential, stores only its hash, and returns it once', async () => {
    const { app, service } = setup();
    const response = await request(app).post('/api/carts/anonymous').expect(201);
    expect(response.body.cartToken).toBe(TOKEN);
    expect(service.createCart).toHaveBeenCalledWith({ type: 'anonymous', anonymousSessionHash: HASH });
    expect(JSON.stringify(service.createCart.mock.calls)).not.toContain(TOKEN);
    expect(response.body.cart).not.toHaveProperty('anonymousSessionHash');
    expect(response.headers.etag).toBe('"1"');
  });

  test('reads an anonymous cart using X-Cart-Token without returning the credential or hash', async () => {
    const { app } = setup();
    const response = await request(app).get('/api/carts/anonymous/cart-1').set('X-Cart-Token', TOKEN).expect(200);
    expect(response.body).toMatchObject({ success: true, cart: { cartId: 'cart-1' }, items: [], warnings: [] });
    expect(JSON.stringify(response.body)).not.toContain(TOKEN);
    expect(JSON.stringify(response.body)).not.toContain(HASH);
  });

  test.each([undefined, 'bad-token'])('returns the same non-enumerating failure for missing/invalid anonymous credentials', async (token) => {
    const { app } = setup();
    let call = request(app).get('/api/carts/anonymous/does-not-exist');
    if (token) call = call.set('X-Cart-Token', token);
    const response = await call.expect(401);
    expect(response.body.code).toBe('CART_TOKEN_INVALID');
  });

  test('does not let a valid token address a different cart id', async () => {
    const { app } = setup();
    await request(app).get('/api/carts/anonymous/other').set('X-Cart-Token', TOKEN).expect(401).expect(({ body }) => expect(body.code).toBe('CART_TOKEN_INVALID'));
  });

  test('uses the anonymous token hash for mutation ownership and never forwards the raw token', async () => {
    const { app, service } = setup();
    await mutationHeaders(request(app).post('/api/carts/anonymous/cart-1/items').set('X-Cart-Token', TOKEN)).send({ itemType: 'SIMPLE', productId: 'p1', quantity: 1 }).expect(200);
    expect(service.addItem).toHaveBeenCalledWith(expect.objectContaining({ context: { type: 'anonymous', anonymousSessionHash: HASH }, cartId: 'cart-1' }));
    expect(JSON.stringify(service.addItem.mock.calls)).not.toContain(TOKEN);
  });

  test('does not disguise an unexpected anonymous lookup failure as an invalid token', async () => {
    const { app } = setup({ service: { getCurrentCart: jest.fn().mockRejectedValue(new Error('DynamoDB unavailable')) } });
    await request(app).get('/api/carts/anonymous/cart-1').set('X-Cart-Token', TOKEN).expect(500).expect(({ body }) => expect(body.code).toBe('CART_API_FAILED'));
  });

  test('uses verified Cognito sub and exact customer group for current cart', async () => {
    const { app, service } = setup({ mode: 'admin-customer' });
    await request(app).get('/api/carts/current?customerId=attacker').expect(200);
    expect(service.getCurrentCart).toHaveBeenCalledWith({ type: 'customer', sub: 'trusted-sub' });
  });

  test.each(['admin', 'system'])('denies a %s-only identity', async (mode) => {
    await request(setup({ mode }).app).get('/api/carts/current').expect(403).expect(({ body }) => expect(body.code).toBe('CUSTOMER_REQUIRED'));
  });

  test('requires authentication for current-cart routes', async () => {
    await request(setup({ mode: 'missing' }).app).get('/api/carts/current').expect(401);
  });

  test('claims using verified Cognito sub, hashed anonymous credential, idempotency, and both versions', async () => {
    const { app, service } = setup();
    const response = await request(app).post('/api/carts/current/claim')
      .set('X-Cart-Token', TOKEN).set('Idempotency-Key', 'claim-1').set('If-Match', '3').set('X-Anonymous-Cart-Version', '7')
      .send({ anonymousCartId: 'anonymous-cart' }).expect(200);
    expect(service.claimAnonymousCart).toHaveBeenCalledWith({
      context: { type: 'customer', sub: 'trusted-sub' },
      anonymousContext: { type: 'anonymous', anonymousSessionHash: HASH },
      anonymousCartId: 'anonymous-cart', expectedCustomerVersion: 3, expectedAnonymousVersion: 7, mutationId: 'claim-1',
    });
    expect(JSON.stringify(service.claimAnonymousCart.mock.calls)).not.toContain(TOKEN);
    expect(response.body.warnings).toEqual([]);
  });

  test('rejects client identity/pricing fields and missing claim transport', async () => {
    const { app, service } = setup();
    await request(app).post('/api/carts/current/claim')
      .set('X-Cart-Token', TOKEN).set('Idempotency-Key', 'claim-1').set('If-Match', '3').set('X-Anonymous-Cart-Version', '7')
      .send({ anonymousCartId: 'anonymous-cart', customerId: 'attacker' }).expect(400);
    await request(app).post('/api/carts/current/claim').set('X-Cart-Token', TOKEN).send({ anonymousCartId: 'anonymous-cart' }).expect(400);
    expect(service.claimAnonymousCart).not.toHaveBeenCalled();
  });

  test('adds a SIMPLE item using only approved customer-selectable fields and reloads canonical state', async () => {
    const { app, service } = setup();
    await mutationHeaders(request(app).post('/api/carts/current/items')).send({ itemType: 'SIMPLE', productId: 'p1', quantity: 2, options: { finish: 'matte' } }).expect(200);
    expect(service.addItem).toHaveBeenCalledWith(expect.objectContaining({ context: { type: 'customer', sub: 'trusted-sub' }, cartId: 'cart-1', expectedCartVersion: 3, mutationId: 'mutation-1', item: expect.objectContaining({ productId: 'p1', quantity: 2 }) }));
    expect(service.getCurrentCart).toHaveBeenCalledTimes(2);
  });

  test.each(['fulfillment', 'productionMethod', 'pricingSnapshot', 'dedupeKey', 'customerId', 'groups'])('rejects client-controlled SIMPLE field %s', async (field) => {
    const { app, service } = setup();
    await mutationHeaders(request(app).post('/api/carts/current/items')).send({ itemType: 'SIMPLE', productId: 'p1', quantity: 1, [field]: {} }).expect(400);
    expect(service.addItem).not.toHaveBeenCalled();
  });

  test('forwards a generic T-shirt-shaped CONFIGURED_JOB without accepting prices', async () => {
    const { app, service } = setup();
    const customerConfiguration = {
      schemaVersion: 'custom-design-v1',
      options: { garment: 'standard-unisex', color: 'Black', designSource: 'TEMPLATE', placement: 'center-chest' },
      organizationName: 'Grace Church',
      designConfiguration: { canvasVersion: 'tshirt-800-v1', templateId: 'modern-cross', templateVersion: 1, designGeometry: { x: 400, y: 300 }, designScale: 1, textElements: [{ text: 'Grace', fontId: 'cinzel', color: '#FFFFFF', fontSize: 36, position: { x: 400, y: 400 }, archDegrees: 0, order: 1 }] },
    };
    const allocations = [{ selections: { size: 'M' }, quantity: 10 }, { selections: { size: '2XL' }, quantity: 5 }];
    await mutationHeaders(request(app).post('/api/carts/current/items')).send({ itemType: 'CONFIGURED_JOB', productId: 'shirt', variantAllocations: allocations, customerConfiguration, customerInstructions: 'Center carefully' }).expect(200);
    expect(service.addItem).toHaveBeenCalledWith(expect.objectContaining({ item: { cartItemType: 'CONFIGURED_JOB', productId: 'shirt', variantAllocations: allocations, customerConfiguration, customerInstructions: 'Center carefully' } }));
  });

  test('updates SIMPLE quantity with required cart and item versions', async () => {
    const { app, service } = setup();
    await mutationHeaders(request(app).patch('/api/carts/current/items/item-1'), { item: true }).send({ itemType: 'SIMPLE', quantity: 4 }).expect(200);
    expect(service.updateItemQuantity).toHaveBeenCalledWith(expect.objectContaining({ expectedCartVersion: 3, expectedItemVersion: 2, quantity: 4 }));
  });

  test('updates generic configuration and allocations through the configured service method', async () => {
    const { app, service } = setup(); const replacement = { schemaVersion: 'v2' };
    await mutationHeaders(request(app).patch('/api/carts/current/items/item-1'), { item: true }).send({ itemType: 'CONFIGURED_JOB', customerConfiguration: replacement, variantAllocations: [{ selections: { size: 'L' }, quantity: 20 }] }).expect(200);
    expect(service.updateConfiguredJob).toHaveBeenCalledWith(expect.objectContaining({ customerConfiguration: replacement, expectedCartVersion: 3, expectedItemVersion: 2 }));
  });

  test('removes an item with idempotency and both expected versions', async () => {
    const { app, service } = setup();
    await mutationHeaders(request(app).delete('/api/carts/current/items/item-1'), { item: true }).expect(200);
    expect(service.removeItem).toHaveBeenCalledWith(expect.objectContaining({ mutationId: 'mutation-1', expectedCartVersion: 3, expectedItemVersion: 2 }));
  });

  test.each([
    ['Idempotency-Key', { 'If-Match': '3' }],
    ['If-Match', { 'Idempotency-Key': 'm' }],
    ['X-Cart-Item-Version', { 'Idempotency-Key': 'm', 'If-Match': '3' }],
  ])('requires %s on applicable mutations', async (_name, headers) => {
    const { app } = setup();
    await request(app).patch('/api/carts/current/items/i').set(headers).send({ itemType: 'SIMPLE', quantity: 1 }).expect(400);
  });

  test.each([
    ['CART_IDEMPOTENCY_CONFLICT', 409], ['CART_VERSION_CONFLICT', 409], ['CART_INSTRUCTIONS_CONFLICT', 409], ['CART_CONFIGURATION_CONFLICT', 409],
    ['CART_EXPIRED', 410], ['CART_ITEM_TOO_LARGE', 413], ['CART_INVALID_PERSONALIZATION', 422], ['CART_ASSET_REFERENCE_INVALID', 422],
  ])('maps %s to safe HTTP %i', async (code, status) => {
    const error = Object.assign(new Error('do not expose infrastructure detail'), { code });
    const { app } = setup({ service: { addItem: jest.fn().mockRejectedValue(error) } });
    const response = await mutationHeaders(request(app).post('/api/carts/current/items')).send({ itemType: 'SIMPLE', productId: 'p', quantity: 1 }).expect(status);
    expect(response.body.code).toBe(code);
    expect(JSON.stringify(response.body)).not.toContain('infrastructure');
  });

  test.each(['CART_ACCESS_DENIED', 'OWNERSHIP_REQUIRED'])('normalizes %s to non-enumerating CART_NOT_FOUND', async (code) => {
    const error = Object.assign(new Error('ownership detail'), { code });
    const { app } = setup({ service: { getCurrentCart: jest.fn().mockRejectedValue(error) } });
    const response = await request(app).get('/api/carts/current').expect(404);
    expect(response.body.code).toBe('CART_NOT_FOUND');
    expect(JSON.stringify(response.body)).not.toContain('ownership');
  });

  test('sanitizes internal identity, idempotency, dedupe, asset storage, and fulfillment data', async () => {
    const item = { cartItemId: 'i', cartItemType: 'CONFIGURED_JOB', productId: 'p', dedupeKey: 'secret-dedupe', customerConfiguration: { assetReferences: [{ assetId: 'a', storageKey: 'private/key', mediaType: 'image/png' }], fulfillment: { productionMethod: 'internal' } }, pricingSnapshot: { subtotalCents: 100 }, version: 1 };
    const { app } = setup({ service: { getCurrentCart: jest.fn().mockResolvedValue({ cart: baseCart, items: [item] }) } });
    const response = await request(app).get('/api/carts/current').expect(200);
    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toMatch(/secret-dedupe|private\/key|fingerprint|customerId|productionMethod|fulfillment/);
    expect(response.body.items[0].customerConfiguration.assetReferences[0]).toMatchObject({ assetId: 'a', mediaType: 'image/png' });
    expect(response.body.items[0].pricingSnapshot.subtotalCents).toBe(100);
  });

  test('returns safe 500 for unexpected failures', async () => {
    const internal = Object.assign(new Error('Validation failed for qa@example.com with A'.concat('x'.repeat(60))), {
      name: 'ValidationException',
      $metadata: { requestId: 'aws-request-id' },
    });
    const { app } = setup({ service: { getCurrentCart: jest.fn().mockRejectedValue(internal) } });
    const response = await request(app).get('/api/carts/current').expect(500);
    expect(response.body).toEqual({ error: 'An unexpected cart error occurred.', code: 'CART_API_FAILED' });
    expect(logger.error).toHaveBeenCalledWith('Unexpected cart request failure', expect.objectContaining({
      operation: 'GET /current', errorName: 'ValidationException', awsRequestId: 'aws-request-id',
    }));
    expect(JSON.stringify(logger.error.mock.calls)).not.toMatch(/qa@example\.com|Axxxxxxxx|Validation failed/);
  });

  test('does not log expected safe cart errors as internal failures', async () => {
    logger.error.mockClear();
    const error = Object.assign(new Error('expected conflict'), { code: 'CART_VERSION_CONFLICT' });
    const { app } = setup({ service: { getCurrentCart: jest.fn().mockRejectedValue(error) } });
    await request(app).get('/api/carts/current').expect(409);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
