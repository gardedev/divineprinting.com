'use strict';

/**
 * Tests for Public Product Routes
 * (infrastructure/server/products/publicProductRoutes.js)
 *
 * Strategy:
 *   - Mock productService so no real DynamoDB or repository calls are made.
 *   - Mock all AWS SDK / uuid transitive dependencies to prevent import errors.
 *   - Use a minimal Express app that mounts the router at /api/products.
 *   - Drive requests with Node's built-in http module (no supertest dependency).
 *
 * Key invariant: only products with status === 'active' and no deletedAt
 * are returned. All other products yield 404.
 */

// ---------------------------------------------------------------------------
// Mock dependencies before any require() of the modules under test
// ---------------------------------------------------------------------------

// Mock productService entirely – no real service or repository calls.
jest.mock('../productService', () => ({
  getProduct:       jest.fn(),
  getProductBySlug: jest.fn(),
  listProducts:     jest.fn(),
}));

// Prevent AWS SDK ESM-only imports from failing in Jest (CJS environment).
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  PutCommand:              jest.fn(),
  GetCommand:              jest.fn(),
  QueryCommand:            jest.fn(),
  ScanCommand:             jest.fn(),
  UpdateCommand:           jest.fn(),
  DynamoDBDocumentClient:  { from: jest.fn().mockReturnValue({ send: jest.fn() }) },
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mocked-uuid') }));

// ---------------------------------------------------------------------------
// Imports (after mocks are set up)
// ---------------------------------------------------------------------------
const http    = require('http');
const express = require('express');

const productService      = require('../productService');
const publicProductRouter = require('../publicProductRoutes');

