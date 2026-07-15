'use strict';

/**
 * Tests for Admin Product Routes
 * (infrastructure/server/products/index.js)
 *
 * Strategy:
 *   - Mock productService so no real DynamoDB or repository calls are made.
 *   - Mock adminAuth middleware to call next() so routes are exercised.
 *   - Mock all AWS SDK / uuid transitive dependencies to prevent import errors.
 *   - Use a minimal Express app that mounts the router at /api/admin/products.
 *   - Drive requests with Node's built-in http module (no supertest dependency).
 *
 * We avoid adding external test dependencies (supertest) because the project
 * has none installed at the root node_modules level.
 */

// ---------------------------------------------------------------------------
// Mock dependencies before any require() of the modules under test
// ---------------------------------------------------------------------------

// Bypass the adminAuth middleware so route handlers are reachable in tests.
jest.mock('../../middleware/adminAuth', () => ({
  adminAuth: (req, res, next) => next(),
}));

// Mock productService entirely – no real service or repository calls.
jest.mock('../productService', () => ({
  createProduct:   jest.fn(),
  getProduct:      jest.fn(),
  getProductBySlug: jest.fn(),
  listProducts:    jest.fn(),
  updateProduct:   jest.fn(),
  publishProduct:  jest.fn(),
  archiveProduct:  jest.fn(),
  restoreProduct:  jest.fn(),
  deleteProduct:   jest.fn(),
}));

// Prevent AWS SDK ESM-only imports from failing in Jest (CJS environment).
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
  QueryCommand: jest.fn(),
  ScanCommand: jest.fn(),
  UpdateCommand: jest.fn(),
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: jest.fn() }) },
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mocked-uuid') }));

// ---------------------------------------------------------------------------
// Imports (after mocks are set up)
// ---------------------------------------------------------------------------
const http   = require('http');
const express = require('express');

const productService     = require('../productService');
const adminProductRouter = require('../index');

