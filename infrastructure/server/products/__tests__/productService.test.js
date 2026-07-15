'use strict';

/**
 * Tests for ProductService
 *
 * Strategy:
 *   1. Mock the entire productRepository module so that require('uuid') and
 *      DynamoDB SDK imports are never evaluated during the test run.
 *   2. Also inject a mock repository directly into service methods (via the
 *      optional `_repo` parameter) for fine-grained per-test control.
 *
 * The jest.mock() call handles the module-level import; the `makeMockRepo()`
 * helper handles test-level injection.
 */

// Mock the productRepository module before it is required by productService,
// preventing uuid / DynamoDB SDK ESM-only imports from being evaluated.
jest.mock('../productRepository', () => ({
  createProduct: jest.fn(),
  getProductById: jest.fn(),
  getProductBySlug: jest.fn(),
  listProducts: jest.fn(),
  updateProduct: jest.fn(),
}));

// Also mock uuid and the DynamoDB clients to satisfy any transitive require.
jest.mock('uuid', () => ({ v4: jest.fn(() => 'mocked-uuid') }));
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

const {
  createProduct,
  getProduct,
  getProductBySlug,
  listProducts,
  updateProduct,
  publishProduct,
  archiveProduct,
  restoreProduct,
  deleteProduct,
  generateSlug,
  resolveUniqueSlug,
} = require('../productService');

// ---------------------------------------------------------------------------
// Helpers / shared fixtures
// ---------------------------------------------------------------------------

/** Build a minimal mock repository with all methods as jest.fn() stubs. */
function makeMockRepo(overrides = {}) {
  return {
    createProduct: jest.fn(),
    getProductById: jest.fn(),
    getProductBySlug: jest.fn(),
    listProducts: jest.fn(),
    updateProduct: jest.fn(),
    ...overrides,
  };
}

const VALID_INPUT = {
  name: 'Vinyl Banner',
  description: 'High-quality outdoor vinyl banner',
  basePrice: 4999, // $49.99 in cents
};

