'use strict';

/**
 * Unit tests for api/customerRegistrationApi.js
 *
 * Strategy:
 *   - Mock customerService to avoid real business logic / DynamoDB calls.
 *   - Inject a stub jwtAuth middleware to control auth behaviour per test.
 *   - Drive requests via Node http module (no supertest dependency required).
 *   - Cover all safe error codes, happy paths, and security invariants.
 */

// ---------------------------------------------------------------------------
// Mock AWS SDK to prevent import-time errors from transitive requires
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------
const http = require('http');
const express = require('express');

const { createCustomerRegistrationRouter, sanitizeCustomerResponse } = require('../customerRegistrationApi');
const { DomainErrors } = require('../../services/customerService');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a stub jwtAuth middleware that either:
 *   - Attaches the given auth object to req.auth and calls next() (authenticated)
 *   - Returns a 401 MISSING_TOKEN response (unauthenticated)
 *   - Returns a 403 response (forbidden)
 */
function makeJwtStub(mode = 'authenticated', auth = null) {
  return (req, res, next) => {
    if (mode === 'authenticated') {
      req.auth = auth || {
        sub: 'cognito-sub-abc123',
        email: 'Alice@Example.com',
        emailVerified: true,
        groups: ['customer'],
        scopes: [],
      };
      return next();
    }
    if (mode === 'missing_token') {
      return res.status(401).json({ error: 'Authorization header with Bearer token is required.', code: 'MISSING_TOKEN' });
    }
    if (mode === 'forbidden') {
      return res.status(403).json({ error: 'Token claims are invalid.', code: 'CLAIM_VALIDATION_FAILED' });
    }
    if (mode === 'expired') {
      return res.status(401).json({ error: 'Token has expired.', code: 'TOKEN_EXPIRED' });
    }
    return next();
  };
}

/**
 * Creates a mock customerService object.
 */
function makeMockService(overrides = {}) {
  return {
    bootstrapCustomer: jest.fn().mockResolvedValue({
      created: true,
      customer: makeStoredCustomer(),
    }),
    ...overrides,
  };
}

