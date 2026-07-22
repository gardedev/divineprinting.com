'use strict';

/**
 * Integration tests – Error response scenarios
 *
 * Tests that the API returns appropriate HTTP status codes and error
 * structures for invalid requests and edge cases.
 */

const request = require('supertest');
const { resetIntegrationTable } = require('../helpers/dynamoLocal');
const { createTestApp, createAuthBypassApp, integrationRepository } = require('../helpers/testApp');
const { makeProduct } = require('../fixtures/products');

let protectedApp;
let bypassApp;

beforeAll(() => {
  protectedApp = createTestApp();
  bypassApp = createAuthBypassApp();
});

beforeEach(async () => {
  await resetIntegrationTable();
}, 20000);

// ===========================================================================
// 400 Bad Request
// ===========================================================================

describe('400 Bad Request', () => {
  it('POST /api/admin/products returns 400 for missing name', async () => {
    const { name: _n, ...noName } = makeProduct();
    const res = await request(bypassApp).post('/api/admin/products').send(noName);
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('POST /api/admin/products returns 400 for missing basePrice', async () => {
    const { basePrice: _p, ...noPrice } = makeProduct();
    const res = await request(bypassApp).post('/api/admin/products').send(noPrice);
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });

  it('POST /api/admin/products returns 400 for float basePrice', async () => {
    const res = await request(bypassApp)
      .post('/api/admin/products')
      .send(makeProduct({ basePrice: 19.99 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/basePrice must be/i);
  });

  it('POST /api/admin/products returns 400 for negative basePrice', async () => {
    const res = await request(bypassApp)
      .post('/api/admin/products')
      .send(makeProduct({ basePrice: -1 }));
    expect(res.status).toBe(400);
  });

  it('POST /api/admin/products returns 400 for string basePrice', async () => {
    const res = await request(bypassApp)
      .post('/api/admin/products')
      .send(makeProduct({ basePrice: 'not-a-number' }));
    expect(res.status).toBe(400);
  });

  it('POST /api/admin/products returns 400 for empty name string', async () => {
    const res = await request(bypassApp)
      .post('/api/admin/products')
      .send(makeProduct({ name: '' }));
    expect(res.status).toBe(400);
  });

  it('PUT /api/admin/products/:id returns 400 for empty body', async () => {
    const created = await integrationRepository.createProduct(makeProduct());
    const res = await request(bypassApp)
      .put(`/api/admin/products/${created.productId}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ===========================================================================
// 404 Not Found
// ===========================================================================

describe('404 Not Found', () => {
  it('GET /api/products/:slug returns 404 for unknown slug', async () => {
    const res = await request(bypassApp).get('/api/products/does-not-exist-999');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('GET /api/admin/products/:id returns 404 for unknown UUID', async () => {
    const res = await request(bypassApp)
      .get('/api/admin/products/00000000-0000-0000-0000-000000000099');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('PUT /api/admin/products/:id returns 404 for unknown UUID', async () => {
    const res = await request(bypassApp)
      .put('/api/admin/products/00000000-0000-0000-0000-000000000099')
      .send({ name: 'Ghost Update' });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/admin/products/:id returns 404 for unknown UUID', async () => {
    const res = await request(bypassApp)
      .delete('/api/admin/products/00000000-0000-0000-0000-000000000099');
    expect(res.status).toBe(404);
  });
});

// ===========================================================================
// 503 Service Unavailable (auth not configured)
// ===========================================================================

describe('503 Service Unavailable – admin routes without auth', () => {
  it('POST /api/admin/products returns 503 with code AUTH_NOT_CONFIGURED', async () => {
    const res = await request(protectedApp)
      .post('/api/admin/products')
      .send(makeProduct());
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('AUTH_NOT_CONFIGURED');
  });

  it('GET /api/admin/products returns 503', async () => {
    const res = await request(protectedApp).get('/api/admin/products');
    expect(res.status).toBe(503);
  });

  it('GET /api/admin/products/:id returns 503', async () => {
    const res = await request(protectedApp).get('/api/admin/products/any-id');
    expect(res.status).toBe(503);
  });

  it('PUT /api/admin/products/:id returns 503', async () => {
    const res = await request(protectedApp)
      .put('/api/admin/products/any-id')
      .send({ name: 'x' });
    expect(res.status).toBe(503);
  });

  it('DELETE /api/admin/products/:id returns 503', async () => {
    const res = await request(protectedApp).delete('/api/admin/products/any-id');
    expect(res.status).toBe(503);
  });

  it('returns JSON body for 503 responses', async () => {
    const res = await request(protectedApp).get('/api/admin/products');
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('code');
  });
});

// ===========================================================================
// Error response shape consistency
// ===========================================================================

describe('Error response shape', () => {
  it('all error responses include an error field (string)', async () => {
    const scenarios = [
      () => request(bypassApp).get('/api/products/no-such-slug'),
      () => request(bypassApp).get('/api/admin/products/bad-uuid'),
      () => request(bypassApp).post('/api/admin/products').send({}),
      () => request(protectedApp).get('/api/admin/products'),
    ];

    for (const scenario of scenarios) {
      const res = await scenario();
      expect(res.body).toHaveProperty('error');
      expect(typeof res.body.error).toBe('string');
      expect(res.body.error.length).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// Health check (baseline)
// ===========================================================================

describe('Health check', () => {
  it('GET /health returns 200', async () => {
    const res = await request(bypassApp).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