const STORED_PRODUCT = {
  productId: 'test-uuid-1234',
  name: 'Vinyl Banner',
  description: 'High-quality outdoor vinyl banner',
  slug: 'vinyl-banner',
  status: 'draft',
  basePrice: 4999,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// generateSlug (pure function – no async, no repo)
// ---------------------------------------------------------------------------
describe('generateSlug', () => {
  it('lowercases the input', () => {
    expect(generateSlug('Vinyl Banner')).toBe('vinyl-banner');
  });

  it('replaces spaces with hyphens', () => {
    expect(generateSlug('Church T Shirt')).toBe('church-t-shirt');
  });

  it('strips special characters', () => {
    expect(generateSlug('Roll-Up Banner!')).toBe('roll-up-banner');
  });

  it('collapses multiple spaces/hyphens into one hyphen', () => {
    expect(generateSlug('  Big   Church   Sign  ')).toBe('big-church-sign');
  });

  it('handles all-numeric names', () => {
    expect(generateSlug('12345')).toBe('12345');
  });

  it('handles unicode / accented characters by stripping them', () => {
    // Non-ASCII characters are replaced with spaces → collapsed to hyphens
    expect(generateSlug('Café Banner')).toBe('caf-banner');
  });

  it('returns an empty string for a whitespace-only input', () => {
    expect(generateSlug('   ')).toBe('');
  });
});

// ---------------------------------------------------------------------------
// resolveUniqueSlug
// ---------------------------------------------------------------------------
describe('resolveUniqueSlug', () => {
  it('returns the base slug when it is not already taken', async () => {
    const repo = makeMockRepo({
      getProductBySlug: jest.fn().mockResolvedValue(null),
    });

    const slug = await resolveUniqueSlug('vinyl-banner', repo);
    expect(slug).toBe('vinyl-banner');
    expect(repo.getProductBySlug).toHaveBeenCalledTimes(1);
    expect(repo.getProductBySlug).toHaveBeenCalledWith('vinyl-banner');
  });

  it('appends -2 when the base slug is taken', async () => {
    const repo = makeMockRepo({
      getProductBySlug: jest.fn()
        .mockResolvedValueOnce({ productId: 'existing' }) // 'vinyl-banner' taken
        .mockResolvedValueOnce(null),                      // 'vinyl-banner-2' free
    });

    const slug = await resolveUniqueSlug('vinyl-banner', repo);
    expect(slug).toBe('vinyl-banner-2');
    expect(repo.getProductBySlug).toHaveBeenCalledTimes(2);
  });

  it('increments suffix until it finds a free slot', async () => {
    const repo = makeMockRepo({
      getProductBySlug: jest.fn()
        .mockResolvedValueOnce({ productId: 'a' }) // base taken
        .mockResolvedValueOnce({ productId: 'b' }) // -2 taken
        .mockResolvedValueOnce({ productId: 'c' }) // -3 taken
        .mockResolvedValueOnce(null),               // -4 free
    });

    const slug = await resolveUniqueSlug('banner', repo);
    expect(slug).toBe('banner-4');
  });

  it('throws when no unique slug can be found within MAX_SLUG_ATTEMPTS', async () => {
    // Always return a taken product
    const repo = makeMockRepo({
      getProductBySlug: jest.fn().mockResolvedValue({ productId: 'taken' }),
    });

    await expect(resolveUniqueSlug('banner', repo)).rejects.toThrow(
      'Unable to generate a unique slug'
    );
  });
});

// ---------------------------------------------------------------------------
// createProduct
// ---------------------------------------------------------------------------
describe('createProduct', () => {
  it('creates a product with auto-generated slug and default status', async () => {
    const repo = makeMockRepo({
      getProductBySlug: jest.fn().mockResolvedValue(null), // slug is free
      createProduct: jest.fn().mockResolvedValue(STORED_PRODUCT),
    });

    const result = await createProduct(VALID_INPUT, repo);

    expect(result).toEqual(STORED_PRODUCT);

    // Should have checked slug uniqueness
    expect(repo.getProductBySlug).toHaveBeenCalledWith('vinyl-banner');

    // Should have called createProduct with slug and default status
    expect(repo.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Vinyl Banner',
        slug: 'vinyl-banner',
        status: 'draft',
        basePrice: 4999,
      })
    );
  });

  it('respects a caller-provided slug when given', async () => {
    const repo = makeMockRepo({
      getProductBySlug: jest.fn().mockResolvedValue(null),
      createProduct: jest.fn().mockResolvedValue({ ...STORED_PRODUCT, slug: 'custom-slug' }),
    });

    await createProduct({ ...VALID_INPUT, slug: 'custom-slug' }, repo);

    expect(repo.getProductBySlug).toHaveBeenCalledWith('custom-slug');
    expect(repo.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'custom-slug' })
    );
  });

  it('respects a caller-provided status', async () => {
    const repo = makeMockRepo({
      getProductBySlug: jest.fn().mockResolvedValue(null),
      createProduct: jest.fn().mockResolvedValue({ ...STORED_PRODUCT, status: 'active' }),
    });

    await createProduct({ ...VALID_INPUT, status: 'active' }, repo);

    expect(repo.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'active' })
    );
  });

  it('uses default status "draft" when none is supplied', async () => {
    const repo = makeMockRepo({
      getProductBySlug: jest.fn().mockResolvedValue(null),
      createProduct: jest.fn().mockResolvedValue(STORED_PRODUCT),
    });

    const { status: _ignore, ...inputWithoutStatus } = VALID_INPUT;
    await createProduct(inputWithoutStatus, repo);

    expect(repo.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'draft' })
    );
  });

  it('detects a duplicate slug and appends numeric suffix', async () => {
    const repo = makeMockRepo({
      getProductBySlug: jest.fn()
        .mockResolvedValueOnce({ productId: 'existing-1' }) // 'vinyl-banner' taken
        .mockResolvedValueOnce(null),                        // 'vinyl-banner-2' free
      createProduct: jest.fn().mockResolvedValue({ ...STORED_PRODUCT, slug: 'vinyl-banner-2' }),
    });

    const result = await createProduct(VALID_INPUT, repo);

    expect(repo.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'vinyl-banner-2' })
    );
    expect(result.slug).toBe('vinyl-banner-2');
  });

  it('trims whitespace from the name', async () => {
    const repo = makeMockRepo({
      getProductBySlug: jest.fn().mockResolvedValue(null),
      createProduct: jest.fn().mockResolvedValue(STORED_PRODUCT),
    });

    await createProduct({ ...VALID_INPUT, name: '  Vinyl Banner  ' }, repo);

    expect(repo.createProduct).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Vinyl Banner' })
    );
  });

  // --- Validation failures ---

  it('throws when name is missing', async () => {
    const repo = makeMockRepo();
    const { name: _ignore, ...noName } = VALID_INPUT;

    await expect(createProduct(noName, repo)).rejects.toThrow(
      'name is required and must be a non-empty string.'
    );
    expect(repo.createProduct).not.toHaveBeenCalled();
  });

  it('throws when name is an empty string', async () => {
    const repo = makeMockRepo();

    await expect(createProduct({ ...VALID_INPUT, name: '' }, repo)).rejects.toThrow(
      'name is required and must be a non-empty string.'
    );
    expect(repo.createProduct).not.toHaveBeenCalled();
  });

  it('throws when name is whitespace-only', async () => {
    const repo = makeMockRepo();

    await expect(createProduct({ ...VALID_INPUT, name: '   ' }, repo)).rejects.toThrow(
      'name is required and must be a non-empty string.'
    );
    expect(repo.createProduct).not.toHaveBeenCalled();
  });

  it('throws when basePrice is a float', async () => {
    const repo = makeMockRepo();

    await expect(
      createProduct({ ...VALID_INPUT, basePrice: 49.99 }, repo)
    ).rejects.toThrow('basePrice must be a non-negative integer representing cents');
    expect(repo.createProduct).not.toHaveBeenCalled();
  });

  it('throws when basePrice is negative', async () => {
    const repo = makeMockRepo();

    await expect(
      createProduct({ ...VALID_INPUT, basePrice: -1 }, repo)
    ).rejects.toThrow('basePrice must be a non-negative integer representing cents');
    expect(repo.createProduct).not.toHaveBeenCalled();
  });

  it('throws when basePrice is missing', async () => {
    const repo = makeMockRepo();
    const { basePrice: _ignore, ...noPrice } = VALID_INPUT;

    await expect(createProduct(noPrice, repo)).rejects.toThrow(
      'basePrice must be a non-negative integer representing cents'
    );
    expect(repo.createProduct).not.toHaveBeenCalled();
  });

  it('allows basePrice of 0 (free product)', async () => {
    const repo = makeMockRepo({
      getProductBySlug: jest.fn().mockResolvedValue(null),
      createProduct: jest.fn().mockResolvedValue({ ...STORED_PRODUCT, basePrice: 0 }),
    });

    await expect(
      createProduct({ ...VALID_INPUT, basePrice: 0 }, repo)
    ).resolves.toBeDefined();
    expect(repo.createProduct).toHaveBeenCalled();
  });

  it('throws when status is invalid', async () => {
    const repo = makeMockRepo();

    await expect(
      createProduct({ ...VALID_INPUT, status: 'published' }, repo)
    ).rejects.toThrow('status must be one of: active, draft, archived.');
    expect(repo.createProduct).not.toHaveBeenCalled();
  });

  it('accepts all valid status values', async () => {
    for (const status of ['active', 'draft', 'archived']) {
      const repo = makeMockRepo({
        getProductBySlug: jest.fn().mockResolvedValue(null),
        createProduct: jest.fn().mockResolvedValue({ ...STORED_PRODUCT, status }),
      });

      await expect(
        createProduct({ ...VALID_INPUT, status }, repo)
      ).resolves.toBeDefined();
    }
  });

  it('throws when productData is null', async () => {
    const repo = makeMockRepo();

    await expect(createProduct(null, repo)).rejects.toThrow(
      'Product data must be a non-null object.'
    );
  });

  it('forwards repository errors to the caller', async () => {
    const repo = makeMockRepo({
      getProductBySlug: jest.fn().mockResolvedValue(null),
      createProduct: jest.fn().mockRejectedValue(new Error('DynamoDB down')),
    });

    await expect(createProduct(VALID_INPUT, repo)).rejects.toThrow('DynamoDB down');
  });
});