// ---------------------------------------------------------------------------
// Mini test server setup
// ---------------------------------------------------------------------------
let server;
let baseUrl;

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/products', adminProductRouter);
  server = http.createServer(app);
  server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}/api/admin/products`;
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
 * @param {string} path    - Path relative to baseUrl (starts with '/').
 * @param {Object} [data]  - Optional request body (will be JSON-stringified).
 * @returns {Promise<{ status: number, body: any }>}
 */
function request(method, path, data) {
  return new Promise((resolve, reject) => {
    const url = new URL(baseUrl + path);
    const bodyStr = data !== undefined ? JSON.stringify(data) : undefined;

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept':       'application/json',
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
// Fixture
// ---------------------------------------------------------------------------
const DRAFT_PRODUCT = {
  productId:   'test-uuid-1234',
  name:        'Vinyl Banner',
  description: 'High-quality outdoor vinyl banner',
  slug:        'vinyl-banner',
  status:      'draft',
  basePrice:   4999,
  createdAt:   '2026-01-01T00:00:00.000Z',
  updatedAt:   '2026-01-01T00:00:00.000Z',
};

const ACTIVE_PRODUCT  = { ...DRAFT_PRODUCT, status: 'active' };
const ARCHIVED_PRODUCT = { ...DRAFT_PRODUCT, status: 'archived' };
const DELETED_PRODUCT  = {
  ...DRAFT_PRODUCT,
  status: 'deleted',
  deletedAt: '2026-06-01T00:00:00.000Z',
};

const PRODUCT_LIST = {
  items: [DRAFT_PRODUCT],
  nextCursor: null,
};

// ===========================================================================
// POST /api/admin/products — Create product
// ===========================================================================
describe('POST /api/admin/products', () => {
  it('returns 201 and the created product on success', async () => {
    productService.createProduct.mockResolvedValue(DRAFT_PRODUCT);

    const { status, body } = await request('POST', '', {
      name:      'Vinyl Banner',
      basePrice: 4999,
    });

    expect(status).toBe(201);
    expect(body.product).toEqual(DRAFT_PRODUCT);
    expect(productService.createProduct).toHaveBeenCalledTimes(1);
  });

  it('passes all supplied fields to productService.createProduct', async () => {
    productService.createProduct.mockResolvedValue(DRAFT_PRODUCT);

    await request('POST', '', {
      name:        'Vinyl Banner',
      description: 'Great banner',
      basePrice:   4999,
      status:      'active',
      slug:        'custom-slug',
    });

    expect(productService.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        name:        'Vinyl Banner',
        description: 'Great banner',
        basePrice:   4999,
        status:      'active',
        slug:        'custom-slug',
      })
    );
  });

  it('returns 400 when name is missing', async () => {
    const { status, body } = await request('POST', '', { basePrice: 4999 });

    expect(status).toBe(400);
    expect(body.error).toBeDefined();
    expect(productService.createProduct).not.toHaveBeenCalled();
  });

  it('returns 400 when basePrice is missing', async () => {
    const { status, body } = await request('POST', '', { name: 'Banner' });

    expect(status).toBe(400);
    expect(body.error).toBeDefined();
    expect(productService.createProduct).not.toHaveBeenCalled();
  });

  it('returns 400 when service throws a validation error', async () => {
    productService.createProduct.mockRejectedValue(
      new Error('basePrice must be a non-negative integer representing cents')
    );

    const { status, body } = await request('POST', '', { name: 'Banner', basePrice: -1 });

    expect(status).toBe(400);
    expect(body.error).toMatch(/basePrice/);
  });

  it('returns 500 when service throws an unexpected error', async () => {
    productService.createProduct.mockRejectedValue(new Error('DynamoDB down'));

    const { status, body } = await request('POST', '', {
      name:      'Banner',
      basePrice: 1000,
    });

    expect(status).toBe(500);
    expect(body.error).toBeDefined();
  });
});

// ===========================================================================
// GET /api/admin/products — List products
// ===========================================================================
describe('GET /api/admin/products', () => {
  it('returns 200 and the product list', async () => {
    productService.listProducts.mockResolvedValue(PRODUCT_LIST);

    const { status, body } = await request('GET', '');

    expect(status).toBe(200);
    expect(body.items).toEqual([DRAFT_PRODUCT]);
    expect(body.nextCursor).toBeNull();
    expect(productService.listProducts).toHaveBeenCalledTimes(1);
  });

  it('passes status query parameter to productService.listProducts', async () => {
    productService.listProducts.mockResolvedValue({ items: [], nextCursor: null });

    await request('GET', '?status=active');

    expect(productService.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' })
    );
  });

  it('parses and passes limit as an integer', async () => {
    productService.listProducts.mockResolvedValue({ items: [], nextCursor: null });

    await request('GET', '?limit=5');

    expect(productService.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 5 })
    );
  });

  it('passes cursor to productService.listProducts', async () => {
    productService.listProducts.mockResolvedValue({ items: [], nextCursor: null });
    const cursor = Buffer.from(JSON.stringify({ productId: 'abc' })).toString('base64');

    await request('GET', `?cursor=${encodeURIComponent(cursor)}`);

    expect(productService.listProducts).toHaveBeenCalledWith(
      expect.objectContaining({ cursor })
    );
  });

  it('returns 400 when limit is not a number', async () => {
    const { status, body } = await request('GET', '?limit=abc');

    expect(status).toBe(400);
    expect(body.error).toBeDefined();
    expect(productService.listProducts).not.toHaveBeenCalled();
  });

  it('returns 400 when service throws a validation error', async () => {
    productService.listProducts.mockRejectedValue(
      new Error('status must be one of: active, draft, archived.')
    );

    const { status } = await request('GET', '?status=unknown');

    expect(status).toBe(400);
  });

  it('returns 500 on unexpected service error', async () => {
    productService.listProducts.mockRejectedValue(new Error('DynamoDB error'));

    const { status } = await request('GET', '');

    expect(status).toBe(500);
  });
});

// ===========================================================================
// GET /api/admin/products/by-slug/:slug — Fetch by slug
// ===========================================================================
describe('GET /api/admin/products/by-slug/:slug', () => {
  it('returns 200 and the product when found', async () => {
    productService.getProductBySlug.mockResolvedValue(DRAFT_PRODUCT);

    const { status, body } = await request('GET', '/by-slug/vinyl-banner');

    expect(status).toBe(200);
    expect(body.product).toEqual(DRAFT_PRODUCT);
    expect(productService.getProductBySlug).toHaveBeenCalledWith('vinyl-banner');
  });

  it('returns 404 when product is not found by slug', async () => {
    productService.getProductBySlug.mockResolvedValue(null);

    const { status, body } = await request('GET', '/by-slug/nonexistent');

    expect(status).toBe(404);
    expect(body.error).toBeDefined();
  });

  it('returns 500 on unexpected service error', async () => {
    productService.getProductBySlug.mockRejectedValue(new Error('DynamoDB error'));

    const { status } = await request('GET', '/by-slug/vinyl-banner');

    expect(status).toBe(500);
  });
});

// ===========================================================================
// GET /api/admin/products/:productId — Fetch by ID
// ===========================================================================
describe('GET /api/admin/products/:productId', () => {
  it('returns 200 and the product when found', async () => {
    productService.getProduct.mockResolvedValue(DRAFT_PRODUCT);

    const { status, body } = await request('GET', '/test-uuid-1234');

    expect(status).toBe(200);
    expect(body.product).toEqual(DRAFT_PRODUCT);
    expect(productService.getProduct).toHaveBeenCalledWith('test-uuid-1234');
  });

  it('returns 404 when product is not found', async () => {
    productService.getProduct.mockResolvedValue(null);

    const { status, body } = await request('GET', '/ghost-id');

    expect(status).toBe(404);
    expect(body.error).toBeDefined();
  });

  it('returns 400 on service validation error (invalid productId)', async () => {
    productService.getProduct.mockRejectedValue(
      new Error('productId must be a non-empty string.')
    );

    // Pass an obviously invalid id; the service will reject with a 400-class error
    const { status, body } = await request('GET', '/%20');

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
// PATCH /api/admin/products/:productId — Update product
// ===========================================================================
describe('PATCH /api/admin/products/:productId', () => {
  it('returns 200 and the updated product on success', async () => {
    const updated = { ...DRAFT_PRODUCT, name: 'Vinyl Banner XL' };
    productService.updateProduct.mockResolvedValue(updated);

    const { status, body } = await request('PATCH', '/test-uuid-1234', {
      name: 'Vinyl Banner XL',
    });

    expect(status).toBe(200);
    expect(body.product.name).toBe('Vinyl Banner XL');
    expect(productService.updateProduct).toHaveBeenCalledWith(
      'test-uuid-1234',
      expect.objectContaining({ name: 'Vinyl Banner XL' })
    );
  });

  it('returns 400 when request body is empty', async () => {
    const { status, body } = await request('PATCH', '/test-uuid-1234', {});

    expect(status).toBe(400);
    expect(body.error).toBeDefined();
    expect(productService.updateProduct).not.toHaveBeenCalled();
  });

  it('returns 404 when product is not found', async () => {
    productService.updateProduct.mockRejectedValue(
      new Error('Product not found: ghost-id')
    );

    const { status, body } = await request('PATCH', '/ghost-id', { name: 'X' });

    expect(status).toBe(404);
    expect(body.error).toMatch(/Product not found/);
  });

  it('returns 400 on validation error from service', async () => {
    productService.updateProduct.mockRejectedValue(
      new Error('basePrice must be a non-negative integer representing cents')
    );

    const { status } = await request('PATCH', '/test-uuid-1234', { basePrice: -5 });

    expect(status).toBe(400);
  });

  it('returns 400 when trying to update a soft-deleted product', async () => {
    productService.updateProduct.mockRejectedValue(
      new Error('Cannot update a soft-deleted product.')
    );

    const { status, body } = await request('PATCH', '/test-uuid-1234', { name: 'X' });

    expect(status).toBe(400);
    expect(body.error).toMatch(/soft-deleted/);
  });

  it('returns 500 on unexpected service error', async () => {
    productService.updateProduct.mockRejectedValue(new Error('DynamoDB down'));

    const { status } = await request('PATCH', '/test-uuid-1234', { name: 'X' });

    expect(status).toBe(500);
  });
});

// ===========================================================================
// POST /api/admin/products/:productId/publish — Publish
// ===========================================================================
describe('POST /api/admin/products/:productId/publish', () => {
  it('returns 200 and the published product on success', async () => {
    productService.publishProduct.mockResolvedValue(ACTIVE_PRODUCT);

    const { status, body } = await request('POST', '/test-uuid-1234/publish');

    expect(status).toBe(200);
    expect(body.product.status).toBe('active');
    expect(productService.publishProduct).toHaveBeenCalledWith('test-uuid-1234');
  });

  it('returns 400 on invalid transition error', async () => {
    productService.publishProduct.mockRejectedValue(
      new Error("Invalid status transition: cannot move from 'active' to 'active'.")
    );

    const { status, body } = await request('POST', '/test-uuid-1234/publish');

    expect(status).toBe(400);
    expect(body.error).toMatch(/Invalid status transition/);
  });

  it('returns 404 when product is not found', async () => {
    productService.publishProduct.mockRejectedValue(
      new Error('Product not found: ghost-id')
    );

    const { status } = await request('POST', '/ghost-id/publish');

    expect(status).toBe(404);
  });

  it('returns 500 on unexpected service error', async () => {
    productService.publishProduct.mockRejectedValue(new Error('DynamoDB down'));

    const { status } = await request('POST', '/test-uuid-1234/publish');

    expect(status).toBe(500);
  });
});

// ===========================================================================
// POST /api/admin/products/:productId/archive — Archive
// ===========================================================================
describe('POST /api/admin/products/:productId/archive', () => {
  it('returns 200 and the archived product on success', async () => {
    productService.archiveProduct.mockResolvedValue(ARCHIVED_PRODUCT);

    const { status, body } = await request('POST', '/test-uuid-1234/archive');

    expect(status).toBe(200);
    expect(body.product.status).toBe('archived');
    expect(productService.archiveProduct).toHaveBeenCalledWith('test-uuid-1234');
  });

  it('returns 400 on invalid transition error', async () => {
    productService.archiveProduct.mockRejectedValue(
      new Error("Invalid status transition: cannot move from 'draft' to 'archived'.")
    );

    const { status, body } = await request('POST', '/test-uuid-1234/archive');

    expect(status).toBe(400);
    expect(body.error).toMatch(/Invalid status transition/);
  });

  it('returns 404 when product is not found', async () => {
    productService.archiveProduct.mockRejectedValue(
      new Error('Product not found: ghost-id')
    );

    const { status } = await request('POST', '/ghost-id/archive');

    expect(status).toBe(404);
  });

  it('returns 500 on unexpected service error', async () => {
    productService.archiveProduct.mockRejectedValue(new Error('DynamoDB down'));

    const { status } = await request('POST', '/test-uuid-1234/archive');

    expect(status).toBe(500);
  });
});

// ===========================================================================
// POST /api/admin/products/:productId/restore — Restore
// ===========================================================================
describe('POST /api/admin/products/:productId/restore', () => {
  it('returns 200 and the restored product on success', async () => {
    productService.restoreProduct.mockResolvedValue(DRAFT_PRODUCT);

    const { status, body } = await request('POST', '/test-uuid-1234/restore');

    expect(status).toBe(200);
    expect(body.product.status).toBe('draft');
    expect(productService.restoreProduct).toHaveBeenCalledWith('test-uuid-1234');
  });

  it('returns 400 on invalid transition error', async () => {
    productService.restoreProduct.mockRejectedValue(
      new Error("Invalid status transition: cannot move from 'active' to 'draft'.")
    );

    const { status, body } = await request('POST', '/test-uuid-1234/restore');

    expect(status).toBe(400);
    expect(body.error).toMatch(/Invalid status transition/);
  });

  it('returns 404 when product is not found', async () => {
    productService.restoreProduct.mockRejectedValue(
      new Error('Product not found: ghost-id')
    );

    const { status } = await request('POST', '/ghost-id/restore');

    expect(status).toBe(404);
  });

  it('returns 500 on unexpected service error', async () => {
    productService.restoreProduct.mockRejectedValue(new Error('DynamoDB down'));

    const { status } = await request('POST', '/test-uuid-1234/restore');

    expect(status).toBe(500);
  });
});

// ===========================================================================
// DELETE /api/admin/products/:productId — Soft-delete
// ===========================================================================
describe('DELETE /api/admin/products/:productId', () => {
  it('returns 200 and the soft-deleted product on success', async () => {
    productService.deleteProduct.mockResolvedValue(DELETED_PRODUCT);

    const { status, body } = await request('DELETE', '/test-uuid-1234');

    expect(status).toBe(200);
    expect(body.product.status).toBe('deleted');
    expect(body.product.deletedAt).toBeDefined();
    expect(productService.deleteProduct).toHaveBeenCalledWith('test-uuid-1234');
  });

  it('returns 404 when product is not found', async () => {
    productService.deleteProduct.mockRejectedValue(
      new Error('Product not found: ghost-id')
    );

    const { status, body } = await request('DELETE', '/ghost-id');

    expect(status).toBe(404);
    expect(body.error).toMatch(/Product not found/);
  });

  it('returns 400 when product is already deleted', async () => {
    productService.deleteProduct.mockRejectedValue(
      new Error('Product is already deleted.')
    );

    const { status, body } = await request('DELETE', '/test-uuid-1234');

    expect(status).toBe(400);
    expect(body.error).toMatch(/already deleted/);
  });

  it('returns 500 on unexpected service error', async () => {
    productService.deleteProduct.mockRejectedValue(new Error('DynamoDB down'));

    const { status } = await request('DELETE', '/test-uuid-1234');

    expect(status).toBe(500);
  });
});

// ===========================================================================
// Admin auth guard (isolated behaviour verification)
// ===========================================================================
describe('adminAuth middleware integration', () => {
  /**
   * Re-create the router with the REAL adminAuth to verify it blocks requests.
   * This test isolates the middleware's deny-by-default behaviour without
   * touching the mocked version used in all other tests.
   */
  it('returns 503 when real adminAuth middleware is applied (placeholder blocks all)', (done) => {
    // Load the actual middleware, bypassing the jest.mock() set for this file.
    // We use jest.requireActual so the mock for this test file doesn't interfere.
    const { adminAuth: realAdminAuth } = jest.requireActual(
      '../../middleware/adminAuth'
    );

    const app = express();
    app.use(express.json());

    // Apply real auth guard to a mini router
    const miniRouter = express.Router();
    miniRouter.use(realAdminAuth);
    miniRouter.get('/', (req, res) => res.json({ ok: true }));
    app.use('/test', miniRouter);

    const srv = http.createServer(app);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      const reqOptions = {
        hostname: '127.0.0.1',
        port,
        path: '/test',
        method: 'GET',
      };

      http.get(reqOptions, (res) => {
        let raw = '';
        res.on('data', (c) => { raw += c; });
        res.on('end', () => {
          srv.close();
          expect(res.statusCode).toBe(503);
          const body = JSON.parse(raw);
          expect(body.error).toMatch(/Admin authentication is not yet configured/);
          done();
        });
      }).on('error', (e) => { srv.close(); done(e); });
    });
  });
});
