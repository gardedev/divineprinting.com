'use strict';

/**
 * Integration tests – Admin product routes
 *
 * Boundary: HTTP → Express → ProductService → ProductRepository → DynamoDB Local
 *
 * Routes under test (all require auth):
 *   POST   /api/admin/products
 *   GET    /api/admin/products
 *   GET    /api/admin/products/:id
 *   PUT    /api/admin/products/:id
 *   DELETE /api/admin/products/:id
 *
 * Two app instances are used:
 *   - protectedApp  → production adminAuth (deny-by-default, 503)
 *   - bypassApp     → test-only middleware bypass (for testing route logic)
 */

const request = require('supertest');
const { resetIntegrationTable } = require('../helpers/dynamoLocal');
const { createTestApp, createAuthBypassApp, integrationRepository } = require('../helpers/testApp');
const { makeProduct } = require('../fixtures/products');

// ---------------------------------------------------------------------------
// App instances
// ---------------------------------------------------------------------------

let protectedApp; // Uses real adminAuth → always 503
let bypassApp;    // Uses test-only bypass → exercises route logic

beforeAll(() => {
  protectedApp = createTestApp();
  bypassApp = createAuthBypassApp();
});

beforeEach(async () => {
  await resetIntegrationTable();
}, 20000);

// ===========================================================================
// Authentication – deny-by-default (503)
// ===========================================================================

describe('Admin authentication – deny-by-default', () => {
  const ADMIN_ROUTES = [
    { method: 'post',   path: '/api/admin/products' },
    { method: 'get',    path: '/api/admin/products' },
    { method: 'get',    path: '/api/admin/products/some-id' },
    { method: 'put',    path: '/api/admin/products/some-id' },
    { method: 'delete', path: '/api/admin/products/some-id' },
  ];

  for (const { method, path } of ADMIN_ROUTES) {
    it(`${method.toUpperCase()} ${path} returns 503 when no auth is configured`, async () => {
      const res = await request(protectedApp)[method](path).send({});

      expect(res.status).toBe(503);
      expect(res.body).toHaveProperty('error');
      expect(res.body).toHaveProperty('code', 'AUTH_NOT_CONFIGURED');
    });
  }
});

// ===========================================================================
// POST /api/admin/products  (auth bypassed)
// ===========================================================================