// ---------------------------------------------------------------------------
// getProduct
// ---------------------------------------------------------------------------
describe('getProduct', () => {
  it('returns the product when found by ID', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(STORED_PRODUCT),
    });

    const result = await getProduct('test-uuid-1234', repo);

    expect(result).toEqual(STORED_PRODUCT);
    expect(repo.getProductById).toHaveBeenCalledWith('test-uuid-1234');
  });

  it('returns null when the product does not exist', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(null),
    });

    const result = await getProduct('non-existent-uuid', repo);

    expect(result).toBeNull();
  });

  it('trims whitespace from productId', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(null),
    });

    await getProduct('  test-uuid-1234  ', repo);

    expect(repo.getProductById).toHaveBeenCalledWith('test-uuid-1234');
  });

  it('throws when productId is an empty string', async () => {
    const repo = makeMockRepo();

    await expect(getProduct('', repo)).rejects.toThrow(
      'productId must be a non-empty string.'
    );
    expect(repo.getProductById).not.toHaveBeenCalled();
  });

  it('throws when productId is whitespace-only', async () => {
    const repo = makeMockRepo();

    await expect(getProduct('   ', repo)).rejects.toThrow(
      'productId must be a non-empty string.'
    );
    expect(repo.getProductById).not.toHaveBeenCalled();
  });

  it('throws when productId is not a string', async () => {
    const repo = makeMockRepo();

    await expect(getProduct(42, repo)).rejects.toThrow(
      'productId must be a non-empty string.'
    );
    expect(repo.getProductById).not.toHaveBeenCalled();
  });

  it('throws when productId is null', async () => {
    const repo = makeMockRepo();

    await expect(getProduct(null, repo)).rejects.toThrow(
      'productId must be a non-empty string.'
    );
    expect(repo.getProductById).not.toHaveBeenCalled();
  });

  it('forwards repository errors to the caller', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockRejectedValue(new Error('ResourceNotFoundException')),
    });

    await expect(getProduct('any-uuid', repo)).rejects.toThrow('ResourceNotFoundException');
  });
});