// ---------------------------------------------------------------------------
// Mini test server setup
// ---------------------------------------------------------------------------
let server;
let baseUrl;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/api/products', publicProductRouter);
  server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}/api/products`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

/**
 * Makes an HTTP request and returns { status, body } where body is parsed JSON.
 *
 * @param {string} method  - HTTP method in uppercase.
 * @param {string} path    - Path relative to baseUrl (starts with '/' or empty).
 * @param {Object} [data]  - Optional request body (will be JSON-stringified).
 * @returns {Promise<{ status: number, body: any }>}
 */
function request(method, path, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const bodyStr = data !== undefined ? JSON.stringify(data) : undefined;

    const options = {
      hostname: url.hostname,
      port:     url.port,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type':  'application/json',
        'Accept':        'application/json',
        ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
      },
    };

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (chunk) => { raw += chunk; });
      res.on('end', () => {
        let body;
        try { body = JSON.parse(raw); } catch { body = raw; }
        resolve({ status: res.statusCode, body });
      });
    });

    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ACTIVE_PRODUCT = {
  productId:   'active-uuid-1234',
  name:        'Vinyl Banner',
  description: 'High-quality outdoor vinyl banner',
  slug:        'vinyl-banner',
  status:      'active',
  basePrice:   4999,
  createdAt:   '2026-01-01T00:00:00.000Z',
  updatedAt:   '2026-01-01T00:00:00.000Z',
};

const DRAFT_PRODUCT = {
  ...ACTIVE_PRODUCT,
  productId: 'draft-uuid-1234',
  slug:      'vinyl-banner-draft',
  status:    'draft',
};

const ARCHIVED_PRODUCT = {
  ...ACTIVE_PRODUCT,
  productId: 'archived-uuid-1234',
  slug:      'vinyl-banner-archived',
  status:    'archived',
};

const DELETED_PRODUCT = {
  ...ACTIVE_PRODUCT,
  productId: 'deleted-uuid-1234',
  slug:      'vinyl-banner-deleted',
  status:    'deleted',
  deletedAt: '2026-06-01T00:00:00.000Z',
};

// Active but soft-deleted (edge case: status still 'active' but has deletedAt)
const SOFT_DELETED_ACTIVE = {
  ...ACTIVE_PRODUCT,
  productId: 'soft-deleted-uuid-1234',
  slug:      'vinyl-banner-soft-deleted',
  deletedAt: '2026-06-01T00:00:00.000Z',
};

const ACTIVE_LIST = {
  items:      [ACTIVE_PRODUCT],
  nextCursor: null,
};

// ===========================================================================
// GET /api/products — List active products
// ===========================================================================
describe('GET /api/products', () => {
  it('returns 200 with active products', async () => {
    productService.listProducts.mockResolvedValue(ACTIVE_LIST);

    const { status, body } = await request('GET', '');

    expect(status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toEqual(ACTIVE_PRODUCT);
    expect(body.nextCursor).toBeNull();
    expect(productService.listProducts).toHaveBeenCalledTimes(1);
  });

  it('always passes status=active to productService.listProducts', async () => {
    productService.listProducts.mockResolvedValue({ items: [], nextCursor: null });

    await request('GET', '');

    expect(productService.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' })
    );
  });

  it('passes limit as a parsed integer to productService.listProducts', async () => {
    productService.listProducts.mockResolvedValue({ items: [], nextCursor: null });

    await request('GET', '?limit=5');

    expect(productService.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5, status: 'active' })
    );
  });

  it('passes cursor to productService.listProducts', async () => {
    productService.listProducts.mockResolvedValue({ items: [], nextCursor: null });
    const cursor = Buffer.from(JSON.stringify({ productId: 'abc' })).toString('base64');

    await request('GET', `?cursor=${encodeURIComponent(cursor)}`);

    expect(productService.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ cursor, status: 'active' })
    );
  });

  it('returns 200 with empty items when no active products exist', async () => {
    productService.listProducts.mockResolvedValue({ items: [], nextCursor: null });

    const { status, body } = await request('GET', '');

    expect(status).toBe(200);
    expect(body.items).toEqual([]);
    expect(body.nextCursor).toBeNull();
  });

  it('strips soft-deleted items from the response even if service returns them', async () => {
    productService.listProducts.mockResolvedValue({
      items:      [ACTIVE_PRODUCT, SOFT_DELETED_ACTIVE],
      nextCursor: null,
    });

    const { status, body } = await request('GET', '');

    expect(status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(body.items[0].productId).toBe(ACTIVE_PRODUCT.productId);
  });

  it('returns 400 when limit is not a valid integer', async () => {
    const { status, body } = await request('GET', '?limit=abc');

    expect(status).toBe(400);
    expect(body.error).toBeDefined();
    expect(productService.listProducts).not.toHaveBeenCalled();
  });

  it('returns 400 when limit is zero', async () => {
    const { status, body } = await request('GET', '?limit=0');

    expect(status).toBe(400);
    expect(body.error).toBeDefined();
    expect(productService.listProducts).not.toHaveBeenCalled();
  });

  it('returns 400 when limit is negative', async () => {
    const { status, body } = await request('GET', '?limit=-1');

    expect(status).toBe(400);
    expect(body.error).toBeDefined();
    expect(productService.listProducts).not.toHaveBeenCalled();
  });

  it('returns 400 when service throws a validation error', async () => {
    productService.listProducts.mockRejectedValue(
      new Error('limit must be a positive integer.')
    );

    const { status, body } = await request('GET', '');

    expect(status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it('returns 500 on unexpected service error', async () => {
    productService.listProducts.mockRejectedValue(new Error('DynamoDB error'));

    const { status } = await request('GET', '');

    expect(status).toBe(500);
  });

  it('includes nextCursor when paginating', async () => {
    const nextCursor = Buffer.from(JSON.stringify({ productId: 'xyz' })).toString('base64');
    productService.listProducts.mockResolvedValue({
      items:      [ACTIVE_PRODUCT],
      nextCursor,
    });

    const { status, body } = await request('GET', '');

    expect(status).toBe(200);
    expect(body.nextCursor).toBe(nextCursor);
  });
});

// ===========================================================================
// GET /api/products/by-slug/:slug — Fetch active product by slug
// ===========================================================================
describe('GET /api/products/by-slug/:slug', () => {
  it('returns 200 and the product when found and active', async () => {
    productService.getProductBySlug.mockResolvedValue(ACTIVE_PRODUCT);

    const { status, body } = await request('GET', '/by-slug/vinyl-banner');

    expect(status).toBe(200);
    expect(body.product).toEqual(ACTIVE_PRODUCT);
    expect(productService.getProductBySlug).toHaveBeenCalledWith('vinyl-banner');
  });

  it('returns 404 when product is not found by slug', async () => {
    productService.getProductBySlug.mockResolvedValue(null);

    const { status, body } = await request('GET', '/by-slug/nonexistent');

    expect(status).toBe(404);
    expect(body.error).toBeDefined();
  });

  it('returns 404 when product is in draft status (not active)', async () => {
    productService.getProductBySlug.mockResolvedValue(DRAFT_PRODUCT);

    const { status, body } = await request('GET', '/by-slug/vinyl-banner-draft');

    expect(status).toBe(404);
    expect(body.error).toBeDefined();
    // Must not leak that a draft product exists
    expect(body.product).toBeUndefined();
  });

  it('returns 404 when product is archived', async () => {
    productService.getProductBySlug.mockResolvedValue(ARCHIVED_PRODUCT);

    const { status, body } = await request('GET', '/by-slug/vinyl-banner-archived');

    expect(status).toBe(404);
    expect(body.product).toBeUndefined();
  });

  it('returns 404 when product is soft-deleted (status=deleted)', async () => {
    productService.getProductBySlug.mockResolvedValue(DELETED_PRODUCT);

    const { status, body } = await request('GET', '/by-slug/vinyl-banner-deleted');

    expect(status).toBe(404);
    expect(body.product).toBeUndefined();
  });

  it('returns 404 when product has deletedAt even if status is active', async () => {
    productService.getProductBySlug.mockResolvedValue(SOFT_DELETED_ACTIVE);

    const { status, body } = await request('GET', '/by-slug/vinyl-banner-soft-deleted');

    expect(status).toBe(404);
    expect(body.product).toBeUndefined();
  });

  it('returns 500 on unexpected service error', async () => {
    productService.getProductBySlug.mockRejectedValue(new Error('DynamoDB error'));

    const { status } = await request('GET', '/by-slug/vinyl-banner');

    expect(status).toBe(500);
  });

  it('returns 400 when service throws a validation error', async () => {
    productService.getProductBySlug.mockRejectedValue(
      new Error('slug must be a non-empty string.')
    );

    const { status, body } = await request('GET', '/by-slug/vinyl-banner');

    expect(status).toBe(400);
    expect(body.error).toBeDefined();
  });
});

// ===========================================================================
// GET /api/products/:productId — Fetch active product by ID
// ===========================================================================
describe('GET /api/products/:productId', () => {
  it('returns 200 and the product when found and active', async () => {
    productService.getProduct.mockResolvedValue(ACTIVE_PRODUCT);

    const { status, body } = await request('GET', '/active-uuid-1234');

    expect(status).toBe(200);
    expect(body.product).toEqual(ACTIVE_PRODUCT);
    expect(productService.getProduct).toHaveBeenCalledWith('active-uuid-1234');
  });

  it('returns 404 when product is not found', async () => {
    productService.getProduct.mockResolvedValue(null);

    const { status, body } = await request('GET', '/ghost-id');

    expect(status).toBe(404);
    expect(body.error).toBeDefined();
  });

  it('returns 404 when product is in draft status (not active)', async () => {
    productService.getProduct.mockResolvedValue(DRAFT_PRODUCT);

    const { status, body } = await request('GET', '/draft-uuid-1234');

    expect(status).toBe(404);
    expect(body.product).toBeUndefined();
  });

  it('returns 404 when product is archived', async () => {
    productService.getProduct.mockResolvedValue(ARCHIVED_PRODUCT);

    const { status, body } = await request('GET', '/archived-uuid-1234');

    expect(status).toBe(404);
    expect(body.product).toBeUndefined();
  });

  it('returns 404 when product is soft-deleted (status=deleted)', async () => {
    productService.getProduct.mockResolvedValue(DELETED_PRODUCT);

    const { status, body } = await request('GET', '/deleted-uuid-1234');

    expect(status).toBe(404);
    expect(body.product).toBeUndefined();
  });

  it('returns 404 when product has deletedAt even if status is active', async () => {
    productService.getProduct.mockResolvedValue(SOFT_DELETED_ACTIVE);

    const { status, body } = await request('GET', '/soft-deleted-uuid-1234');

    expect(status).toBe(404);
    expect(body.product).toBeUndefined();
  });

  it('returns 400 on service validation error', async () => {
    productService.getProduct.mockRejectedValue(
      new Error('productId must be a non-empty string.')
    );

    const { status, body } = await request('GET', '/some-id');

    expect(status).toBe(400);
    expect(body.error).toMatch(/productId/);
  });

  it('returns 500 on unexpected service error', async () => {
    productService.getProduct.mockRejectedValue(new Error('DynamoDB error'));

    const { status } = await request('GET', '/some-id');

    expect(status).toBe(500);
  });
});

// ===========================================================================
// Route ordering — /by-slug/:slug must shadow /:productId
// ===========================================================================
describe('Route ordering: /by-slug/:slug is not captured as /:productId', () => {
  it('GET /by-slug/vinyl-banner calls getProductBySlug, not getProduct', async () => {
    productService.getProductBySlug.mockResolvedValue(ACTIVE_PRODUCT);

    await request('GET', '/by-slug/vinyl-banner');

    expect(productService.getProductBySlug).toHaveBeenCalledTimes(1);
    expect(productService.getProduct).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// No admin or write routes are exposed publicly
// ===========================================================================
describe('Public routes do not expose write operations', () => {
  it('POST /api/products returns 404 (method not allowed or not found)', async () => {
    const { status } = await request('POST', '', { name: 'x', basePrice: 100 });

    // Express returns 404 for unregistered routes on this router
    expect(status).toBe(404);
    expect(productService.listProducts).not.toHaveBeenCalled();
  });

  it('DELETE /api/products/:productId returns 404', async () => {
    const { status } = await request('DELETE', '/active-uuid-1234');

    expect(status).toBe(404);
  });

  it('PATCH /api/products/:productId returns 404', async () => {
    const { status } = await request('PATCH', '/active-uuid-1234', { name: 'x' });

    expect(status).toBe(404);
  });
});
