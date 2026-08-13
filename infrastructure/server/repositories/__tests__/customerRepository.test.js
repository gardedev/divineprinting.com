'use strict';

/**
 * Unit tests for repositories/customerRepository.js
 *
 * Strategy:
 *   - Inject a mock DynamoDB DocumentClient directly into each function.
 *   - No real DynamoDB, no real AWS credentials required.
 *   - AWS SDK is NOT mocked at the module level; instead we mock the
 *     lib-dynamodb module to avoid module caching issues with the docClient.
 */

// ---------------------------------------------------------------------------
// Mock AWS SDK before requires
// ---------------------------------------------------------------------------

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const mockSend = jest.fn();

  function GetCommand(input) { this.input = input; }
  function PutCommand(input) { this.input = input; }
  function QueryCommand(input) { this.input = input; }
  function UpdateCommand(input) { this.input = input; }

  const DynamoDBDocumentClient = {
    from: jest.fn().mockReturnValue({ send: mockSend }),
  };

  return { GetCommand, PutCommand, QueryCommand, UpdateCommand, DynamoDBDocumentClient, __mockSend: mockSend };
});

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
const { __mockSend: globalMockSend } = require('@aws-sdk/lib-dynamodb');
const {
  getCustomerById,
  checkEmailConflict,
  createCustomer,
  updateCustomer,
  TABLE_NAME,
  EMAIL_INDEX_NAME,
} = require('../customerRepository');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Creates a minimal valid customer item */
function makeCustomerItem(overrides = {}) {
  return {
    customerId: 'test-sub-123',
    cognitoSub: 'test-sub-123',
    emailNormalized: 'alice@example.com',
    emailDisplay: 'Alice@Example.com',
    emailVerified: true,
    lastSyncedFromCognitoAt: '2026-01-01T00:00:00.000Z',
    accountStatus: 'pending_profile',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  };
}

