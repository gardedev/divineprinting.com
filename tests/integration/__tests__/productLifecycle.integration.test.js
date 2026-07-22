'use strict';

/**
 * Integration tests – Product lifecycle (end-to-end flows)
 *
 * Tests the complete product lifecycle through the HTTP API:
 *   Create → Read → Update → Delete
 *
 * These tests cross multiple routes in a single scenario but each
 * scenario is independent (table is reset between tests).
 */

const request = require('supertest');
const { resetIntegrationTable } = require('../helpers/dynamoLocal');
const { createAuthBypassApp, integrationRepository } = require('../helpers/testApp');
const { makeProduct } = require('../fixtures/products');

let app;

beforeAll(() => {
  app = createAuthBypassApp();
});

beforeEach(async () => {
  await resetIntegrationTable();
}, 20000);

// ===========================================================================
// Create → Read lifecycle
// ===========================================================================

describe('Create → Read lifecycle', () => {
  it('product created via admin API is visible on public list endpoint', async () => {
    const payload = makeProduct({ basePrice: 1500 });

    const createRes = await request(app)
      .post('/api/admin/products')
      .send(payload);

    expect(createRes.status).toBe(201);

    const listRes = await request(app).get('/api/products');
    expect(listRes.status).toBe(200);

    const found = listRes.body.products.find(p => p.slug === payload.slug);
    expect(found).toBeDefined();
    expect(found.name).toBe(payload.name);
  });

  it('product created via admin API is retrievable by slug on public endpoint', async () => {
    const payload = makeProduct({ basePrice: 2000 });

    const createRes = await request(app)
      .post('/api/admin/products')
      .send(payload);

    expect(createRes.status).toBe(201);

    const slugRes = await request(app).get(`/api/products/${payload.slug}`);
    expect(slugRes.status).toBe(200);
    expect(slugRes.body.product.name).toBe(payload.name);
    expect(slugRes.body.product.basePrice).toBe(2000);
  });

  it('product created via admin API is retrievable by ID on admin endpoint', async () => {
    const payload = makeProduct();

    const createRes = await request(app)
      .post('/api/admin/products')
      .send(payload);

    const { productId } = createRes.body.product;

    const getRes = await request(app).get(`/api/admin/products/${productId}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.product.productId).toBe(productId);
  });
});

// ===========================================================================
// Create → Update → Read lifecycle
// ===========================================================================

describe('Create → Update → Read lifecycle', () => {
  it('updated product fields are reflected on public slug endpoint', async () => {
    const payload = makeProduct({ name: 'Old Name', basePrice: 1000 });

    const createRes = await request(app)
      .post('/api/admin/products')
      .send(payload);

    const { productId } = createRes.body.product;

    // Update via admin
    await request(app)
      .put(`/api/admin/products/${productId}`)
      .send({ name: 'New Name', basePrice: 2000 });

    // Verify on public endpoint
    const slugRes = await request(app).get(`/api/products/${payload.slug}`);
    expect(slugRes.status).toBe(200);
    expect(slugRes.body.product.name).toBe('New Name');
    expect(slugRes.body.product.basePrice).toBe(2000);
  });

  it('updatedAt is more recent than createdAt after an update', async () => {
    const payload = makeProduct();

    const createRes = await request(app)
      .post('/api/admin/products')
      .send(payload);

    const { productId, createdAt } = createRes.body.product;

    // Ensure timestamps differ
    await new Promise(r => setTimeout(r, 20));

    await request(app)
      .put(`/api/admin/products/${productId}`)
      .send({ name: 'Timestamp Test Updated' });

    const getRes = await request(app).get(`/api/admin/products/${productId}`);
    const { updatedAt } = getRes.body.product;

    expect(new Date(updatedAt).getTime()).toBeGreaterThan(
      new Date(createdAt).getTime()
    );
  });

  it('multiple sequential updates accumulate correctly', async () => {
    const payload = makeProduct({ basePrice: 100 });

    const createRes = await request(app)
      .post('/api/admin/products')
      .send(payload);

    const { productId } = createRes.body.product;

    await request(app).put(`/api/admin/products/${productId}`).send({ basePrice: 200 });
    await request(app).put(`/api/admin/products/${productId}`).send({ basePrice: 300 });
    await request(app).put(`/api/admin/products/${productId}`).send({ basePrice: 400 });

    const getRes = await request(app).get(`/api/admin/products/${productId}`);
    expect(getRes.body.product.basePrice).toBe(400);
  });
});

// ===========================================================================
// Create → Delete lifecycle
// ===========================================================================

describe('Create → Delete lifecycle', () => {
  it('deleted product is no longer visible on public list', async () => {
    const payload = makeProduct();

    const createRes = await request(app)
      .post('/api/admin/products')
      .send(payload);

    const { productId } = createRes.body.product;

    await request(app).delete(`/api/admin/products/${productId}`);

    const listRes = await request(app).get('/api/products');
    const found = listRes.body.products.find(p => p.slug === payload.slug);
    expect(found).toBeUndefined();
  });

  it('deleted product returns 404 on public slug endpoint', async () => {
    const payload = makeProduct();

    const createRes = await request(app)
      .post('/api/admin/products')
      .send(payload);

    const { productId } = createRes.body.product;

    await request(app).delete(`/api/admin/products/${productId}`);

    const slugRes = await request(app).get(`/api/products/${payload.slug}`);
    expect(slugRes.status).toBe(404);
  });

  it('deleted product returns 404 on admin GET endpoint', async () => {
    const payload = makeProduct();

    const createRes = await request(app)
      .post('/api/admin/products')
      .send(payload);

    const { productId } = createRes.body.product;

    await request(app).delete(`/api/admin/products/${productId}`);

    const getRes = await request(app).get(`/api/admin/products/${productId}`);
    expect(getRes.status).toBe(404);
  });

  it('double-delete returns 404 on the second attempt', async () => {
    const payload = makeProduct();
    const createRes = await request(app).post('/api/admin/products').send(payload);
    const { productId } = createRes.body.product;

    const del1 = await request(app).delete(`/api/admin/products/${productId}`);
    expect(del1.status).toBe(204);

    const del2 = await request(app).delete(`/api/admin/products/${productId}`);
    expect(del2.status).toBe(404);
  });
});

// ===========================================================================
// Full CRUD lifecycle
// ===========================================================================

describe('Full CRUD lifecycle', () => {
  it('completes a full create → read → update → delete → verify cycle', async () => {
    const payload = makeProduct({ name: 'Lifecycle Product', basePrice: 1000 });

    // 1. CREATE
    const createRes = await request(app).post('/api/admin/products').send(payload);
    expect(createRes.status).toBe(201);
    const { productId } = createRes.body.product;

    // 2. READ (admin)
    const readRes = await request(app).get(`/api/admin/products/${productId}`);
    expect(readRes.status).toBe(200);
    expect(readRes.body.product.name).toBe('Lifecycle Product');

    // 3. READ (public slug)
    const pubRes = await request(app).get(`/api/products/${payload.slug}`);
    expect(pubRes.status).toBe(200);

    // 4. UPDATE
    const updateRes = await request(app)
      .put(`/api/admin/products/${productId}`)
      .send({ name: 'Updated Lifecycle Product', basePrice: 2000 });
    expect(updateRes.status).toBe(200);
    expect(updateRes.body.product.name).toBe('Updated Lifecycle Product');

    // 5. DELETE
    const deleteRes = await request(app).delete(`/api/admin/products/${productId}`);
    expect(deleteRes.status).toBe(204);

    // 6. VERIFY gone
    const goneRes = await request(app).get(`/api/admin/products/${productId}`);
    expect(goneRes.status).toBe(404);

    const gonePubRes = await request(app).get(`/api/products/${payload.slug}`);
    expect(gonePubRes.status).toBe(404);
  });
});