describe('POST /api/admin/products', () => {
  it('creates a product and returns 201 with the created product', async () => {
    const payload = makeProduct();

    const res = await request(bypassApp)
      .post('/api/admin/products')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('product');
    expect(res.body.product.name).toBe(payload.name);
    expect(res.body.product.basePrice).toBe(payload.basePrice);
    expect(res.body.product.slug).toBe(payload.slug);
    expect(res.body.product.productId).toBeDefined();
    expect(res.body.product.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('persists the product to DynamoDB (retrievable after creation)', async () => {
    const payload = makeProduct();

    const createRes = await request(bypassApp)
      .post('/api/admin/products')
      .send(payload);

    expect(createRes.status).toBe(201);
    const { productId } = createRes.body.product;

    // Verify directly via repository
    const stored = await integrationRepository.getProductById(productId);
    expect(stored).not.toBeNull();
    expect(stored.name).toBe(payload.name);
  });

  it('returns 400 when name is missing', async () => {
    const { name: _unused, ...noName } = makeProduct();

    const res = await request(bypassApp)
      .post('/api/admin/products')
      .send(noName);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when basePrice is missing', async () => {
    const { basePrice: _unused, ...noPrice } = makeProduct();

    const res = await request(bypassApp)
      .post('/api/admin/products')
      .send(noPrice);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when basePrice is a float (must be integer cents)', async () => {
    const payload = makeProduct({ basePrice: 19.99 });

    const res = await request(bypassApp)
      .post('/api/admin/products')
      .send(payload);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/basePrice must be/i);
  });

  it('returns 400 when basePrice is negative', async () => {
    const payload = makeProduct({ basePrice: -100 });

    const res = await request(bypassApp)
      .post('/api/admin/products')
      .send(payload);

    expect(res.status).toBe(400);
  });

  it('allows basePrice of 0 (free product)', async () => {
    const payload = makeProduct({ basePrice: 0 });

    const res = await request(bypassApp)
      .post('/api/admin/products')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.product.basePrice).toBe(0);
  });

  it('stores a description when provided', async () => {
    const payload = makeProduct({ description: 'Premium matte finish' });

    const res = await request(bypassApp)
      .post('/api/admin/products')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.product.description).toBe('Premium matte finish');
  });

  it('generates a slug when not provided', async () => {
    const { slug: _unused, ...noSlug } = makeProduct();
    const payload = { ...noSlug, name: 'My Awesome Product' };

    const res = await request(bypassApp)
      .post('/api/admin/products')
      .send(payload);

    expect(res.status).toBe(201);
    expect(res.body.product.slug).toBeDefined();
    expect(res.body.product.slug.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// GET /api/admin/products  (auth bypassed)
// ===========================================================================

describe('GET /api/admin/products', () => {
  it('returns 200 with empty array when no products exist', async () => {
    const res = await request(bypassApp).get('/api/admin/products');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(res.body.products).toHaveLength(0);
  });

  it('returns all products including those not publicly visible', async () => {
    await integrationRepository.createProduct(makeProduct());
    await integrationRepository.createProduct(makeProduct());

    const res = await request(bypassApp).get('/api/admin/products');

    expect(res.status).toBe(200);
    expect(res.body.products.length).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// GET /api/admin/products/:id  (auth bypassed)
// ===========================================================================

describe('GET /api/admin/products/:id', () => {
  it('returns 200 with the product when found by UUID', async () => {
    const payload = makeProduct();
    const created = await integrationRepository.createProduct(payload);

    const res = await request(bypassApp)
      .get(`/api/admin/products/${created.productId}`);

    expect(res.status).toBe(200);
    expect(res.body.product.productId).toBe(created.productId);
    expect(res.body.product.name).toBe(payload.name);
  });

  it('returns 404 when product ID does not exist', async () => {
    const res = await request(bypassApp)
      .get('/api/admin/products/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

// ===========================================================================
// PUT /api/admin/products/:id  (auth bypassed)
// ===========================================================================

describe('PUT /api/admin/products/:id', () => {
  it('updates a product and returns 200 with updated attributes', async () => {
    const payload = makeProduct();
    const created = await integrationRepository.createProduct(payload);

    const res = await request(bypassApp)
      .put(`/api/admin/products/${created.productId}`)
      .send({ name: 'Updated Name', basePrice: 5000 });

    expect(res.status).toBe(200);
    expect(res.body.product.name).toBe('Updated Name');
    expect(res.body.product.basePrice).toBe(5000);
  });

  it('updates updatedAt timestamp', async () => {
    const payload = makeProduct();
    const created = await integrationRepository.createProduct(payload);

    // Small delay to ensure updatedAt will differ
    await new Promise(r => setTimeout(r, 10));

    const res = await request(bypassApp)
      .put(`/api/admin/products/${created.productId}`)
      .send({ name: 'Timestamp Check' });

    expect(res.status).toBe(200);
    expect(res.body.product.updatedAt).not.toBe(created.updatedAt);
  });

  it('returns 400 when no update fields are provided', async () => {
    const payload = makeProduct();
    const created = await integrationRepository.createProduct(payload);

    const res = await request(bypassApp)
      .put(`/api/admin/products/${created.productId}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('returns 404 when updating a non-existent product', async () => {
    const res = await request(bypassApp)
      .put('/api/admin/products/00000000-0000-0000-0000-000000000000')
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });

  it('persists the update (verifiable via GET)', async () => {
    const payload = makeProduct();
    const created = await integrationRepository.createProduct(payload);

    await request(bypassApp)
      .put(`/api/admin/products/${created.productId}`)
      .send({ name: 'Persisted Update' });

    const getRes = await request(bypassApp)
      .get(`/api/admin/products/${created.productId}`);

    expect(getRes.body.product.name).toBe('Persisted Update');
  });
});

// ===========================================================================
// DELETE /api/admin/products/:id  (auth bypassed)
// ===========================================================================

describe('DELETE /api/admin/products/:id', () => {
  it('deletes a product and returns 204', async () => {
    const payload = makeProduct();
    const created = await integrationRepository.createProduct(payload);

    const res = await request(bypassApp)
      .delete(`/api/admin/products/${created.productId}`);

    expect(res.status).toBe(204);
  });

  it('product is no longer retrievable after deletion', async () => {
    const payload = makeProduct();
    const created = await integrationRepository.createProduct(payload);

    await request(bypassApp).delete(`/api/admin/products/${created.productId}`);

    const getRes = await request(bypassApp)
      .get(`/api/admin/products/${created.productId}`);

    expect(getRes.status).toBe(404);
  });

  it('returns 404 when deleting a non-existent product', async () => {
    const res = await request(bypassApp)
      .delete('/api/admin/products/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
  });

  it('does not affect other products when one is deleted', async () => {
    const toDelete = makeProduct();
    const toKeep = makeProduct();
    const d = await integrationRepository.createProduct(toDelete);
    const k = await integrationRepository.createProduct(toKeep);

    await request(bypassApp).delete(`/api/admin/products/${d.productId}`);

    const keepRes = await request(bypassApp)
      .get(`/api/admin/products/${k.productId}`);

    expect(keepRes.status).toBe(200);
    expect(keepRes.body.product.productId).toBe(k.productId);
  });
});
