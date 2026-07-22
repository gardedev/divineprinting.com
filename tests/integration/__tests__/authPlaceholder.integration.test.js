'use strict';

/**
 * Integration tests – Authentication placeholder
 *
 * Documents and verifies the current authentication posture:
 *   - adminAuth.js returns 503 for ALL admin requests (deny-by-default)
 *   - The response body includes a machine-readable code
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

describe('adminAuth.js – deny-by-default contract', () => {
  it('returns 503 (not 401 or 403) for unauthenticated admin requests', async () => {
    // 503 signals "not yet configured", distinct from 401/403 auth failures
    const res = await request(app).get('/api/admin/products');
    expect(res.status).toBe(503);
  });

  it('returns the AUTH_NOT_CONFIGURED code in the response body', async () => {
    const res = await request(app).post('/api/admin/products').send(makeProduct());
    expect(res.body.code).toBe('AUTH_NOT_CONFIGURED');
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
      expect(res.status).toBe(503);
    }
  });

  it('never leaks product data through the auth denial response', async () => {
    // Seed a product to ensure there IS data in the table
    await integrationRepository.createProduct(makeProduct());

    const res = await request(app).get('/api/admin/products');

    expect(res.status).toBe(503);
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
    expect(adminRes.status).toBe(503);

    // But public route still works
    const pubRes = await request(app).get('/api/products');
    expect(pubRes.status).toBe(200);
    expect(Array.isArray(pubRes.body.products)).toBe(true);
  });
});

// ===========================================================================
// Future auth placeholder
// ===========================================================================

describe('Future authentication – placeholder assertions', () => {
  /**
   * These tests document what SHOULD happen once auth is implemented.
   * They intentionally test the current 503 behaviour so that the test
   * suite fails the moment auth is added without updating the tests.
   *
   * When implementing auth:
   *   1. Remove the 503 assertions below
   *   2. Replace with proper token/session-based test helpers
   *   3. Keep the auth bypass in createAuthBypassApp() for route-logic tests
   */

  it('PLACEHOLDER: valid credentials should eventually return non-503 (currently 503)', async () => {
    // No credentials → 503 today; this test documents the transition point
    const res = await request(app)
      .get('/api/admin/products')
      .set('Authorization', 'Bearer placeholder-token');

    // Current expectation: still 503 (auth not implemented)
    expect(res.status).toBe(503);

    // Future: expect(res.status).toBe(200);
  });

  it('PLACEHOLDER: invalid credentials should eventually return 401 (currently 503)', async () => {
    const res = await request(app)
      .get('/api/admin/products')
      .set('Authorization', 'Bearer invalid-token');

    // Current expectation: 503 (auth not configured, regardless of header)
    expect(res.status).toBe(503);

    // Future: expect(res.status).toBe(401);
  });
});