// ---------------------------------------------------------------------------
// getProductBySlug
// ---------------------------------------------------------------------------
describe('getProductBySlug', () => {
  it('returns the product when found by slug', async () => {
    const repo = makeMockRepo({
      getProductBySlug: jest.fn().mockResolvedValue(STORED_PRODUCT),
    });

    const result = await getProductBySlug('vinyl-banner', repo);

    expect(result).toEqual(STORED_PRODUCT);
    expect(repo.getProductBySlug).toHaveBeenCalledWith('vinyl-banner');
  });

  it('returns null when no product matches the slug', async () => {
    const repo = makeMockRepo({
      getProductBySlug: jest.fn().mockResolvedValue(null),
    });

    const result = await getProductBySlug('non-existent-slug', repo);

    expect(result).toBeNull();
  });

  it('trims whitespace from the slug', async () => {
    const repo = makeMockRepo({
      getProductBySlug: jest.fn().mockResolvedValue(null),
    });

    await getProductBySlug('  vinyl-banner  ', repo);

    expect(repo.getProductBySlug).toHaveBeenCalledWith('vinyl-banner');
  });

  it('throws when slug is an empty string', async () => {
    const repo = makeMockRepo();

    await expect(getProductBySlug('', repo)).rejects.toThrow(
      'slug must be a non-empty string.'
    );
    expect(repo.getProductBySlug).not.toHaveBeenCalled();
  });

  it('throws when slug is whitespace-only', async () => {
    const repo = makeMockRepo();

    await expect(getProductBySlug('   ', repo)).rejects.toThrow(
      'slug must be a non-empty string.'
    );
    expect(repo.getProductBySlug).not.toHaveBeenCalled();
  });

  it('throws when slug is not a string', async () => {
    const repo = makeMockRepo();

    await expect(getProductBySlug(123, repo)).rejects.toThrow(
      'slug must be a non-empty string.'
    );
    expect(repo.getProductBySlug).not.toHaveBeenCalled();
  });

  it('throws when slug is null', async () => {
    const repo = makeMockRepo();

    await expect(getProductBySlug(null, repo)).rejects.toThrow(
      'slug must be a non-empty string.'
    );
    expect(repo.getProductBySlug).not.toHaveBeenCalled();
  });

  it('forwards repository errors to the caller', async () => {
    const repo = makeMockRepo({
      getProductBySlug: jest.fn().mockRejectedValue(new Error('InternalServerError')),
    });

    await expect(getProductBySlug('vinyl-banner', repo)).rejects.toThrow('InternalServerError');
  });
});

// ---------------------------------------------------------------------------
// listProducts
// ---------------------------------------------------------------------------
describe('listProducts', () => {
  const SAMPLE_ITEMS = [
    { productId: 'p1', name: 'Product 1', slug: 'product-1', status: 'active', basePrice: 999 },
    { productId: 'p2', name: 'Product 2', slug: 'product-2', status: 'draft',  basePrice: 1499 },
  ];

  it('returns items and null nextCursor when no more pages', async () => {
    const repo = makeMockRepo({
      listProducts: jest.fn().mockResolvedValue({ items: SAMPLE_ITEMS, nextCursor: null }),
    });

    const result = await listProducts({}, repo);

    expect(result.items).toEqual(SAMPLE_ITEMS);
    expect(result.nextCursor).toBeNull();
    expect(repo.listProducts).toHaveBeenCalledWith({});
  });

  it('passes options directly to the repository', async () => {
    const repo = makeMockRepo({
      listProducts: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    });

    const options = { limit: 5, status: 'active', cursor: 'abc123' };
    await listProducts(options, repo);

    expect(repo.listProducts).toHaveBeenCalledWith(options);
  });

  it('uses empty options when called with no arguments', async () => {
    const repo = makeMockRepo({
      listProducts: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
    });

    await listProducts(undefined, repo);

    expect(repo.listProducts).toHaveBeenCalledWith({});
  });

  it('returns the nextCursor when there are more pages', async () => {
    const cursor = Buffer.from(JSON.stringify({ productId: 'last-id' })).toString('base64');
    const repo = makeMockRepo({
      listProducts: jest.fn().mockResolvedValue({ items: SAMPLE_ITEMS, nextCursor: cursor }),
    });

    const result = await listProducts({ limit: 2 }, repo);

    expect(result.nextCursor).toBe(cursor);
  });

  it('throws when limit is 0', async () => {
    const repo = makeMockRepo();

    await expect(listProducts({ limit: 0 }, repo)).rejects.toThrow(
      'limit must be a positive integer.'
    );
    expect(repo.listProducts).not.toHaveBeenCalled();
  });

  it('throws when limit is negative', async () => {
    const repo = makeMockRepo();

    await expect(listProducts({ limit: -5 }, repo)).rejects.toThrow(
      'limit must be a positive integer.'
    );
    expect(repo.listProducts).not.toHaveBeenCalled();
  });

  it('throws when limit is a float', async () => {
    const repo = makeMockRepo();

    await expect(listProducts({ limit: 2.5 }, repo)).rejects.toThrow(
      'limit must be a positive integer.'
    );
    expect(repo.listProducts).not.toHaveBeenCalled();
  });

  it('throws when status is an invalid value', async () => {
    const repo = makeMockRepo();

    await expect(listProducts({ status: 'unknown' }, repo)).rejects.toThrow(
      'status must be one of: active, draft, archived.'
    );
    expect(repo.listProducts).not.toHaveBeenCalled();
  });

  it('accepts all valid status values without error', async () => {
    for (const status of ['active', 'draft', 'archived']) {
      const repo = makeMockRepo({
        listProducts: jest.fn().mockResolvedValue({ items: [], nextCursor: null }),
      });

      await expect(listProducts({ status }, repo)).resolves.toBeDefined();
    }
  });

  it('forwards repository errors to the caller', async () => {
    const repo = makeMockRepo({
      listProducts: jest.fn().mockRejectedValue(new Error('DynamoDB error')),
    });

    await expect(listProducts({}, repo)).rejects.toThrow('DynamoDB error');
  });
});

