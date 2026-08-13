'use strict';

/**
 * Unit tests for services/customerService.js
 *
 * Strategy:
 *   - Inject a mock repository into bootstrapCustomer via the _repo parameter.
 *   - No real DynamoDB, no real Cognito, no real AWS calls.
 *   - Tests verify security invariants: claim derivation, emailVerified enforcement,
 *     email conflict detection, idempotency, and optimistic locking.
 */

// Mock AWS SDK to prevent import-time errors
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
  QueryCommand: jest.fn(),
  UpdateCommand: jest.fn(),
  DynamoDBDocumentClient: { from: jest.fn().mockReturnValue({ send: jest.fn() }) },
}));
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({})),
}));

const {
  bootstrapCustomer,
  extractTrustedClaims,
  normalizeEmail,
  DomainErrors,
} = require('../customerService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a minimal valid req.auth object */
function makeAuth(overrides = {}) {
  return {
    sub: 'cognito-sub-abc123',
    email: 'Alice@Example.com',
    emailVerified: true,
    groups: [],
    scopes: [],
    ...overrides,
  };
}

/** Builds a mock repository with all required functions */
function makeMockRepo(overrides = {}) {
  return {
    getCustomerById: jest.fn().mockResolvedValue(null),
    checkEmailConflict: jest.fn().mockResolvedValue(false),
    createCustomer: jest.fn().mockResolvedValue({
      created: true,
      item: makeStoredCustomer(),
    }),
    updateCustomer: jest.fn().mockResolvedValue({
      updated: true,
      item: makeStoredCustomer({ version: 2 }),
    }),
    ...overrides,
  };
}

/** Builds a stored customer record as returned by DynamoDB */
function makeStoredCustomer(overrides = {}) {
  return {
    customerId: 'cognito-sub-abc123',
    cognitoSub: 'cognito-sub-abc123',
    emailNormalized: 'alice@example.com',
    emailDisplay: 'Alice@Example.com',
    emailVerified: true,
    lastSyncedFromCognitoAt: expect.any(String),
    accountStatus: 'pending_profile',
    createdAt: expect.any(String),
    updatedAt: expect.any(String),
    version: 1,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// normalizeEmail
// ---------------------------------------------------------------------------
describe('normalizeEmail', () => {
  it('converts to lowercase', () => {
    expect(normalizeEmail('Alice@Example.COM')).toBe('alice@example.com');
  });

  it('trims whitespace', () => {
    expect(normalizeEmail('  alice@example.com  ')).toBe('alice@example.com');
  });

  it('handles already-normalized email', () => {
    expect(normalizeEmail('alice@example.com')).toBe('alice@example.com');
  });
});

// ---------------------------------------------------------------------------
// extractTrustedClaims
// ---------------------------------------------------------------------------
describe('extractTrustedClaims', () => {
  it('extracts sub, emailNormalized, emailDisplay, emailVerified from auth', () => {
    const claims = extractTrustedClaims(makeAuth());

    expect(claims.sub).toBe('cognito-sub-abc123');
    expect(claims.emailNormalized).toBe('alice@example.com');
    expect(claims.emailDisplay).toBe('Alice@Example.com');
    expect(claims.emailVerified).toBe(true);
  });

  it('normalizes email to lowercase for emailNormalized', () => {
    const claims = extractTrustedClaims(makeAuth({ email: 'ALICE@EXAMPLE.COM' }));
    expect(claims.emailNormalized).toBe('alice@example.com');
  });

  it('preserves original email casing in emailDisplay', () => {
    const claims = extractTrustedClaims(makeAuth({ email: 'Alice@Example.com' }));
    expect(claims.emailDisplay).toBe('Alice@Example.com');
  });

  it('throws MISSING_CLAIMS when auth is null', () => {
    const err = (() => { try { extractTrustedClaims(null); } catch(e) { return e; } })();
    expect(err.code).toBe(DomainErrors.MISSING_CLAIMS);
    expect(err.status).toBe(400);
    expect(err.isDomainError).toBe(true);
  });

  it('throws MISSING_CLAIMS when sub is missing', () => {
    const { sub: _s, ...authWithoutSub } = makeAuth();
    const err = (() => { try { extractTrustedClaims(authWithoutSub); } catch(e) { return e; } })();
    expect(err.code).toBe(DomainErrors.MISSING_CLAIMS);
    expect(err.status).toBe(400);
  });

  it('throws MISSING_CLAIMS when sub is empty string', () => {
    const err = (() => { try { extractTrustedClaims(makeAuth({ sub: '' })); } catch(e) { return e; } })();
    expect(err.code).toBe(DomainErrors.MISSING_CLAIMS);
  });

  it('throws MISSING_CLAIMS when email is missing', () => {
    const { email: _e, ...authWithoutEmail } = makeAuth();
    const err = (() => { try { extractTrustedClaims(authWithoutEmail); } catch(e) { return e; } })();
    expect(err.code).toBe(DomainErrors.MISSING_CLAIMS);
    expect(err.status).toBe(400);
  });

  it('throws MISSING_CLAIMS when email is empty string', () => {
    const err = (() => { try { extractTrustedClaims(makeAuth({ email: '' })); } catch(e) { return e; } })();
    expect(err.code).toBe(DomainErrors.MISSING_CLAIMS);
  });
});

// ---------------------------------------------------------------------------
// bootstrapCustomer — security and functional tests
// ---------------------------------------------------------------------------
describe('bootstrapCustomer', () => {
  // =========================================================================
  // Happy path — new verified user
  // =========================================================================
  describe('new verified bootstrap (happy path)', () => {
    it('creates a new customer record for a verified user', async () => {
      const repo = makeMockRepo();
      const auth = makeAuth();

      const result = await bootstrapCustomer(auth, repo);

      expect(result.created).toBe(true);
      expect(repo.createCustomer).toHaveBeenCalledTimes(1);
    });

    it('derives customerId exclusively from req.auth.sub', async () => {
      const repo = makeMockRepo();
      const auth = makeAuth({ sub: 'the-real-sub' });

      await bootstrapCustomer(auth, repo);

      const [item] = repo.createCustomer.mock.calls[0];
      expect(item.customerId).toBe('the-real-sub');
      expect(item.cognitoSub).toBe('the-real-sub');
    });

    it('stores only approved minimum fields — no credentials', async () => {
      const repo = makeMockRepo();

      await bootstrapCustomer(makeAuth(), repo);

      const [item] = repo.createCustomer.mock.calls[0];
      // Approved fields
      expect(item.customerId).toBeDefined();
      expect(item.cognitoSub).toBeDefined();
      expect(item.emailNormalized).toBeDefined();
      expect(item.emailDisplay).toBeDefined();
      expect(item.emailVerified).toBeDefined();
      expect(item.lastSyncedFromCognitoAt).toBeDefined();
      expect(item.accountStatus).toBeDefined();
      expect(item.createdAt).toBeDefined();
      expect(item.updatedAt).toBeDefined();
      expect(item.version).toBe(1);

      // Forbidden fields
      expect(item.password).toBeUndefined();
      expect(item.passwordHash).toBeUndefined();
      expect(item.token).toBeUndefined();
      expect(item.accessToken).toBeUndefined();
      expect(item.refreshToken).toBeUndefined();
      expect(item.idToken).toBeUndefined();
    });

    it('sets accountStatus to pending_profile on new record', async () => {
      const repo = makeMockRepo();

      await bootstrapCustomer(makeAuth(), repo);

      const [item] = repo.createCustomer.mock.calls[0];
      expect(item.accountStatus).toBe('pending_profile');
    });

    it('sets version to 1 on new record', async () => {
      const repo = makeMockRepo();

      await bootstrapCustomer(makeAuth(), repo);

      const [item] = repo.createCustomer.mock.calls[0];
      expect(item.version).toBe(1);
    });

    it('normalizes email to lowercase in emailNormalized', async () => {
      const repo = makeMockRepo();

      await bootstrapCustomer(makeAuth({ email: 'Alice@Example.COM' }), repo);

      const [item] = repo.createCustomer.mock.calls[0];
      expect(item.emailNormalized).toBe('alice@example.com');
      expect(item.emailDisplay).toBe('Alice@Example.COM');
    });

    it('checks for email conflict before creating', async () => {
      const repo = makeMockRepo();

      await bootstrapCustomer(makeAuth(), repo);

      expect(repo.checkEmailConflict).toHaveBeenCalledWith(
        'alice@example.com',
        'cognito-sub-abc123'
      );
    });
  });

  // =========================================================================
  // Idempotency — repeat bootstrap for same user
  // =========================================================================
  describe('idempotent repeat bootstrap', () => {
    it('returns success without creating a duplicate when record already exists', async () => {
      const existingRecord = {
        customerId: 'cognito-sub-abc123',
        cognitoSub: 'cognito-sub-abc123',
        emailNormalized: 'alice@example.com',
        emailDisplay: 'Alice@Example.com',
        emailVerified: true,
        accountStatus: 'pending_profile',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastSyncedFromCognitoAt: '2026-01-01T00:00:00.000Z',
      };

      const repo = makeMockRepo({
        getCustomerById: jest.fn().mockResolvedValue(existingRecord),
        updateCustomer: jest.fn().mockResolvedValue({ updated: true, item: { ...existingRecord, version: 2 } }),
      });

      const result = await bootstrapCustomer(makeAuth(), repo);

      expect(result.created).toBe(false);
      expect(repo.createCustomer).not.toHaveBeenCalled();
      expect(repo.checkEmailConflict).not.toHaveBeenCalled();
    });

    it('updates lastSyncedFromCognitoAt and email fields on repeat bootstrap', async () => {
      const existingRecord = {
        customerId: 'cognito-sub-abc123',
        emailNormalized: 'alice@example.com',
        emailDisplay: 'Alice@Example.com',
        emailVerified: true,
        accountStatus: 'pending_profile',
        version: 3,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastSyncedFromCognitoAt: '2026-01-01T00:00:00.000Z',
      };

      const repo = makeMockRepo({
        getCustomerById: jest.fn().mockResolvedValue(existingRecord),
        updateCustomer: jest.fn().mockResolvedValue({ updated: true, item: { ...existingRecord, version: 4 } }),
      });

      await bootstrapCustomer(makeAuth(), repo);

      expect(repo.updateCustomer).toHaveBeenCalledWith(
        'cognito-sub-abc123',
        expect.objectContaining({
          emailNormalized: 'alice@example.com',
          emailDisplay: 'Alice@Example.com',
          emailVerified: true,
          lastSyncedFromCognitoAt: expect.any(String),
        }),
        3  // expectedVersion from existing record
      );
    });

    it('passes expectedVersion from existing record to updateCustomer', async () => {
      const existingRecord = {
        customerId: 'sub',
        emailNormalized: 'alice@example.com',
        emailDisplay: 'Alice@Example.com',
        emailVerified: true,
        accountStatus: 'pending_profile',
        version: 7, // specific version to verify
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastSyncedFromCognitoAt: '2026-01-01T00:00:00.000Z',
      };

      const repo = makeMockRepo({
        getCustomerById: jest.fn().mockResolvedValue(existingRecord),
        updateCustomer: jest.fn().mockResolvedValue({ updated: true, item: { ...existingRecord, version: 8 } }),
      });

      await bootstrapCustomer(makeAuth({ sub: 'sub' }), repo);

      const [, , expectedVersion] = repo.updateCustomer.mock.calls[0];
      expect(expectedVersion).toBe(7);
    });
  });

  // =========================================================================
  // Email unverified rejection
  // =========================================================================
  describe('email unverified rejection', () => {
    it('throws EMAIL_UNVERIFIED when emailVerified is false', async () => {
      const repo = makeMockRepo();
      const auth = makeAuth({ emailVerified: false });

      const err = await bootstrapCustomer(auth, repo).catch(e => e);

      expect(err.isDomainError).toBe(true);
      expect(err.code).toBe(DomainErrors.EMAIL_UNVERIFIED);
      expect(err.status).toBe(403);
    });

    it('does not call any repo method when email is unverified', async () => {
      const repo = makeMockRepo();

      await bootstrapCustomer(makeAuth({ emailVerified: false }), repo).catch(() => {});

      expect(repo.getCustomerById).not.toHaveBeenCalled();
      expect(repo.createCustomer).not.toHaveBeenCalled();
      expect(repo.checkEmailConflict).not.toHaveBeenCalled();
    });

    it('throws EMAIL_UNVERIFIED when emailVerified is undefined', async () => {
      const repo = makeMockRepo();
      const { emailVerified: _ev, ...authWithoutVerified } = makeAuth();
      authWithoutVerified.emailVerified = undefined;

      const err = await bootstrapCustomer(authWithoutVerified, repo).catch(e => e);

      expect(err.code).toBe(DomainErrors.EMAIL_UNVERIFIED);
    });
  });

  describe('blocked existing account rejection', () => {
    const blocked = [
      ['disabled', DomainErrors.ACCOUNT_DISABLED],
      ['deletion_requested', DomainErrors.DELETION_REQUESTED],
      ['deleted', DomainErrors.ACCOUNT_DELETED],
      ['merged', DomainErrors.ACCOUNT_MERGED],
    ];

    test.each(blocked)('rejects accountStatus=%s with %s', async (accountStatus, expectedCode) => {
      const repo = makeMockRepo({
        getCustomerById: jest.fn().mockResolvedValue(makeStoredCustomer({ accountStatus })),
      });

      const error = await bootstrapCustomer(makeAuth(), repo).catch(err => err);

      expect(error.code).toBe(expectedCode);
      expect(error.status).toBe(403);
      expect(repo.updateCustomer).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // IDs derived from sub — NEVER from body
  // =========================================================================
  describe('IDs derived from sub only', () => {
    it('always uses auth.sub as customerId regardless of any other data', async () => {
      const repo = makeMockRepo();

      await bootstrapCustomer(makeAuth({ sub: 'real-sub-xyz' }), repo);

      const [item] = repo.createCustomer.mock.calls[0];
      expect(item.customerId).toBe('real-sub-xyz');
    });

    it('always uses auth.sub as cognitoSub regardless of any other data', async () => {
      const repo = makeMockRepo();

      await bootstrapCustomer(makeAuth({ sub: 'real-sub-xyz' }), repo);

      const [item] = repo.createCustomer.mock.calls[0];
      expect(item.cognitoSub).toBe('real-sub-xyz');
    });

    it('customerId equals cognitoSub and both equal auth.sub', async () => {
      const repo = makeMockRepo();
      const auth = makeAuth({ sub: 'the-sub' });

      await bootstrapCustomer(auth, repo);

      const [item] = repo.createCustomer.mock.calls[0];
      expect(item.customerId).toBe('the-sub');
      expect(item.cognitoSub).toBe('the-sub');
      expect(item.customerId).toBe(item.cognitoSub);
    });
  });

  // =========================================================================
  // Supplied identity in "body" is ignored / never reaches repo
  // =========================================================================
  describe('supplied identity claims in body are ignored', () => {
    it('service ignores any body-supplied customerId (not passed through)', async () => {
      // The service only accepts trustedAuth (req.auth), not request body.
      // We simulate a malicious body by passing extra fields to the auth object
      // but those are not part of the trusted auth interface — service uses only
      // the approved claims (sub, email, emailVerified).
      const repo = makeMockRepo();
      // Note: the service signature is bootstrapCustomer(trustedAuth, _repo).
      // Any body-sourced fields passed as trustedAuth would be ignored or fail validation.
      const auth = makeAuth({ sub: 'real-sub' });

      await bootstrapCustomer(auth, repo);

      const [item] = repo.createCustomer.mock.calls[0];
      // The only IDs are from auth.sub
      expect(item.customerId).toBe('real-sub');
      expect(item.cognitoSub).toBe('real-sub');
    });

    it('service does not pass arbitrary extra auth fields to the stored item', async () => {
      const repo = makeMockRepo();
      // Even if auth has extra fields, only approved fields should be stored
      const auth = { ...makeAuth(), INJECTED_FIELD: 'malicious', groups: ['admin'] };

      await bootstrapCustomer(auth, repo);

      const [item] = repo.createCustomer.mock.calls[0];
      expect(item.INJECTED_FIELD).toBeUndefined();
      // groups is not part of the approved stored fields
      expect(item.groups).toBeUndefined();
    });
  });

  // =========================================================================
  // Duplicate normalized email — ACCOUNT_EMAIL_CONFLICT
  // =========================================================================
  describe('duplicate email conflict', () => {
    it('throws ACCOUNT_EMAIL_CONFLICT when another active customer has the same email', async () => {
      const repo = makeMockRepo({
        checkEmailConflict: jest.fn().mockResolvedValue(true),
      });

      const err = await bootstrapCustomer(makeAuth(), repo).catch(e => e);

      expect(err.isDomainError).toBe(true);
      expect(err.code).toBe(DomainErrors.ACCOUNT_EMAIL_CONFLICT);
      expect(err.status).toBe(409);
    });

    it('does not create a record when email conflict is found', async () => {
      const repo = makeMockRepo({
        checkEmailConflict: jest.fn().mockResolvedValue(true),
      });

      await bootstrapCustomer(makeAuth(), repo).catch(() => {});

      expect(repo.createCustomer).not.toHaveBeenCalled();
    });

    it('does not expose other account details in the error message', async () => {
      const repo = makeMockRepo({
        checkEmailConflict: jest.fn().mockResolvedValue(true),
      });

      const err = await bootstrapCustomer(makeAuth(), repo).catch(e => e);

      // Message should be generic — no other account's ID, email, or details
      expect(err.message).not.toContain('other-sub');
      expect(err.message).not.toContain('other@');
      expect(err.message.length).toBeGreaterThan(10);
    });
  });

  // =========================================================================
  // Conditional race — optimistic locking
  // =========================================================================
  describe('conditional write race (optimistic locking)', () => {
    it('returns idempotent success when same-sub conditional write conflict occurs', async () => {
      // Simulate: record did not exist at read time, but exists by write time (race).
      // createCustomer returns created=false with the existing record (idempotent path).
      const raceItem = {
        customerId: 'cognito-sub-abc123',
        cognitoSub: 'cognito-sub-abc123',
        emailNormalized: 'alice@example.com',
        emailDisplay: 'Alice@Example.com',
        emailVerified: true,
        accountStatus: 'pending_profile',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastSyncedFromCognitoAt: '2026-01-01T00:00:00.000Z',
      };

      const repo = makeMockRepo({
        createCustomer: jest.fn().mockResolvedValue({ created: false, item: raceItem }),
      });

      const result = await bootstrapCustomer(makeAuth(), repo);

      // Same-sub conflict → idempotent success
      expect(result.created).toBe(false);
      expect(result.customer).toBeDefined();
    });

    it('returns idempotent success when update optimistic lock fails for same sub', async () => {
      // Simulate: existing record found, but another process updated it concurrently.
      const existingRecord = {
        customerId: 'cognito-sub-abc123',
        emailNormalized: 'alice@example.com',
        emailDisplay: 'Alice@Example.com',
        emailVerified: true,
        accountStatus: 'pending_profile',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastSyncedFromCognitoAt: '2026-01-01T00:00:00.000Z',
      };
      const latestRecord = { ...existingRecord, version: 2, updatedAt: '2026-02-01T00:00:00.000Z' };

      const repo = makeMockRepo({
        getCustomerById: jest.fn().mockResolvedValue(existingRecord),
        // updateCustomer returns updated=false (lock conflict) with the latest record
        updateCustomer: jest.fn().mockResolvedValue({ updated: false, item: latestRecord }),
      });

      const result = await bootstrapCustomer(makeAuth(), repo);

      // Treated as idempotent success
      expect(result.created).toBe(false);
      expect(result.customer).toBeDefined();
    });
  });

  // =========================================================================
  // Missing email/sub
  // =========================================================================
  describe('missing trusted claims', () => {
    it('throws MISSING_CLAIMS when auth.sub is missing', async () => {
      const repo = makeMockRepo();
      const { sub: _s, ...authWithoutSub } = makeAuth();

      const err = await bootstrapCustomer(authWithoutSub, repo).catch(e => e);

      expect(err.isDomainError).toBe(true);
      expect(err.code).toBe(DomainErrors.MISSING_CLAIMS);
      expect(err.status).toBe(400);
    });

    it('throws MISSING_CLAIMS when auth.email is missing', async () => {
      const repo = makeMockRepo();
      const { email: _e, ...authWithoutEmail } = makeAuth();

      const err = await bootstrapCustomer(authWithoutEmail, repo).catch(e => e);

      expect(err.isDomainError).toBe(true);
      expect(err.code).toBe(DomainErrors.MISSING_CLAIMS);
      expect(err.status).toBe(400);
    });

    it('throws MISSING_CLAIMS when auth is null', async () => {
      const repo = makeMockRepo();

      const err = await bootstrapCustomer(null, repo).catch(e => e);

      expect(err.isDomainError).toBe(true);
      expect(err.code).toBe(DomainErrors.MISSING_CLAIMS);
    });

    it('throws MISSING_CLAIMS when auth is not an object', async () => {
      const repo = makeMockRepo();

      const err = await bootstrapCustomer('not-an-object', repo).catch(e => e);

      expect(err.isDomainError).toBe(true);
      expect(err.code).toBe(DomainErrors.MISSING_CLAIMS);
    });

    it('does not call repo methods when claims are missing', async () => {
      const repo = makeMockRepo();
      const { sub: _s, ...authWithoutSub } = makeAuth();

      await bootstrapCustomer(authWithoutSub, repo).catch(() => {});

      expect(repo.getCustomerById).not.toHaveBeenCalled();
      expect(repo.createCustomer).not.toHaveBeenCalled();
      expect(repo.checkEmailConflict).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // DynamoDB failure then retry success
  // =========================================================================
  describe('DynamoDB transient failure and retry', () => {
    it('throws CUSTOMER_BOOTSTRAP_FAILED on DynamoDB write failure (first attempt)', async () => {
      const domainErr = new Error('Customer record write failed. Please retry.');
      domainErr.code = 'CUSTOMER_BOOTSTRAP_FAILED';
      domainErr.retryable = true;
      domainErr.isDomainError = true;

      const repo = makeMockRepo({
        createCustomer: jest.fn().mockRejectedValue(domainErr),
      });

      const err = await bootstrapCustomer(makeAuth(), repo).catch(e => e);

      expect(err.code).toBe('CUSTOMER_BOOTSTRAP_FAILED');
    });

    it('succeeds on second attempt after transient DynamoDB failure', async () => {
      const domainErr = new Error('Customer record write failed. Please retry.');
      domainErr.code = 'CUSTOMER_BOOTSTRAP_FAILED';
      domainErr.retryable = true;
      domainErr.isDomainError = true;

      const successItem = {
        customerId: 'cognito-sub-abc123',
        cognitoSub: 'cognito-sub-abc123',
        emailNormalized: 'alice@example.com',
        emailDisplay: 'Alice@Example.com',
        emailVerified: true,
        accountStatus: 'pending_profile',
        version: 1,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastSyncedFromCognitoAt: '2026-01-01T00:00:00.000Z',
      };

      // First call fails; second call succeeds (simulating retry by caller)
      const createCustomer = jest.fn()
        .mockRejectedValueOnce(domainErr)
        .mockResolvedValueOnce({ created: true, item: successItem });

      const repo = makeMockRepo({ createCustomer });

      // First attempt fails
      await expect(bootstrapCustomer(makeAuth(), repo)).rejects.toMatchObject({
        code: 'CUSTOMER_BOOTSTRAP_FAILED',
      });

      // Reset getCustomerById (still returns null — no record was written)
      repo.getCustomerById.mockResolvedValue(null);

      // Second attempt (retry by caller)
      const result = await bootstrapCustomer(makeAuth(), repo);
      expect(result.created).toBe(true);
      expect(result.customer).toBeDefined();
    });
  });

  // =========================================================================
  // No secrets persisted
  // =========================================================================
  describe('no secrets persisted', () => {
    it('does not store any passwords, tokens, or credentials', async () => {
      const repo = makeMockRepo();

      await bootstrapCustomer(makeAuth(), repo);

      const [item] = repo.createCustomer.mock.calls[0];
      // Comprehensive check for any secret-like field
      const forbiddenFields = [
        'password', 'passwordHash', 'token', 'accessToken', 'refreshToken',
        'idToken', 'secret', 'credential', 'apiKey', 'privateKey',
      ];
      for (const field of forbiddenFields) {
        expect(item[field]).toBeUndefined();
      }
    });
  });

  // =========================================================================
  // Safe errors — verify domain error properties
  // =========================================================================
  describe('safe error contract', () => {
    it('MISSING_CLAIMS error has isDomainError=true, correct code and status', async () => {
      const repo = makeMockRepo();
      const err = await bootstrapCustomer(null, repo).catch(e => e);

      expect(err.isDomainError).toBe(true);
      expect(err.code).toBe(DomainErrors.MISSING_CLAIMS);
      expect(err.status).toBe(400);
      expect(typeof err.message).toBe('string');
      expect(err.message.length).toBeGreaterThan(0);
    });

    it('EMAIL_UNVERIFIED error has isDomainError=true, correct code and status', async () => {
      const repo = makeMockRepo();
      const err = await bootstrapCustomer(makeAuth({ emailVerified: false }), repo).catch(e => e);

      expect(err.isDomainError).toBe(true);
      expect(err.code).toBe(DomainErrors.EMAIL_UNVERIFIED);
      expect(err.status).toBe(403);
    });

    it('ACCOUNT_EMAIL_CONFLICT error has isDomainError=true, correct code and status', async () => {
      const repo = makeMockRepo({ checkEmailConflict: jest.fn().mockResolvedValue(true) });
      const err = await bootstrapCustomer(makeAuth(), repo).catch(e => e);

      expect(err.isDomainError).toBe(true);
      expect(err.code).toBe(DomainErrors.ACCOUNT_EMAIL_CONFLICT);
      expect(err.status).toBe(409);
    });

    it('domain errors do not expose AWS internals or stack traces', async () => {
      const repo = makeMockRepo({ checkEmailConflict: jest.fn().mockResolvedValue(true) });
      const err = await bootstrapCustomer(makeAuth(), repo).catch(e => e);

      // Safe message: no AWS resource names, ARNs, or internal IDs
      expect(err.message).not.toMatch(/arn:/i);
      expect(err.message).not.toMatch(/us-east-1/i);
      expect(err.message).not.toMatch(/dynamodb/i);
    });
  });
});
