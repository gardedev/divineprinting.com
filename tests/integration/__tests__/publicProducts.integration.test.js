'use strict';

/**
 * Integration tests – Public product routes
 *
 * Boundary: HTTP → Express → ProductService → ProductRepository → DynamoDB Local
 *
 * Routes under test:
 *   GET /api/products         - list all products
 *   GET /api/products/:slug   - get product by slug
 *
 * NOTE: GET /api/products/:id is intentionally NOT tested (no such public route).
 */

const request = require('supertest');
const { resetIntegrationTable } = require('../helpers/dynamoLocal');
const { createTestApp } = require('../helpers/testApp');
const { integrationRepository } = require('../helpers/testApp');
const { makeProduct } = require('../fixtures/products');

// ---------------------------------------------------------------------------
// App instance (shared across tests in this file)
// ---------------------------------------------------------------------------

let app;

beforeAll(() => {
  app = createTestApp();
});

// ---------------------------------------------------------------------------
// Table cleanup – runs before each test to guarantee independence
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await resetIntegrationTable();
}, 20000);

// ===========================================================================
// GET /api/products
// ===========================================================================

describe('GET /api/products', () => {
  it('returns 200 with an empty products array when no products exist', async () => {
    const res = await request(app).get('/api/products');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('products');
    expect(Array.isArray(res.body.products)).toBe(true);
    expect(res.body.products).toHaveLength(0);
  });

  it('returns 200 with all products when products exist', async () => {
    const p1 = makeProduct();
    const p2 = makeProduct();
    await integrationRepository.createProduct(p1);
    await integrationRepository.createProduct(p2);

    const res = await request(app).get('/api/products');

    expect(res.status).toBe(200);
    expect(res.body.products).toHaveLength(2);
  });

  it('returns products with expected fields', async () => {
    const payload = makeProduct({ name: 'Field Check Card', basePrice: 3000 });
    await integrationRepository.createProduct(payload);

    const res = await request(app).get('/api/products');

    expect(res.status).toBe(200);
    const [product] = res.body.products;

    expect(product).toHaveProperty('productId');
    expect(product).toHaveProperty('name');
    expect(product).toHaveProperty('basePrice');
    expect(product).toHaveProperty('slug');
    expect(product).toHaveProperty('createdAt');
    expect(product).toHaveProperty('updatedAt');
  });

  it('returns products with correct basePrice as an integer', async () => {
    const payload = makeProduct({ basePrice: 4999 });
    await integrationRepository.createProduct(payload);

    const res = await request(app).get('/api/products');

    const product = res.body.products.find(p => p.slug === payload.slug);
    expect(product.basePrice).toBe(4999);
    expect(Number.isInteger(product.basePrice)).toBe(true);
  });

  it('lists multiple products and returns them all', async () => {
    const products = [makeProduct(), makeProduct(), makeProduct()];
    await Promise.all(products.map(p => integrationRepository.createProduct(p)));

    const res = await request(app).get('/api/products');

    expect(res.status).toBe(200);
    expect(res.body.products.length).toBeGreaterThanOrEqual(3);
  });

  it('returns JSON content-type', async () => {
    const res = await request(app).get('/api/products');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

// ===========================================================================
// GET /api/products/:slug
// ===========================================================================

describe('GET /api/products/:slug', () => {
  it('returns 200 with the product when slug matches', async () => {
    const payload = makeProduct();
    await integrationRepository.createProduct(payload);

    const res = await request(app).get(`/api/products/${payload.slug}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('product');
    expect(res.body.product.slug).toBe(payload.slug);
    expect(res.body.product.name).toBe(payload.name);
  });

  it('returns the product with all persisted fields', async () => {
    const payload = makeProduct({
      description: 'Integration test description',
      category: 'cards',
      basePrice: 2500,
    });
    await integrationRepository.createProduct(payload);

    const res = await request(app).get(`/api/products/${payload.slug}`);

    expect(res.status).toBe(200);
    const { product } = res.body;

    expect(product.name).toBe(payload.name);
    expect(product.description).toBe(payload.description);
    expect(product.category).toBe(payload.category);
    expect(product.basePrice).toBe(2500);
    expect(product.slug).toBe(payload.slug);
    expect(product.productId).toBeDefined();
    expect(product.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(product.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns 404 when slug does not exist', async () => {
    const res = await request(app).get('/api/products/non-existent-slug-xyz-123');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 after a product is deleted', async () => {
    const payload = makeProduct();
    const created = await integrationRepository.createProduct(payload);

    // Verify it exists first
    const beforeRes = await request(app).get(`/api/products/${payload.slug}`);
    expect(beforeRes.status).toBe(200);

    // Delete it
    await integrationRepository.deleteProduct(created.productId);

    // Now it should 404
    const afterRes = await request(app).get(`/api/products/${payload.slug}`);
    expect(afterRes.status).toBe(404);
  });

  it('finds the correct product when multiple products exist', async () => {
    const target = makeProduct();
    const other1 = makeProduct();
    const other2 = makeProduct();

    await Promise.all([
      integrationRepository.createProduct(target),
      integrationRepository.createProduct(other1),
      integrationRepository.createProduct(other2),
    ]);

    const res = await request(app).get(`/api/products/${target.slug}`);

    expect(res.status).toBe(200);
    expect(res.body.product.slug).toBe(target.slug);
    expect(res.body.product.name).toBe(target.name);
  });

  it('returns JSON content-type for found product', async () => {
    const payload = makeProduct();
    await integrationRepository.createProduct(payload);

    const res = await request(app).get(`/api/products/${payload.slug}`);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('handles slug with hyphens correctly', async () => {
    const payload = makeProduct({ slug: `multi-word-slug-${Date.now()}` });
    await integrationRepository.createProduct(payload);

    const res = await request(app).get(`/api/products/${payload.slug}`);
    expect(res.status).toBe(200);
    expect(res.body.product.slug).toBe(payload.slug);
  });
});

// ===========================================================================
// Confirm: no public product-by-ID route
// ===========================================================================

describe('Public route scope – no product-by-ID route', () => {
  it('does NOT expose GET /api/products/:id that returns a product by UUID', async () => {
    // A UUID-shaped path hits the slug handler and should 404 (not match a UUID route)
    const payload = makeProduct();
    const created = await integrationRepository.createProduct(payload);

    // The UUID is NOT a slug – slug-index query returns nothing → 404
    const res = await request(app).get(`/api/products/${created.productId}`);

    // Should be 404: UUID is not in the slug index, so slug lookup returns null
    expect(res.status).toBe(404);
  });
});