// ---------------------------------------------------------------------------
// Shared helpers for Sprint 1 Task 2.5 tests
// ---------------------------------------------------------------------------

const makeDraft    = (overrides = {}) => ({ ...STORED_PRODUCT, status: 'draft',    ...overrides });
const makeActive   = (overrides = {}) => ({ ...STORED_PRODUCT, status: 'active',   ...overrides });
const makeArchived = (overrides = {}) => ({ ...STORED_PRODUCT, status: 'archived', ...overrides });
const makeDeleted  = (overrides = {}) => ({
  ...STORED_PRODUCT,
  status: 'deleted',
  deletedAt: '2026-03-01T00:00:00.000Z',
  ...overrides,
});

// ---------------------------------------------------------------------------
// updateProduct
// ---------------------------------------------------------------------------
describe('updateProduct', () => {
  const UPDATED_PRODUCT = {
    ...STORED_PRODUCT,
    name: 'Vinyl Banner XL',
    updatedAt: '2026-06-01T00:00:00.000Z',
  };

  it('updates a product name successfully', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
      updateProduct:  jest.fn().mockResolvedValue(UPDATED_PRODUCT),
    });

    const result = await updateProduct('test-uuid-1234', { name: 'Vinyl Banner XL' }, repo);

    expect(result).toEqual(UPDATED_PRODUCT);
    expect(repo.updateProduct).toHaveBeenCalledWith(
      'test-uuid-1234',
      expect.objectContaining({ name: 'Vinyl Banner XL' })
    );
  });

  it('trims whitespace from name in updates', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
      updateProduct:  jest.fn().mockResolvedValue(UPDATED_PRODUCT),
    });

    await updateProduct('test-uuid-1234', { name: '  Vinyl Banner XL  ' }, repo);

    expect(repo.updateProduct).toHaveBeenCalledWith(
      'test-uuid-1234',
      expect.objectContaining({ name: 'Vinyl Banner XL' })
    );
  });

  it('updates basePrice successfully', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
      updateProduct:  jest.fn().mockResolvedValue({ ...STORED_PRODUCT, basePrice: 7999 }),
    });

    await updateProduct('test-uuid-1234', { basePrice: 7999 }, repo);

    expect(repo.updateProduct).toHaveBeenCalledWith(
      'test-uuid-1234',
      expect.objectContaining({ basePrice: 7999 })
    );
  });

  it('updates description successfully', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
      updateProduct:  jest.fn().mockResolvedValue({ ...STORED_PRODUCT, description: 'New desc' }),
    });

    await updateProduct('test-uuid-1234', { description: 'New desc' }, repo);

    expect(repo.updateProduct).toHaveBeenCalledWith(
      'test-uuid-1234',
      expect.objectContaining({ description: 'New desc' })
    );
  });

  it('updates status to a valid value', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
      updateProduct:  jest.fn().mockResolvedValue({ ...STORED_PRODUCT, status: 'active' }),
    });

    await updateProduct('test-uuid-1234', { status: 'active' }, repo);

    expect(repo.updateProduct).toHaveBeenCalledWith(
      'test-uuid-1234',
      expect.objectContaining({ status: 'active' })
    );
  });

  it('silently strips immutable fields (productId, slug, createdAt, updatedAt, deletedAt)', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
      updateProduct:  jest.fn().mockResolvedValue(UPDATED_PRODUCT),
    });

    await updateProduct('test-uuid-1234', {
      name: 'New Name',
      productId: 'hacked-id',
      slug: 'hacked-slug',
      createdAt: '1970-01-01T00:00:00.000Z',
      updatedAt: '1970-01-01T00:00:00.000Z',
      deletedAt: '1970-01-01T00:00:00.000Z',
    }, repo);

    const passedUpdates = repo.updateProduct.mock.calls[0][1];
    expect(passedUpdates).not.toHaveProperty('productId');
    expect(passedUpdates).not.toHaveProperty('slug');
    expect(passedUpdates).not.toHaveProperty('createdAt');
    expect(passedUpdates).not.toHaveProperty('updatedAt');
    expect(passedUpdates).not.toHaveProperty('deletedAt');
    expect(passedUpdates).toHaveProperty('name', 'New Name');
  });

  it('preserves createdAt by not passing it to the repo', async () => {
    const originalCreatedAt = '2026-01-01T00:00:00.000Z';
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft({ createdAt: originalCreatedAt })),
      updateProduct:  jest.fn().mockResolvedValue(UPDATED_PRODUCT),
    });

    await updateProduct('test-uuid-1234', { name: 'New Name', createdAt: 'tampered' }, repo);

    const passedUpdates = repo.updateProduct.mock.calls[0][1];
    expect(passedUpdates).not.toHaveProperty('createdAt');
  });

  it('throws when productId is an empty string', async () => {
    const repo = makeMockRepo();
    await expect(updateProduct('', {}, repo)).rejects.toThrow('productId must be a non-empty string.');
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when productId is whitespace-only', async () => {
    const repo = makeMockRepo();
    await expect(updateProduct('   ', {}, repo)).rejects.toThrow('productId must be a non-empty string.');
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when productId is not a string', async () => {
    const repo = makeMockRepo();
    await expect(updateProduct(42, {}, repo)).rejects.toThrow('productId must be a non-empty string.');
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when updates is null', async () => {
    const repo = makeMockRepo();
    await expect(updateProduct('test-uuid-1234', null, repo)).rejects.toThrow(
      'updates must be a non-null object.'
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when updates is an array', async () => {
    const repo = makeMockRepo();
    await expect(updateProduct('test-uuid-1234', [], repo)).rejects.toThrow(
      'updates must be a non-null object.'
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when product is not found', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(null),
    });
    await expect(updateProduct('ghost-id', { name: 'X' }, repo)).rejects.toThrow(
      'Product not found: ghost-id'
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when the product is soft-deleted', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDeleted()),
    });
    await expect(updateProduct('test-uuid-1234', { name: 'X' }, repo)).rejects.toThrow(
      'Cannot update a soft-deleted product.'
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when name is an empty string', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
    });
    await expect(updateProduct('test-uuid-1234', { name: '' }, repo)).rejects.toThrow(
      'name must be a non-empty string.'
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when name is whitespace-only', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
    });
    await expect(updateProduct('test-uuid-1234', { name: '   ' }, repo)).rejects.toThrow(
      'name must be a non-empty string.'
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when basePrice is a float', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
    });
    await expect(updateProduct('test-uuid-1234', { basePrice: 19.99 }, repo)).rejects.toThrow(
      'basePrice must be a non-negative integer'
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when basePrice is negative', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
    });
    await expect(updateProduct('test-uuid-1234', { basePrice: -1 }, repo)).rejects.toThrow(
      'basePrice must be a non-negative integer'
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('allows basePrice of 0 (free product)', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
      updateProduct:  jest.fn().mockResolvedValue({ ...STORED_PRODUCT, basePrice: 0 }),
    });
    await expect(updateProduct('test-uuid-1234', { basePrice: 0 }, repo)).resolves.toBeDefined();
    expect(repo.updateProduct).toHaveBeenCalled();
  });

  it('throws when status is an invalid value', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
    });
    await expect(updateProduct('test-uuid-1234', { status: 'deleted' }, repo)).rejects.toThrow(
      'status must be one of: active, draft, archived.'
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('forwards repository errors to the caller', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
      updateProduct:  jest.fn().mockRejectedValue(new Error('DynamoDB down')),
    });
    await expect(updateProduct('test-uuid-1234', { name: 'New Name' }, repo)).rejects.toThrow(
      'DynamoDB down'
    );
  });
});