/** Creates a mock DynamoDB document client */
function makeMockClient() {
  const send = jest.fn();
  return { send };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('customerRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // TABLE_NAME and EMAIL_INDEX_NAME exports
  // =========================================================================
  describe('constants', () => {
    it('TABLE_NAME defaults to divine-printing-customers-v2', () => {
      expect(TABLE_NAME).toBe('divine-printing-customers-v2');
    });

    it('EMAIL_INDEX_NAME is EmailIndex', () => {
      expect(EMAIL_INDEX_NAME).toBe('EmailIndex');
    });
  });

  // =========================================================================
  // getCustomerById
  // =========================================================================
  describe('getCustomerById', () => {
    it('returns the customer item when found', async () => {
      const mockClient = makeMockClient();
      const item = makeCustomerItem();
      mockClient.send.mockResolvedValueOnce({ Item: item });

      const result = await getCustomerById('test-sub-123', mockClient);

      expect(result).toEqual(item);
    });

    it('returns null when customer does not exist', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({});

      const result = await getCustomerById('non-existent-sub', mockClient);

      expect(result).toBeNull();
    });

    it('returns null when Item is explicitly undefined', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({ Item: undefined });

      const result = await getCustomerById('non-existent-sub', mockClient);

      expect(result).toBeNull();
    });

    it('calls GetCommand with the correct TableName and Key', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({ Item: makeCustomerItem() });

      await getCustomerById('test-sub-123', mockClient);

      expect(mockClient.send).toHaveBeenCalledTimes(1);
      const [cmd] = mockClient.send.mock.calls[0];
      expect(cmd.input.TableName).toBe(TABLE_NAME);
      expect(cmd.input.Key).toEqual({ customerId: 'test-sub-123' });
    });

    it('propagates DynamoDB errors to the caller', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockRejectedValueOnce(new Error('DynamoDB unavailable'));

      await expect(getCustomerById('sub', mockClient)).rejects.toThrow('DynamoDB unavailable');
    });
  });

  // =========================================================================
  // checkEmailConflict
  // =========================================================================
  describe('checkEmailConflict', () => {
    it('returns true when another active customer owns the email', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({
        Items: [{ customerId: 'other-sub', accountStatus: 'active' }],
      });

      const result = await checkEmailConflict('alice@example.com', 'my-sub', mockClient);

      expect(result).toBe(true);
    });

    it('returns false when no conflicting record is found', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({ Items: [] });

      const result = await checkEmailConflict('alice@example.com', 'my-sub', mockClient);

      expect(result).toBe(false);
    });

    it('returns false when Items is undefined', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({});

      const result = await checkEmailConflict('alice@example.com', 'my-sub', mockClient);

      expect(result).toBe(false);
    });

    it('queries the EmailIndex GSI with the correct parameters', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({ Items: [] });

      await checkEmailConflict('alice@example.com', 'my-sub', mockClient);

      expect(mockClient.send).toHaveBeenCalledTimes(1);
      const [cmd] = mockClient.send.mock.calls[0];
      expect(cmd.input.TableName).toBe(TABLE_NAME);
      expect(cmd.input.IndexName).toBe(EMAIL_INDEX_NAME);
      expect(cmd.input.KeyConditionExpression).toBe('emailNormalized = :email');
      expect(cmd.input.ExpressionAttributeValues[':email']).toBe('alice@example.com');
      expect(cmd.input.ExpressionAttributeValues[':ownId']).toBe('my-sub');
      // Excludes own ID from conflict check
      expect(cmd.input.FilterExpression).toContain('customerId <> :ownId');
    });

    it('excludes own customerId from conflict detection', async () => {
      const mockClient = makeMockClient();
      // DynamoDB already filters by customerId <> :ownId; return empty to confirm
      mockClient.send.mockResolvedValueOnce({ Items: [] });

      const result = await checkEmailConflict('alice@example.com', 'my-sub', mockClient);

      expect(result).toBe(false);
      const [cmd] = mockClient.send.mock.calls[0];
      expect(cmd.input.FilterExpression).toContain('customerId <> :ownId');
      expect(cmd.input.ExpressionAttributeValues[':ownId']).toBe('my-sub');
    });

    it('propagates DynamoDB errors to the caller', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockRejectedValueOnce(new Error('Service unavailable'));

      await expect(
        checkEmailConflict('alice@example.com', 'my-sub', mockClient)
      ).rejects.toThrow('Service unavailable');
    });

    // -----------------------------------------------------------------------
    // ADR-compliant status checks (Defect 2 fix verification)
    // -----------------------------------------------------------------------

    it('returns true (ACCOUNT_EMAIL_CONFLICT) when a pending_profile record for a different customerId owns the email', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({
        Items: [{ customerId: 'other-sub', accountStatus: 'pending_profile' }],
      });

      const result = await checkEmailConflict('alice@example.com', 'my-sub', mockClient);

      expect(result).toBe(true);
    });

    it('returns true (ACCOUNT_EMAIL_CONFLICT) when a disabled record for a different customerId owns the email', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({
        Items: [{ customerId: 'other-sub', accountStatus: 'disabled' }],
      });

      const result = await checkEmailConflict('alice@example.com', 'my-sub', mockClient);

      expect(result).toBe(true);
    });

    it('returns true (ACCOUNT_EMAIL_CONFLICT) when a deletion_requested record for a different customerId owns the email', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({
        Items: [{ customerId: 'other-sub', accountStatus: 'deletion_requested' }],
      });

      const result = await checkEmailConflict('alice@example.com', 'my-sub', mockClient);

      expect(result).toBe(true);
    });

    it('returns false (no conflict) when a deleted record owns the email — deleted status must not block new registration', async () => {
      // DynamoDB GSI filter excludes deleted records; simulate empty result
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({ Items: [] });

      const result = await checkEmailConflict('alice@example.com', 'my-sub', mockClient);

      expect(result).toBe(false);
    });

    it('returns false (no conflict) when a merged record owns the email — merged status must not block new registration', async () => {
      // DynamoDB GSI filter excludes merged records; simulate empty result
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({ Items: [] });

      const result = await checkEmailConflict('alice@example.com', 'my-sub', mockClient);

      expect(result).toBe(false);
    });

    it('FilterExpression includes all four conflicting ADR statuses (pending_profile, active, disabled, deletion_requested)', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({ Items: [] });

      await checkEmailConflict('alice@example.com', 'my-sub', mockClient);

      const [cmd] = mockClient.send.mock.calls[0];
      const attrVals = cmd.input.ExpressionAttributeValues;

      // All four ADR conflicting statuses must be present in query parameters
      const statusValues = Object.values(attrVals).filter(v => typeof v === 'string' && v !== 'alice@example.com' && v !== 'my-sub');
      expect(statusValues).toContain('pending_profile');
      expect(statusValues).toContain('active');
      expect(statusValues).toContain('disabled');
      expect(statusValues).toContain('deletion_requested');

      // 'deleted' and 'merged' must NOT appear as conflict statuses
      expect(statusValues).not.toContain('deleted');
      expect(statusValues).not.toContain('merged');

      // Deprecated/invented statuses must NOT appear
      expect(statusValues).not.toContain('verified');
      expect(statusValues).not.toContain('suspended');
    });

    it('FilterExpression uses IN clause with four status placeholders', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({ Items: [] });

      await checkEmailConflict('alice@example.com', 'my-sub', mockClient);

      const [cmd] = mockClient.send.mock.calls[0];
      const filter = cmd.input.FilterExpression;

      // Should use IN (:s1, :s2, :s3, :s4) with four status bindings
      expect(filter).toMatch(/accountStatus IN \(:s1, :s2, :s3, :s4\)/);
    });
  });

  // =========================================================================
  // createCustomer
  // =========================================================================
  describe('createCustomer', () => {
    it('creates a new customer and returns { created: true, item }', async () => {
      const mockClient = makeMockClient();
      const item = makeCustomerItem();
      mockClient.send.mockResolvedValueOnce({}); // PutCommand succeeds

      const result = await createCustomer(item, mockClient);

      expect(result.created).toBe(true);
      expect(result.item).toEqual(item);
    });

    it('calls PutCommand with attribute_not_exists(customerId) condition', async () => {
      const mockClient = makeMockClient();
      const item = makeCustomerItem();
      mockClient.send.mockResolvedValueOnce({});

      await createCustomer(item, mockClient);

      expect(mockClient.send).toHaveBeenCalledTimes(1);
      const [cmd] = mockClient.send.mock.calls[0];
      expect(cmd.input.TableName).toBe(TABLE_NAME);
      expect(cmd.input.ConditionExpression).toBe('attribute_not_exists(customerId)');
      expect(cmd.input.Item).toEqual(item);
    });

    it('returns { created: false, item: existing } on ConditionalCheckFailedException', async () => {
      const mockClient = makeMockClient();
      const item = makeCustomerItem();
      const existing = makeCustomerItem({ version: 2, updatedAt: '2026-02-01T00:00:00.000Z' });

      const conditionalErr = new Error('ConditionalCheckFailedException');
      conditionalErr.name = 'ConditionalCheckFailedException';
      mockClient.send
        .mockRejectedValueOnce(conditionalErr)  // PutCommand fails
        .mockResolvedValueOnce({ Item: existing }); // GetCommand reads existing

      const result = await createCustomer(item, mockClient);

      expect(result.created).toBe(false);
      expect(result.item).toEqual(existing);
      // Two calls: PutCommand + GetCommand
      expect(mockClient.send).toHaveBeenCalledTimes(2);
    });

    it('throws a CUSTOMER_BOOTSTRAP_FAILED domain error on unrecoverable DynamoDB failure', async () => {
      const mockClient = makeMockClient();
      const item = makeCustomerItem();
      mockClient.send.mockRejectedValueOnce(new Error('InternalServerError'));

      const err = await createCustomer(item, mockClient).catch(e => e);

      expect(err.code).toBe('CUSTOMER_BOOTSTRAP_FAILED');
      expect(err.retryable).toBe(true);
      // Safe message — no AWS internals
      expect(err.message).not.toContain('InternalServerError');
    });

    it('does not store any tokens, passwords, or credentials', async () => {
      const mockClient = makeMockClient();
      const item = makeCustomerItem();
      mockClient.send.mockResolvedValueOnce({});

      await createCustomer(item, mockClient);

      const [cmd] = mockClient.send.mock.calls[0];
      const stored = cmd.input.Item;
      expect(stored.password).toBeUndefined();
      expect(stored.passwordHash).toBeUndefined();
      expect(stored.token).toBeUndefined();
      expect(stored.accessToken).toBeUndefined();
      expect(stored.refreshToken).toBeUndefined();
    });
  });

  // =========================================================================
  // updateCustomer
  // =========================================================================
  describe('updateCustomer', () => {
    it('updates the customer and returns { updated: true, item }', async () => {
      const mockClient = makeMockClient();
      const updatedItem = makeCustomerItem({ version: 2, updatedAt: '2026-02-01T00:00:00.000Z' });
      mockClient.send.mockResolvedValueOnce({ Attributes: updatedItem });

      const result = await updateCustomer(
        'test-sub-123',
        { emailNormalized: 'alice@example.com', lastSyncedFromCognitoAt: '2026-02-01T00:00:00.000Z' },
        1,
        mockClient
      );

      expect(result.updated).toBe(true);
      expect(result.item).toEqual(updatedItem);
    });

    it('uses optimistic locking via version condition', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({ Attributes: makeCustomerItem({ version: 2 }) });

      await updateCustomer(
        'test-sub-123',
        { emailNormalized: 'alice@example.com' },
        1,
        mockClient
      );

      const [cmd] = mockClient.send.mock.calls[0];
      expect(cmd.input.ConditionExpression).toBe('#version = :expectedVersion');
      expect(cmd.input.ExpressionAttributeValues[':expectedVersion']).toBe(1);
      expect(cmd.input.ExpressionAttributeValues[':newVersion']).toBe(2);
    });

    it('always increments version in UpdateExpression', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({ Attributes: makeCustomerItem({ version: 3 }) });

      await updateCustomer('sub', {}, 2, mockClient);

      const [cmd] = mockClient.send.mock.calls[0];
      expect(cmd.input.UpdateExpression).toContain('#version');
      expect(cmd.input.ExpressionAttributeValues[':newVersion']).toBe(3);
    });

    it('always updates updatedAt in UpdateExpression', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({ Attributes: makeCustomerItem() });

      await updateCustomer('sub', {}, 1, mockClient);

      const [cmd] = mockClient.send.mock.calls[0];
      expect(cmd.input.UpdateExpression).toContain('#updatedAt');
      expect(cmd.input.ExpressionAttributeValues[':updatedAt']).toMatch(/^\d{4}-/);
    });

    it('returns { updated: false, item: latest } on ConditionalCheckFailedException', async () => {
      const mockClient = makeMockClient();
      const latestItem = makeCustomerItem({ version: 5 });

      const conditionalErr = new Error('ConditionalCheckFailedException');
      conditionalErr.name = 'ConditionalCheckFailedException';
      mockClient.send
        .mockRejectedValueOnce(conditionalErr)      // UpdateCommand fails
        .mockResolvedValueOnce({ Item: latestItem }); // GetCommand re-reads

      const result = await updateCustomer('test-sub-123', {}, 1, mockClient);

      expect(result.updated).toBe(false);
      expect(result.item).toEqual(latestItem);
    });

    it('throws a CUSTOMER_BOOTSTRAP_FAILED domain error on unrecoverable DynamoDB failure', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockRejectedValueOnce(new Error('ProvisionedThroughputExceededException'));

      const err = await updateCustomer('sub', {}, 1, mockClient).catch(e => e);

      expect(err.code).toBe('CUSTOMER_BOOTSTRAP_FAILED');
      expect(err.retryable).toBe(true);
    });

    it('does not update immutable fields (customerId, cognitoSub, createdAt)', async () => {
      const mockClient = makeMockClient();
      mockClient.send.mockResolvedValueOnce({ Attributes: makeCustomerItem() });

      await updateCustomer(
        'test-sub-123',
        // Passing forbidden fields — should be silently ignored
        { customerId: 'hacked', cognitoSub: 'hacked', createdAt: 'hacked', emailNormalized: 'safe@example.com' },
        1,
        mockClient
      );

      const [cmd] = mockClient.send.mock.calls[0];
      const attrNames = Object.values(cmd.input.ExpressionAttributeNames || {});
      expect(attrNames).not.toContain('customerId');
      expect(attrNames).not.toContain('cognitoSub');
      expect(attrNames).not.toContain('createdAt');
      expect(attrNames).toContain('emailNormalized');
    });
  });
});