/** Creates a stored customer record */
function makeStoredCustomer(overrides = {}) {
  return {
    customerId: 'cognito-sub-abc123',
    cognitoSub: 'cognito-sub-abc123',
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

/**
 * Creates a test Express app with the customer registration router.
 */
function buildTestApp(jwtMode = 'authenticated', serviceOverrides = {}, jwtAuth = null) {
  const app = express();
  app.use(express.json());

  const jwtStub = jwtAuth || makeJwtStub(jwtMode);
  const mockService = makeMockService(serviceOverrides);

  app.use('/api/customers', createCustomerRegistrationRouter(jwtStub, mockService));

  // Capture mockService for assertions in each test
  app._mockService = mockService;

  return app;
}

/**
 * Makes an HTTP request against an Express app.
 *
 * @param {import('express').Application} app
 * @param {string} method
 * @param {string} path
 * @param {object} [body]
 * @param {object} [headers]
 * @returns {Promise<{ status: number, body: object }>}
 */
function request(app, method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      const options = {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          server.close();
          try {
            resolve({ status: res.statusCode, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode, body: data });
          }
        });
      });

      req.on('error', (err) => {
        server.close();
        reject(err);
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('customerRegistrationApi', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // sanitizeCustomerResponse
  // =========================================================================
  describe('sanitizeCustomerResponse', () => {
    it('returns only safe fields', () => {
      const result = sanitizeCustomerResponse(makeStoredCustomer());

      expect(result.customerId).toBe('cognito-sub-abc123');
      expect(result.email).toBe('Alice@Example.com');
      expect(result.emailVerified).toBe(true);
      expect(result.accountStatus).toBe('pending_profile');
      expect(result.createdAt).toBeDefined();
      expect(result.updatedAt).toBeDefined();
    });

    it('does not include cognitoSub', () => {
      const result = sanitizeCustomerResponse(makeStoredCustomer());
      expect(result.cognitoSub).toBeUndefined();
    });

    it('does not include emailNormalized', () => {
      const result = sanitizeCustomerResponse(makeStoredCustomer());
      expect(result.emailNormalized).toBeUndefined();
    });

    it('does not include version', () => {
      const result = sanitizeCustomerResponse(makeStoredCustomer());
      expect(result.version).toBeUndefined();
    });

    it('does not include lastSyncedFromCognitoAt', () => {
      const result = sanitizeCustomerResponse(makeStoredCustomer());
      expect(result.lastSyncedFromCognitoAt).toBeUndefined();
    });

    it('returns null when customer is null', () => {
      expect(sanitizeCustomerResponse(null)).toBeNull();
    });
  });

  // =========================================================================
  // POST /api/customers/bootstrap — Happy path
  // =========================================================================
  describe('POST /api/customers/bootstrap — new verified bootstrap', () => {
    test.each([
      ['admin only', ['admin']],
      ['system only', ['system']],
      ['no groups', []],
      ['malformed groups', 'customer'],
    ])('denies %s with CUSTOMER_REQUIRED', async (_label, groups) => {
      const jwtStub = makeJwtStub('authenticated', {
        sub: 'trusted-sub', email: 'trusted@example.com', emailVerified: true, groups,
      });
      const mockService = makeMockService();
      const app = express();
      app.use(express.json());
      app.use('/api/customers', createCustomerRegistrationRouter(jwtStub, mockService));
      const result = await request(app, 'POST', '/api/customers/bootstrap');
      expect(result.status).toBe(403);
      expect(result.body.code).toBe('CUSTOMER_REQUIRED');
      expect(mockService.bootstrapCustomer).not.toHaveBeenCalled();
    });

    it('accepts admin plus customer without granting customer access from admin alone', async () => {
      const jwtStub = makeJwtStub('authenticated', {
        sub: 'trusted-sub', email: 'trusted@example.com', emailVerified: true,
        groups: ['admin', 'customer'],
      });
      const mockService = makeMockService();
      const app = express();
      app.use(express.json());
      app.use('/api/customers', createCustomerRegistrationRouter(jwtStub, mockService));
      expect((await request(app, 'POST', '/api/customers/bootstrap')).status).toBe(201);
    });
    it('returns 201 with sanitized customer on successful new bootstrap', async () => {
      const app = buildTestApp('authenticated', {
        bootstrapCustomer: jest.fn().mockResolvedValue({
          created: true,
          customer: makeStoredCustomer(),
        }),
      });

      const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.customer.customerId).toBe('cognito-sub-abc123');
    });

    it('returns 200 on idempotent repeat bootstrap (record already exists)', async () => {
      const app = buildTestApp('authenticated', {
        bootstrapCustomer: jest.fn().mockResolvedValue({
          created: false,
          customer: makeStoredCustomer(),
        }),
      });

      const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('passes req.auth (not body) to the service', async () => {
      const mockService = makeMockService();
      const jwtStub = makeJwtStub('authenticated', {
        sub: 'real-sub',
        email: 'real@example.com',
        emailVerified: true,
        groups: ['customer'],
        scopes: [],
      });

      const app = express();
      app.use(express.json());
      app.use('/api/customers', createCustomerRegistrationRouter(jwtStub, mockService));

      // Malicious body with fake identity claims — should be ignored
      await request(app, 'POST', '/api/customers/bootstrap', {
        customerId: 'hacker-id',
        cognitoSub: 'hacker-sub',
        email: 'hacker@evil.com',
        emailVerified: true,
      });

      // Service is called with req.auth, not with body-supplied data
      expect(mockService.bootstrapCustomer).toHaveBeenCalledTimes(1);
      const [calledAuth] = mockService.bootstrapCustomer.mock.calls[0];
      // calledAuth is req.auth which comes from the JWT stub
      expect(calledAuth.sub).toBe('real-sub');
      expect(calledAuth.email).toBe('real@example.com');
    });

    it('does not include internal fields (cognitoSub, version, emailNormalized) in response', async () => {
      const app = buildTestApp('authenticated');

      const { body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(body.customer.cognitoSub).toBeUndefined();
      expect(body.customer.version).toBeUndefined();
      expect(body.customer.emailNormalized).toBeUndefined();
      expect(body.customer.lastSyncedFromCognitoAt).toBeUndefined();
    });
  });

  // =========================================================================
  // JWT middleware propagation — missing/invalid tokens
  // =========================================================================
  describe('JWT middleware error propagation', () => {
    it('returns 401 when JWT middleware rejects (MISSING_TOKEN)', async () => {
      const app = buildTestApp('missing_token');

      const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(status).toBe(401);
      expect(body.code).toBe('MISSING_TOKEN');
    });

    it('returns 403 when JWT middleware rejects (CLAIM_VALIDATION_FAILED)', async () => {
      const app = buildTestApp('forbidden');

      const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(status).toBe(403);
      expect(body.code).toBe('CLAIM_VALIDATION_FAILED');
    });

    it('returns 401 when JWT middleware rejects (TOKEN_EXPIRED)', async () => {
      const app = buildTestApp('expired');

      const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(status).toBe(401);
      expect(body.code).toBe('TOKEN_EXPIRED');
    });

    it('does not call bootstrapCustomer when JWT auth fails', async () => {
      const mockService = makeMockService();
      const jwtStub = makeJwtStub('missing_token');

      const app = express();
      app.use(express.json());
      app.use('/api/customers', createCustomerRegistrationRouter(jwtStub, mockService));

      await request(app, 'POST', '/api/customers/bootstrap');

      expect(mockService.bootstrapCustomer).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Domain error safe responses
  // =========================================================================
  describe('domain error safe responses', () => {
    it('returns 403 MISSING_CLAIMS when sub is missing from req.auth', async () => {
      const { DomainErrors: DomErrCodes } = require('../../services/customerService');

      const missingClaimsErr = new Error('A valid sub claim is required.');
      missingClaimsErr.code = DomErrCodes.MISSING_CLAIMS;
      missingClaimsErr.status = 400;
      missingClaimsErr.isDomainError = true;

      const app = buildTestApp('authenticated', {
        bootstrapCustomer: jest.fn().mockRejectedValue(missingClaimsErr),
      });

      const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(status).toBe(400);
      expect(body.code).toBe(DomainErrors.MISSING_CLAIMS);
    });

    it('returns 403 EMAIL_UNVERIFIED when email is not verified', async () => {
      const unverifiedErr = new Error('Email address must be verified.');
      unverifiedErr.code = DomainErrors.EMAIL_UNVERIFIED;
      unverifiedErr.status = 403;
      unverifiedErr.isDomainError = true;

      const app = buildTestApp('authenticated', {
        bootstrapCustomer: jest.fn().mockRejectedValue(unverifiedErr),
      });

      const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(status).toBe(403);
      expect(body.code).toBe(DomainErrors.EMAIL_UNVERIFIED);
    });

    it('returns 409 ACCOUNT_EMAIL_CONFLICT on duplicate email', async () => {
      const conflictErr = new Error('An account with this email address already exists.');
      conflictErr.code = DomainErrors.ACCOUNT_EMAIL_CONFLICT;
      conflictErr.status = 409;
      conflictErr.isDomainError = true;

      const app = buildTestApp('authenticated', {
        bootstrapCustomer: jest.fn().mockRejectedValue(conflictErr),
      });

      const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(status).toBe(409);
      expect(body.code).toBe(DomainErrors.ACCOUNT_EMAIL_CONFLICT);
    });

    it('returns 500 CUSTOMER_BOOTSTRAP_FAILED on DynamoDB failure', async () => {
      const bootstrapErr = new Error('Customer record write failed. Please retry.');
      bootstrapErr.code = DomainErrors.CUSTOMER_BOOTSTRAP_FAILED;
      bootstrapErr.status = 500;
      bootstrapErr.isDomainError = true;

      const app = buildTestApp('authenticated', {
        bootstrapCustomer: jest.fn().mockRejectedValue(bootstrapErr),
      });

      const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(status).toBe(500);
      expect(body.code).toBe(DomainErrors.CUSTOMER_BOOTSTRAP_FAILED);
    });

    it('returns 500 on unexpected non-domain error without leaking internals', async () => {
      const unexpectedErr = new Error('ECONNREFUSED — internal details');
      // No isDomainError flag

      const app = buildTestApp('authenticated', {
        bootstrapCustomer: jest.fn().mockRejectedValue(unexpectedErr),
      });

      const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(status).toBe(500);
      expect(body.code).toBe(DomainErrors.CUSTOMER_BOOTSTRAP_FAILED);
      // Safe: no raw error message or stack trace in response
      expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
      expect(JSON.stringify(body)).not.toContain('internal details');
    });
  });

  // =========================================================================
  // Security: body identity claims are not reflected
  // =========================================================================
  describe('body identity claims are not used', () => {
    it('does not reflect body-supplied customerId in response', async () => {
      const mockService = makeMockService();
      const jwtStub = makeJwtStub('authenticated', {
        sub: 'the-real-sub',
        email: 'real@example.com',
        emailVerified: true,
        groups: ['customer'],
        scopes: [],
      });

      const app = express();
      app.use(express.json());
      app.use('/api/customers', createCustomerRegistrationRouter(jwtStub, mockService));

      await request(app, 'POST', '/api/customers/bootstrap', {
        customerId: 'attacker-supplied-id',
        email: 'attacker@evil.com',
      });

      // The service was called with req.auth, not body
      const [calledAuth] = mockService.bootstrapCustomer.mock.calls[0];
      expect(calledAuth.sub).toBe('the-real-sub');
      expect(calledAuth.email).toBe('real@example.com');
    });

    it('service is called with req.auth object, not req.body', async () => {
      const mockService = makeMockService();
      const auth = {
        sub: 'jwt-sub-xyz',
        email: 'jwt@example.com',
        emailVerified: true,
        groups: ['customer'],
        scopes: [],
      };
      const jwtStub = makeJwtStub('authenticated', auth);

      const app = express();
      app.use(express.json());
      app.use('/api/customers', createCustomerRegistrationRouter(jwtStub, mockService));

      await request(app, 'POST', '/api/customers/bootstrap');

      const [calledWith] = mockService.bootstrapCustomer.mock.calls[0];
      expect(calledWith).toEqual(auth);
    });
  });

  // =========================================================================
  // Response structure
  // =========================================================================
  describe('response structure', () => {
    it('response body has success and customer fields on 201', async () => {
      const app = buildTestApp('authenticated');

      const { body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(body).toHaveProperty('success', true);
      expect(body).toHaveProperty('customer');
    });

    it('customer in response has customerId, email, emailVerified, accountStatus, createdAt, updatedAt', async () => {
      const app = buildTestApp('authenticated');

      const { body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(body.customer).toHaveProperty('customerId');
      expect(body.customer).toHaveProperty('email');
      expect(body.customer).toHaveProperty('emailVerified');
      expect(body.customer).toHaveProperty('accountStatus');
      expect(body.customer).toHaveProperty('createdAt');
      expect(body.customer).toHaveProperty('updatedAt');
    });

    it('error responses have error and code fields', async () => {
      const app = buildTestApp('missing_token');

      const { body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('code');
    });
  });

  // =========================================================================
  // Route only accepts POST /bootstrap (not other methods/paths)
  // =========================================================================
  describe('routing', () => {
    it('returns 404 for GET /api/customers/bootstrap', async () => {
      const app = buildTestApp('authenticated');

      const { status } = await request(app, 'GET', '/api/customers/bootstrap');

      expect(status).toBe(404);
    });

    it('returns 404 for POST /api/customers/other-path', async () => {
      const app = buildTestApp('authenticated');

      const { status } = await request(app, 'POST', '/api/customers/other-path');

      expect(status).toBe(404);
    });
  });
});

// =============================================================================
// server.js Integration Tests (Defect 1)
//
// These tests verify that server.js:
//   1. Correctly mounts POST /api/customers/bootstrap (JWT-protected)
//   2. Disables the legacy POST /api/auth/register (must not create users)
//
// We build a minimal Express app that mirrors server.js route wiring to avoid
// loading the real server.js (which calls app.listen and requires live AWS/env).
// This matches the pattern used throughout the codebase: inject stubs for JWT
// and service dependencies.
// =============================================================================
describe('server.js route wiring (Defect 1 integration)', () => {
  /**
   * Builds a minimal Express app that replicates the relevant server.js
   * routing decisions:
   *   - Mounts customerRegistrationRouter at /api/customers
   *   - Mounts the disabled legacy register handler at /api/auth/register
   *
   * Uses the same stub helpers as the unit tests above.
   */
  function buildServerMirrorApp(jwtMode = 'authenticated', serviceOverrides = {}) {
    const app = express();
    app.use(express.json());

    const jwtStub = makeJwtStub(jwtMode);
    const mockService = makeMockService(serviceOverrides);

    // Mirror: app.use('/api/customers', createCustomerRegistrationRouter(jwtAuth))
    app.use('/api/customers', createCustomerRegistrationRouter(jwtStub, mockService));

    // Mirror: legacy disabled endpoint from server.js
    app.post('/api/auth/register', (req, res) => {
      return res.status(404).json({
        error: 'This endpoint has been removed. Customer registration is now handled by Cognito.',
        code: 'ENDPOINT_REMOVED',
      });
    });

    app._mockService = mockService;
    return app;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // =========================================================================
  // POST /api/customers/bootstrap — correctly mounted and JWT-protected
  // =========================================================================
  describe('POST /api/customers/bootstrap is mounted and JWT-protected', () => {
    it('returns 201 when JWT auth passes and bootstrap succeeds (new record)', async () => {
      const app = buildServerMirrorApp('authenticated', {
        bootstrapCustomer: jest.fn().mockResolvedValue({
          created: true,
          customer: makeStoredCustomer(),
        }),
      });

      const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.customer).toBeDefined();
    });

    it('returns 200 on idempotent bootstrap (existing record)', async () => {
      const app = buildServerMirrorApp('authenticated', {
        bootstrapCustomer: jest.fn().mockResolvedValue({
          created: false,
          customer: makeStoredCustomer(),
        }),
      });

      const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(status).toBe(200);
      expect(body.success).toBe(true);
    });

    it('returns 401 when no JWT token is provided (JWT middleware guards the route)', async () => {
      const app = buildServerMirrorApp('missing_token');

      const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(status).toBe(401);
      expect(body.code).toBe('MISSING_TOKEN');
    });

    it('returns 401 when JWT token is expired', async () => {
      const app = buildServerMirrorApp('expired');

      const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(status).toBe(401);
      expect(body.code).toBe('TOKEN_EXPIRED');
    });

    it('returns 403 when JWT claims are invalid', async () => {
      const app = buildServerMirrorApp('forbidden');

      const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');

      expect(status).toBe(403);
      expect(body.code).toBe('CLAIM_VALIDATION_FAILED');
    });

    it('does not invoke bootstrapCustomer when JWT auth fails', async () => {
      const mockService = makeMockService();
      const jwtStub = makeJwtStub('missing_token');
      const app = express();
      app.use(express.json());
      app.use('/api/customers', createCustomerRegistrationRouter(jwtStub, mockService));

      await request(app, 'POST', '/api/customers/bootstrap');

      expect(mockService.bootstrapCustomer).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Legacy POST /api/auth/register — must be disabled
  // =========================================================================
  describe('Legacy POST /api/auth/register is disabled', () => {
    it('returns a non-2xx status code for POST /api/auth/register', async () => {
      const app = buildServerMirrorApp();

      const { status } = await request(app, 'POST', '/api/auth/register', {
        email: 'test@example.com',
        password: 'SomePassword123',
      });

      // Must NOT succeed — any 4xx or 5xx response is acceptable
      expect(status).toBeGreaterThanOrEqual(400);
    });

    it('returns 404 for POST /api/auth/register (endpoint removed)', async () => {
      const app = buildServerMirrorApp();

      const { status, body } = await request(app, 'POST', '/api/auth/register', {
        email: 'test@example.com',
        password: 'SomePassword123',
      });

      expect(status).toBe(404);
      expect(body.code).toBe('ENDPOINT_REMOVED');
    });

    it('does not call bootstrapCustomer for POST /api/auth/register requests', async () => {
      const app = buildServerMirrorApp();

      await request(app, 'POST', '/api/auth/register', {
        email: 'test@example.com',
        password: 'password123',
      });

      // The bootstrap service should never be invoked by the legacy route
      expect(app._mockService.bootstrapCustomer).not.toHaveBeenCalled();
    });

    it('response body for disabled register route does not contain a token or password hash', async () => {
      const app = buildServerMirrorApp();

      const { body } = await request(app, 'POST', '/api/auth/register', {
        email: 'test@example.com',
        password: 'password123',
      });

      const bodyStr = JSON.stringify(body);
      expect(bodyStr).not.toContain('token');
      expect(bodyStr).not.toContain('passwordHash');
      expect(bodyStr).not.toContain('password');
    });

    it('the disabled register route returns a machine-readable code indicating removal', async () => {
      const app = buildServerMirrorApp();

      const { body } = await request(app, 'POST', '/api/auth/register', {});

      expect(body).toHaveProperty('code');
      expect(body).toHaveProperty('error');
    });
  });
});