// ---------------------------------------------------------------------------
// publishProduct
// ---------------------------------------------------------------------------
describe('publishProduct', () => {
  it('transitions a draft product to active', async () => {
    const published = makeActive();
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
      updateProduct:  jest.fn().mockResolvedValue(published),
    });

    const result = await publishProduct('test-uuid-1234', repo);

    expect(result.status).toBe('active');
    expect(repo.updateProduct).toHaveBeenCalledWith(
      'test-uuid-1234',
      { status: 'active' }
    );
  });

  it('throws when trying to publish an already-active product', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeActive()),
    });
    await expect(publishProduct('test-uuid-1234', repo)).rejects.toThrow(
      "Invalid status transition: cannot move from 'active' to 'active'."
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when trying to publish an archived product', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeArchived()),
    });
    await expect(publishProduct('test-uuid-1234', repo)).rejects.toThrow(
      "Invalid status transition: cannot move from 'archived' to 'active'."
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when trying to publish a soft-deleted product', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDeleted()),
    });
    await expect(publishProduct('test-uuid-1234', repo)).rejects.toThrow(
      "Invalid status transition: cannot move from 'deleted' to 'active'."
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when product is not found', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(null),
    });
    await expect(publishProduct('ghost-id', repo)).rejects.toThrow(
      'Product not found: ghost-id'
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when productId is empty', async () => {
    const repo = makeMockRepo();
    await expect(publishProduct('', repo)).rejects.toThrow('productId must be a non-empty string.');
    expect(repo.getProductById).not.toHaveBeenCalled();
  });

  it('forwards repository errors from updateProduct', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
      updateProduct:  jest.fn().mockRejectedValue(new Error('DynamoDB down')),
    });
    await expect(publishProduct('test-uuid-1234', repo)).rejects.toThrow('DynamoDB down');
  });
});

