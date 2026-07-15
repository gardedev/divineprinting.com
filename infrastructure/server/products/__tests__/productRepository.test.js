'use strict';

// ---------------------------------------------------------------------------
// Mock @aws-sdk/lib-dynamodb BEFORE requiring the module under test so that
// Jest replaces the real DynamoDB client with controllable stubs.
// ---------------------------------------------------------------------------
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();

  // Minimal stub constructors – we only need to capture the command input.
  function PutCommand(input) {
    this.input = input;
  }
  function GetCommand(input) {
    this.input = input;
  }
  function QueryCommand(input) {
    this.input = input;
  }
  function ScanCommand(input) {
    this.input = input;
  }
  function UpdateCommand(input) {
    this.input = input;
  }

  // DynamoDBDocumentClient stub with a static `from` factory that returns an
  // object exposing only the `send` spy.
  const DynamoDBDocumentClient = {
    from: jest.fn().mockReturnValue({ send: mockSend }),
  };

  return { PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand, DynamoDBDocumentClient, __mockSend: mockSend };
})

// Also mock the DynamoDB base client used by the utility module.
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

// Mock uuid so that productId values are deterministic in tests.
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'test-uuid-1234'),
}));

// ---------------------------------------------------------------------------
// Now require the modules – mocks are already in place.
// ---------------------------------------------------------------------------
const { __mockSend: mockSend } = require('@aws-sdk/lib-dynamodb');
const { createProduct, getProductById, getProductBySlug, listProducts, updateProduct } = require('../productRepository');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const VALID_PRODUCT_DATA = {
  name: 'Business Cards',
  description: 'Premium matte business cards',
  basePrice: 1999, // $19.99 in cents
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('productRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // createProduct
  // =========================================================================
  describe('createProduct', () => {
    it('should create a product and return the full item including generated fields', async () => {
      mockSend.mockResolvedValueOnce({}); // PutCommand succeeds (no return payload)

      const result = await createProduct(VALID_PRODUCT_DATA);

      expect(result).toMatchObject({
        productId: 'test-uuid-1234',
        name: 'Business Cards',
        description: 'Premium matte business cards',
        basePrice: 1999,
      });

      // Timestamps must be ISO 8601 strings
      expect(result.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(result.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

      // createdAt and updatedAt should be equal on creation
      expect(result.createdAt).toBe(result.updatedAt);
    });

    it('should call docClient.send with PutCommand containing the correct TableName', async () => {
      mockSend.mockResolvedValueOnce({});

      await createProduct(VALID_PRODUCT_DATA);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const [calledCommand] = mockSend.mock.calls[0];
      expect(calledCommand.input.TableName).toBe('divine-printing-products');
    });

    it('should include ConditionExpression to prevent overwriting an existing product', async () => {
      mockSend.mockResolvedValueOnce({});

      await createProduct(VALID_PRODUCT_DATA);

      const [calledCommand] = mockSend.mock.calls[0];
      expect(calledCommand.input.ConditionExpression).toBe(
        'attribute_not_exists(productId)'
      );
    });

    it('should store basePrice as an integer (cents)', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await createProduct({ ...VALID_PRODUCT_DATA, basePrice: 500 });

      expect(result.basePrice).toBe(500);
      expect(Number.isInteger(result.basePrice)).toBe(true);
    });

    it('should propagate a ConditionalCheckFailedException when the item already exists', async () => {
      const conditionalError = new Error('ConditionalCheckFailedException');
      conditionalError.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(conditionalError);

      await expect(createProduct(VALID_PRODUCT_DATA)).rejects.toThrow(
        'ConditionalCheckFailedException'
      );
    });

    it('should throw a validation error when basePrice is not an integer', async () => {
      await expect(
        createProduct({ ...VALID_PRODUCT_DATA, basePrice: 19.99 })
      ).rejects.toThrow(
        'basePrice must be a non-negative integer representing cents'
      );

      // docClient.send must NOT have been called
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw a validation error when basePrice is negative', async () => {
      await expect(
        createProduct({ ...VALID_PRODUCT_DATA, basePrice: -100 })
      ).rejects.toThrow(
        'basePrice must be a non-negative integer representing cents'
      );

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw a validation error when basePrice is missing', async () => {
      const { basePrice: _unused, ...dataWithoutPrice } = VALID_PRODUCT_DATA;

      await expect(createProduct(dataWithoutPrice)).rejects.toThrow(
        'basePrice must be a non-negative integer representing cents'
      );

      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should allow basePrice of 0 (free product)', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await createProduct({ ...VALID_PRODUCT_DATA, basePrice: 0 });

      expect(result.basePrice).toBe(0);
    });

    it('should forward DynamoDB errors to the caller', async () => {
      const dbError = new Error('InternalServerError');
      mockSend.mockRejectedValueOnce(dbError);

      await expect(createProduct(VALID_PRODUCT_DATA)).rejects.toThrow(
        'InternalServerError'
      );
    });
  });

  // =========================================================================
  // getProductBySlug
  // =========================================================================
  describe('getProductBySlug', () => {
    const EXISTING_ITEM = {
      productId: 'some-product-uuid',
      name: 'Vinyl Banner',
      slug: 'vinyl-banner',
      basePrice: 4999,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('should return the product item when found by slug', async () => {
      mockSend.mockResolvedValueOnce({ Items: [EXISTING_ITEM] });

      const result = await getProductBySlug('vinyl-banner');

      expect(result).toEqual(EXISTING_ITEM);
    });

    it('should query the slug-index GSI with correct parameters', async () => {
      mockSend.mockResolvedValueOnce({ Items: [EXISTING_ITEM] });

      await getProductBySlug('vinyl-banner');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const [calledCommand] = mockSend.mock.calls[0];
      expect(calledCommand.input.TableName).toBe('divine-printing-products');
      expect(calledCommand.input.IndexName).toBe('slug-index');
      expect(calledCommand.input.KeyConditionExpression).toBe('slug = :slug');
      expect(calledCommand.input.ExpressionAttributeValues).toEqual({ ':slug': 'vinyl-banner' });
      expect(calledCommand.input.Limit).toBe(1);
    });

    it('should return null when no product matches the slug', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      const result = await getProductBySlug('non-existent-slug');

      expect(result).toBeNull();
    });

    it('should return null when Items is undefined in the response', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await getProductBySlug('non-existent-slug');

      expect(result).toBeNull();
    });

    it('should throw when slug is an empty string', async () => {
      await expect(getProductBySlug('')).rejects.toThrow(
        'slug must be a non-empty string.'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw when slug is whitespace-only', async () => {
      await expect(getProductBySlug('   ')).rejects.toThrow(
        'slug must be a non-empty string.'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw when slug is not a string', async () => {
      await expect(getProductBySlug(42)).rejects.toThrow(
        'slug must be a non-empty string.'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw when slug is null', async () => {
      await expect(getProductBySlug(null)).rejects.toThrow(
        'slug must be a non-empty string.'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should trim whitespace from the slug before querying', async () => {
      mockSend.mockResolvedValueOnce({ Items: [EXISTING_ITEM] });

      await getProductBySlug('  vinyl-banner  ');

      const [calledCommand] = mockSend.mock.calls[0];
      expect(calledCommand.input.ExpressionAttributeValues[':slug']).toBe('vinyl-banner');
    });

    it('should forward DynamoDB errors to the caller', async () => {
      const dbError = new Error('ResourceNotFoundException');
      mockSend.mockRejectedValueOnce(dbError);

      await expect(getProductBySlug('vinyl-banner')).rejects.toThrow(
        'ResourceNotFoundException'
      );
    });
  });

  // =========================================================================
  // listProducts
  // =========================================================================
  describe('listProducts', () => {
    const SAMPLE_ITEMS = [
      { productId: 'p1', name: 'Product 1', slug: 'product-1', status: 'active', basePrice: 999 },
      { productId: 'p2', name: 'Product 2', slug: 'product-2', status: 'draft',  basePrice: 1499 },
    ];

    it('should return items and null nextCursor when no LastEvaluatedKey', async () => {
      mockSend.mockResolvedValueOnce({ Items: SAMPLE_ITEMS });

      const result = await listProducts();

      expect(result.items).toEqual(SAMPLE_ITEMS);
      expect(result.nextCursor).toBeNull();
    });

    it('should use default limit of 10 and call ScanCommand', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await listProducts();

      expect(mockSend).toHaveBeenCalledTimes(1);
      const [calledCommand] = mockSend.mock.calls[0];
      expect(calledCommand.input.TableName).toBe('divine-printing-products');
      expect(calledCommand.input.Limit).toBe(10);
      expect(calledCommand.input.FilterExpression).toBeUndefined();
    });

    it('should apply a status filter expression when status is provided', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await listProducts({ status: 'active' });

      const [calledCommand] = mockSend.mock.calls[0];
      expect(calledCommand.input.FilterExpression).toBe('#status = :status');
      expect(calledCommand.input.ExpressionAttributeNames).toEqual({ '#status': 'status' });
      expect(calledCommand.input.ExpressionAttributeValues).toEqual({ ':status': 'active' });
    });

    it('should respect a custom limit', async () => {
      mockSend.mockResolvedValueOnce({ Items: [] });

      await listProducts({ limit: 5 });

      const [calledCommand] = mockSend.mock.calls[0];
      expect(calledCommand.input.Limit).toBe(5);
    });

    it('should encode LastEvaluatedKey into a base64 nextCursor', async () => {
      const lastKey = { productId: 'last-item-id' };
      mockSend.mockResolvedValueOnce({ Items: SAMPLE_ITEMS, LastEvaluatedKey: lastKey });

      const result = await listProducts({ limit: 2 });

      expect(result.nextCursor).not.toBeNull();
      const decoded = JSON.parse(Buffer.from(result.nextCursor, 'base64').toString('utf8'));
      expect(decoded).toEqual(lastKey);
    });

    it('should decode a cursor and set ExclusiveStartKey on the scan', async () => {
      const startKey = { productId: 'start-item-id' };
      const cursor = Buffer.from(JSON.stringify(startKey)).toString('base64');
      mockSend.mockResolvedValueOnce({ Items: [] });

      await listProducts({ cursor });

      const [calledCommand] = mockSend.mock.calls[0];
      expect(calledCommand.input.ExclusiveStartKey).toEqual(startKey);
    });

    it('should return empty items array when DynamoDB returns no Items', async () => {
      mockSend.mockResolvedValueOnce({});

      const result = await listProducts();

      expect(result.items).toEqual([]);
      expect(result.nextCursor).toBeNull();
    });

    it('should throw when limit is not a positive integer', async () => {
      await expect(listProducts({ limit: 0 })).rejects.toThrow(
        'limit must be a positive integer.'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw when limit is a float', async () => {
      await expect(listProducts({ limit: 2.5 })).rejects.toThrow(
        'limit must be a positive integer.'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw when limit is negative', async () => {
      await expect(listProducts({ limit: -1 })).rejects.toThrow(
        'limit must be a positive integer.'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw when status is an invalid value', async () => {
      await expect(listProducts({ status: 'unknown' })).rejects.toThrow(
        'status must be one of: active, draft, archived.'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should accept all valid status values without error', async () => {
      for (const s of ['active', 'draft', 'archived']) {
        mockSend.mockResolvedValueOnce({ Items: [] });
        await expect(listProducts({ status: s })).resolves.toBeDefined();
      }
    });

    it('should throw when cursor is an empty string', async () => {
      await expect(listProducts({ cursor: '' })).rejects.toThrow(
        'cursor must be a non-empty string.'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw when cursor is not valid base64 JSON', async () => {
      await expect(listProducts({ cursor: 'not-valid-base64-json!!!' })).rejects.toThrow(
        'cursor is not a valid pagination token.'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should forward DynamoDB errors to the caller', async () => {
      const dbError = new Error('InternalServerError');
      mockSend.mockRejectedValueOnce(dbError);

      await expect(listProducts()).rejects.toThrow('InternalServerError');
    });
  });

  // =========================================================================
  // getProductById
  // =========================================================================
  describe('getProductById', () => {
    const EXISTING_ITEM = {
      productId: 'some-product-uuid',
      name: 'Flyers',
      basePrice: 799,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    it('should return the product item when it exists', async () => {
      mockSend.mockResolvedValueOnce({ Item: EXISTING_ITEM });

      const result = await getProductById('some-product-uuid');

      expect(result).toEqual(EXISTING_ITEM);
    });

    it('should call docClient.send with GetCommand containing the correct TableName and Key', async () => {
      mockSend.mockResolvedValueOnce({ Item: EXISTING_ITEM });

      await getProductById('some-product-uuid');

      expect(mockSend).toHaveBeenCalledTimes(1);
      const [calledCommand] = mockSend.mock.calls[0];
      expect(calledCommand.input.TableName).toBe('divine-printing-products');
      expect(calledCommand.input.Key).toEqual({ productId: 'some-product-uuid' });
    });

    it('should return null when the product does not exist', async () => {
      // DynamoDB GetCommand returns an empty object (no Item key) when not found
      mockSend.mockResolvedValueOnce({});

      const result = await getProductById('non-existent-uuid');

      expect(result).toBeNull();
    });

    it('should return null when Item is explicitly undefined', async () => {
      mockSend.mockResolvedValueOnce({ Item: undefined });

      const result = await getProductById('non-existent-uuid');

      expect(result).toBeNull();
    });

    it('should forward DynamoDB errors to the caller', async () => {
      const dbError = new Error('ResourceNotFoundException');
      mockSend.mockRejectedValueOnce(dbError);

      await expect(getProductById('any-uuid')).rejects.toThrow(
        'ResourceNotFoundException'
      );
    });
  });

  // =========================================================================
  // updateProduct
  // =========================================================================
  describe('updateProduct', () => {
    const UPDATED_ATTRIBUTES = {
      productId: 'some-product-uuid',
      name: 'New Name',
      basePrice: 9999,
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-06-01T00:00:00.000Z',
    };

    it('should return the updated attributes on success', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: UPDATED_ATTRIBUTES });

      const result = await updateProduct('some-product-uuid', { name: 'New Name' });

      expect(result).toEqual(UPDATED_ATTRIBUTES);
    });

    it('should call UpdateCommand with the correct TableName and Key', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: UPDATED_ATTRIBUTES });

      await updateProduct('some-product-uuid', { name: 'New Name' });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const [calledCommand] = mockSend.mock.calls[0];
      expect(calledCommand.input.TableName).toBe('divine-printing-products');
      expect(calledCommand.input.Key).toEqual({ productId: 'some-product-uuid' });
    });

    it('should include ConditionExpression to ensure item exists', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: UPDATED_ATTRIBUTES });

      await updateProduct('some-product-uuid', { name: 'New Name' });

      const [calledCommand] = mockSend.mock.calls[0];
      expect(calledCommand.input.ConditionExpression).toBe('attribute_exists(productId)');
    });

    it('should use ReturnValues ALL_NEW', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: UPDATED_ATTRIBUTES });

      await updateProduct('some-product-uuid', { name: 'New Name' });

      const [calledCommand] = mockSend.mock.calls[0];
      expect(calledCommand.input.ReturnValues).toBe('ALL_NEW');
    });

    it('should always include updatedAt in the UpdateExpression', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: UPDATED_ATTRIBUTES });

      await updateProduct('some-product-uuid', { status: 'active' });

      const [calledCommand] = mockSend.mock.calls[0];
      // The UpdateExpression must reference updatedAt
      expect(calledCommand.input.UpdateExpression).toContain('updatedAt');
      // And the value alias should be an ISO string
      const vals = calledCommand.input.ExpressionAttributeValues;
      const updatedAtValue = Object.values(vals).find(
        (v) => typeof v === 'string' && v.match(/^\d{4}-\d{2}-\d{2}T/)
      );
      expect(updatedAtValue).toBeDefined();
    });

    it('should include provided fields in UpdateExpression (name)', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: UPDATED_ATTRIBUTES });

      await updateProduct('some-product-uuid', { name: 'Updated' });

      const [calledCommand] = mockSend.mock.calls[0];
      expect(calledCommand.input.UpdateExpression).toContain('name');
    });

    it('should include provided fields in UpdateExpression (basePrice)', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: UPDATED_ATTRIBUTES });

      await updateProduct('some-product-uuid', { basePrice: 5000 });

      const [calledCommand] = mockSend.mock.calls[0];
      expect(calledCommand.input.UpdateExpression).toContain('basePrice');
    });

    it('should silently omit productId from the UpdateExpression', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: UPDATED_ATTRIBUTES });

      await updateProduct('some-product-uuid', { productId: 'hacked', name: 'Safe Name' });

      const [calledCommand] = mockSend.mock.calls[0];
      // None of the expression attribute names should map to 'productId'
      const attrNames = Object.values(calledCommand.input.ExpressionAttributeNames || {});
      expect(attrNames).not.toContain('productId');
    });

    it('should silently omit createdAt from the UpdateExpression', async () => {
      mockSend.mockResolvedValueOnce({ Attributes: UPDATED_ATTRIBUTES });

      await updateProduct('some-product-uuid', { createdAt: 'tampered', name: 'Safe' });

      const [calledCommand] = mockSend.mock.calls[0];
      const attrNames = Object.values(calledCommand.input.ExpressionAttributeNames || {});
      expect(attrNames).not.toContain('createdAt');
    });

    it('should handle soft-delete fields (status and deletedAt) in updates', async () => {
      const deletedAt = new Date().toISOString();
      mockSend.mockResolvedValueOnce({ Attributes: { ...UPDATED_ATTRIBUTES, status: 'deleted', deletedAt } });

      await updateProduct('some-product-uuid', { status: 'deleted', deletedAt });

      const [calledCommand] = mockSend.mock.calls[0];
      expect(calledCommand.input.UpdateExpression).toContain('status');
      expect(calledCommand.input.UpdateExpression).toContain('deletedAt');
    });

    it('should throw when productId is an empty string', async () => {
      await expect(updateProduct('', { name: 'X' })).rejects.toThrow(
        'productId must be a non-empty string.'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should throw when productId is whitespace-only', async () => {
      await expect(updateProduct('   ', { name: 'X' })).rejects.toThrow(
        'productId must be a non-empty string.'
      );
      expect(mockSend).not.toHaveBeenCalled();
    });

    it('should propagate ConditionalCheckFailedException when item does not exist', async () => {
      const conditionalError = new Error('ConditionalCheckFailedException');
      conditionalError.name = 'ConditionalCheckFailedException';
      mockSend.mockRejectedValueOnce(conditionalError);

      await expect(updateProduct('ghost-uuid', { name: 'X' })).rejects.toThrow(
        'ConditionalCheckFailedException'
      );
    });

    it('should forward DynamoDB errors to the caller', async () => {
      const dbError = new Error('InternalServerError');
      mockSend.mockRejectedValueOnce(dbError);

      await expect(updateProduct('some-product-uuid', { name: 'X' })).rejects.toThrow(
        'InternalServerError'
      );
    });
  });
});
