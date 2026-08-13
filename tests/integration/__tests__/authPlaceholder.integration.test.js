'use strict';

/**
 * Integration tests – Admin authentication boundary
 *
 * Documents and verifies the current authentication posture:
 *   - admin routes require a Cognito access token
 *   - Missing credentials return a machine-readable authentication error
 *   - Public routes are NOT auth-gated
 *
 * These tests serve as a living contract: when real authentication is
 * implemented, these tests will need to be updated to reflect the new behaviour.
 * They are NOT testing admin route logic (see adminProducts.integration.test.js).
 */

const request = require('supertest');
const { resetIntegrationTable } = require('../helpers/dynamoLocal');
const { createTestApp, integrationRepository } = require('../helpers/testApp');
const { makeProduct } = require('../fixtures/products');

let app;

beforeAll(() => {
  app = createTestApp(); // Uses real adminAuth → deny-by-default
});

beforeEach(async () => {
  await resetIntegrationTable();
}, 20000);

// ===========================================================================
// adminAuth.js behaviour contract
// ===========================================================================

describe('adminAuth.js – authentication contract', () => {
  it('returns 401 for unauthenticated admin requests', async () => {
    const res = await request(app).get('/api/admin/products');
    expect(res.status).toBe(401);
  });

  it('returns the MISSING_TOKEN code in the response body', async () => {
    const res = await request(app).post('/api/admin/products').send(makeProduct());
    expect(res.body.code).toBe('MISSING_TOKEN');
  });

  it('blocks every HTTP method on admin routes', async () => {
    const checks = [
      request(app).get('/api/admin/products'),
      request(app).post('/api/admin/products').send(makeProduct()),
      request(app).get('/api/admin/products/some-id'),
      request(app).put('/api/admin/products/some-id').send({ name: 'x' }),
      request(app).delete('/api/admin/products/some-id'),
    ];

    const results = await Promise.all(checks);
    for (const res of results) {
      expect(res.status).toBe(401);
    }
  });

  it('never leaks product data through the auth denial response', async () => {
    // Seed a product to ensure there IS data in the table
    await integrationRepository.createProduct(makeProduct());

    const res = await request(app).get('/api/admin/products');

    expect(res.status).toBe(401);
    // Body must not contain product array
    expect(res.body.products).toBeUndefined();
  });

  it('denial response is valid JSON', async () => {
    const res = await request(app).get('/api/admin/products');
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(() => JSON.stringify(res.body)).not.toThrow();
  });
});

// ===========================================================================
// Public routes are NOT auth-gated
// ===========================================================================

describe('Public routes – no authentication required', () => {
  it('GET /api/products is accessible without any credentials', async () => {
    const res = await request(app).get('/api/products');
    // Should not return 401, 403, or 503
    expect([401, 403, 503]).not.toContain(res.status);
    expect(res.status).toBe(200);
  });

  it('GET /api/products/:slug is accessible without any credentials', async () => {
    const payload = makeProduct();
    await integrationRepository.createProduct(payload);

    const res = await request(app).get(`/api/products/${payload.slug}`);
    expect([401, 403, 503]).not.toContain(res.status);
    expect(res.status).toBe(200);
  });

  it('public routes return data even when admin routes are blocked', async () => {
    const payload = makeProduct();
    await integrationRepository.createProduct(payload);

    // Admin route is blocked
    const adminRes = await request(app).get('/api/admin/products');
    expect(adminRes.status).toBe(401);

    // But public route still works
    const pubRes = await request(app).get('/api/products');
    expect(pubRes.status).toBe(200);
    expect(Array.isArray(pubRes.body.products)).toBe(true);
  });
});

// ===========================================================================
// Authorization header shape
// ===========================================================================

describe('Authorization header shape', () => {
  it('rejects a malformed Authorization header', async () => {
    const res = await request(app)
      .get('/api/admin/products')
      .set('Authorization', 'Basic not-a-bearer-token');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('MISSING_TOKEN');
  });
});