// ---------------------------------------------------------------------------
// archiveProduct
// ---------------------------------------------------------------------------
describe('archiveProduct', () => {
  it('transitions an active product to archived', async () => {
    const archived = makeArchived();
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeActive()),
      updateProduct:  jest.fn().mockResolvedValue(archived),
    });

    const result = await archiveProduct('test-uuid-1234', repo);

    expect(result.status).toBe('archived');
    expect(repo.updateProduct).toHaveBeenCalledWith(
      'test-uuid-1234',
      { status: 'archived' }
    );
  });

  it('throws when trying to archive a draft product', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
    });
    await expect(archiveProduct('test-uuid-1234', repo)).rejects.toThrow(
      "Invalid status transition: cannot move from 'draft' to 'archived'."
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when trying to archive an already-archived product', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeArchived()),
    });
    await expect(archiveProduct('test-uuid-1234', repo)).rejects.toThrow(
      "Invalid status transition: cannot move from 'archived' to 'archived'."
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when trying to archive a soft-deleted product', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDeleted()),
    });
    await expect(archiveProduct('test-uuid-1234', repo)).rejects.toThrow(
      "Invalid status transition: cannot move from 'deleted' to 'archived'."
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when product is not found', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(null),
    });
    await expect(archiveProduct('ghost-id', repo)).rejects.toThrow(
      'Product not found: ghost-id'
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when productId is empty', async () => {
    const repo = makeMockRepo();
    await expect(archiveProduct('', repo)).rejects.toThrow('productId must be a non-empty string.');
    expect(repo.getProductById).not.toHaveBeenCalled();
  });

  it('forwards repository errors from updateProduct', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeActive()),
      updateProduct:  jest.fn().mockRejectedValue(new Error('DynamoDB down')),
    });
    await expect(archiveProduct('test-uuid-1234', repo)).rejects.toThrow('DynamoDB down');
  });
});

// ---------------------------------------------------------------------------
// restoreProduct
// ---------------------------------------------------------------------------
describe('restoreProduct', () => {
  it('transitions an archived product back to draft', async () => {
    const restored = makeDraft();
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeArchived()),
      updateProduct:  jest.fn().mockResolvedValue(restored),
    });

    const result = await restoreProduct('test-uuid-1234', repo);

    expect(result.status).toBe('draft');
    expect(repo.updateProduct).toHaveBeenCalledWith(
      'test-uuid-1234',
      { status: 'draft' }
    );
  });

  it('throws when trying to restore an active product', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeActive()),
    });
    await expect(restoreProduct('test-uuid-1234', repo)).rejects.toThrow(
      "Invalid status transition: cannot move from 'active' to 'draft'."
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when trying to restore a draft product', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
    });
    await expect(restoreProduct('test-uuid-1234', repo)).rejects.toThrow(
      "Invalid status transition: cannot move from 'draft' to 'draft'."
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when trying to restore a soft-deleted product', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDeleted()),
    });
    await expect(restoreProduct('test-uuid-1234', repo)).rejects.toThrow(
      "Invalid status transition: cannot move from 'deleted' to 'draft'."
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when product is not found', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(null),
    });
    await expect(restoreProduct('ghost-id', repo)).rejects.toThrow(
      'Product not found: ghost-id'
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when productId is empty', async () => {
    const repo = makeMockRepo();
    await expect(restoreProduct('', repo)).rejects.toThrow('productId must be a non-empty string.');
    expect(repo.getProductById).not.toHaveBeenCalled();
  });

  it('forwards repository errors from updateProduct', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeArchived()),
      updateProduct:  jest.fn().mockRejectedValue(new Error('DynamoDB down')),
    });
    await expect(restoreProduct('test-uuid-1234', repo)).rejects.toThrow('DynamoDB down');
  });
});

// ---------------------------------------------------------------------------
// deleteProduct (soft delete)
// ---------------------------------------------------------------------------
describe('deleteProduct', () => {
  it('soft-deletes a draft product', async () => {
    const deleted = makeDeleted();
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
      updateProduct:  jest.fn().mockResolvedValue(deleted),
    });

    const result = await deleteProduct('test-uuid-1234', repo);

    expect(result.status).toBe('deleted');
    expect(result.deletedAt).toBeDefined();

    // repo.updateProduct must be called with status:'deleted' and a deletedAt timestamp
    expect(repo.updateProduct).toHaveBeenCalledWith(
      'test-uuid-1234',
      expect.objectContaining({
        status: 'deleted',
        deletedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      })
    );
  });

  it('soft-deletes an active product', async () => {
    const deleted = makeDeleted();
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeActive()),
      updateProduct:  jest.fn().mockResolvedValue(deleted),
    });

    const result = await deleteProduct('test-uuid-1234', repo);

    expect(result.status).toBe('deleted');
    expect(repo.updateProduct).toHaveBeenCalledWith(
      'test-uuid-1234',
      expect.objectContaining({ status: 'deleted' })
    );
  });

  it('soft-deletes an archived product', async () => {
    const deleted = makeDeleted();
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeArchived()),
      updateProduct:  jest.fn().mockResolvedValue(deleted),
    });

    await deleteProduct('test-uuid-1234', repo);

    expect(repo.updateProduct).toHaveBeenCalledWith(
      'test-uuid-1234',
      expect.objectContaining({ status: 'deleted' })
    );
  });

  it('passes a deletedAt ISO timestamp to the repository', async () => {
    const before = Date.now();
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
      updateProduct:  jest.fn().mockResolvedValue(makeDeleted()),
    });

    await deleteProduct('test-uuid-1234', repo);

    const callArgs = repo.updateProduct.mock.calls[0][1];
    const deletedAt = new Date(callArgs.deletedAt).getTime();
    const after = Date.now();
    expect(deletedAt).toBeGreaterThanOrEqual(before);
    expect(deletedAt).toBeLessThanOrEqual(after);
  });

  it('does NOT pass createdAt to repo (preserves original)', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
      updateProduct:  jest.fn().mockResolvedValue(makeDeleted()),
    });

    await deleteProduct('test-uuid-1234', repo);

    const callArgs = repo.updateProduct.mock.calls[0][1];
    expect(callArgs).not.toHaveProperty('createdAt');
  });

  it('throws when the product is already deleted', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDeleted()),
    });
    await expect(deleteProduct('test-uuid-1234', repo)).rejects.toThrow(
      'Product is already deleted.'
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when product is not found', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(null),
    });
    await expect(deleteProduct('ghost-id', repo)).rejects.toThrow(
      'Product not found: ghost-id'
    );
    expect(repo.updateProduct).not.toHaveBeenCalled();
  });

  it('throws when productId is an empty string', async () => {
    const repo = makeMockRepo();
    await expect(deleteProduct('', repo)).rejects.toThrow('productId must be a non-empty string.');
    expect(repo.getProductById).not.toHaveBeenCalled();
  });

  it('throws when productId is whitespace-only', async () => {
    const repo = makeMockRepo();
    await expect(deleteProduct('   ', repo)).rejects.toThrow('productId must be a non-empty string.');
    expect(repo.getProductById).not.toHaveBeenCalled();
  });

  it('throws when productId is not a string', async () => {
    const repo = makeMockRepo();
    await expect(deleteProduct(null, repo)).rejects.toThrow('productId must be a non-empty string.');
    expect(repo.getProductById).not.toHaveBeenCalled();
  });

  it('forwards repository errors from updateProduct', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockResolvedValue(makeDraft()),
      updateProduct:  jest.fn().mockRejectedValue(new Error('DynamoDB down')),
    });
    await expect(deleteProduct('test-uuid-1234', repo)).rejects.toThrow('DynamoDB down');
  });

  it('forwards repository errors from getProductById', async () => {
    const repo = makeMockRepo({
      getProductById: jest.fn().mockRejectedValue(new Error('Read error')),
    });
    await expect(deleteProduct('test-uuid-1234', repo)).rejects.toThrow('Read error');
  });
});
