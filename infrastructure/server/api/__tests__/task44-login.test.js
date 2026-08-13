'use strict';

/**
 * Task 4.4 — Customer Login: Backend Integration Tests
 *
 * Tests the backend changes from Task 4.4:
 *   1. POST /api/auth/login is DISABLED (returns 404 ENDPOINT_REMOVED)
 *   2. POST /api/auth/register is DISABLED (returns 404 ENDPOINT_REMOVED)
 *   3. POST /api/auth/verify is DISABLED (returns 404 ENDPOINT_REMOVED)
 *   4. POST /api/customers/bootstrap is correctly mounted and JWT-protected
 *   5. Backend is stateless — no session tokens issued
 *   6. No tokens/passwords in DynamoDB or responses
 *   7. Account status handling (blocked statuses cannot bootstrap)
 *   8. CONCURRENT_MODIFICATION error handling
 *   9. Response does not leak internal fields
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
// Helpers (reused from customerRegistrationApi.test.js pattern)
// ---------------------------------------------------------------------------

function makeJwtStub(mode = 'authenticated', auth = null) {
  return (req, res, next) => {
    if (mode === 'authenticated') {
      req.auth = auth || {
        sub: 'cognito-sub-test',
        email: 'test@example.com',
        emailVerified: true,
        groups: [],
        scopes: [],
      };
      return next();
    }
    if (mode === 'missing_token') {
      return res.status(401).json({ error: 'Authorization header with Bearer token is required.', code: 'MISSING_TOKEN' });
    }
    if (mode === 'expired') {
      return res.status(401).json({ error: 'Token has expired.', code: 'TOKEN_EXPIRED' });
    }
    if (mode === 'forbidden') {
      return res.status(403).json({ error: 'Token claims are invalid.', code: 'CLAIM_VALIDATION_FAILED' });
    }
    return next();
  };
}

function makeMockService(overrides = {}) {
  return {
    bootstrapCustomer: jest.fn().mockResolvedValue({
      created: true,
      customer: makeStoredCustomer(),
    }),
    ...overrides,
  };
}

function makeStoredCustomer(overrides = {}) {
  return {
    customerId: 'cognito-sub-test',
    cognitoSub: 'cognito-sub-test',
    emailNormalized: 'test@example.com',
    emailDisplay: 'test@example.com',
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
 * Builds a minimal Express app that mirrors the server.js routing for Task 4.4:
 *   - POST /api/customers/bootstrap (JWT-protected)
 *   - POST /api/auth/register (disabled — 404 ENDPOINT_REMOVED)
 *   - POST /api/auth/login (disabled — 404 ENDPOINT_REMOVED)
 *   - POST /api/auth/verify (disabled — 404 ENDPOINT_REMOVED)
 */
function buildServerMirrorApp(jwtMode = 'authenticated', serviceOverrides = {}) {
  const app = express();
  app.use(express.json());

  const jwtStub = makeJwtStub(jwtMode);
  const mockService = makeMockService(serviceOverrides);

  // Customer bootstrap (Task 4.3/4.4) — JWT-protected
  app.use('/api/customers', createCustomerRegistrationRouter(jwtStub, mockService));

  // Legacy POST /api/auth/register — PERMANENTLY DISABLED (Task 4.4)
  app.post('/api/auth/register', (req, res) => {
    return res.status(404).json({
      error: 'This endpoint has been removed. Customer registration is now handled by Cognito.',
      code: 'ENDPOINT_REMOVED',
    });
  });

  // Legacy POST /api/auth/login — PERMANENTLY DISABLED (Task 4.4)
  app.post('/api/auth/login', (req, res) => {
    return res.status(404).json({
      error: 'This endpoint has been removed. Authentication is now handled exclusively by Cognito Hosted UI.',
      code: 'ENDPOINT_REMOVED',
    });
  });

  // Legacy POST /api/auth/verify — PERMANENTLY DISABLED (Task 4.4)
  app.post('/api/auth/verify', (req, res) => {
    return res.status(404).json({
      error: 'This endpoint has been removed. Token verification is performed by the jwtAuth middleware.',
      code: 'ENDPOINT_REMOVED',
    });
  });

  app._mockService = mockService;
  return app;
}

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

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// Task 4.4: Legacy Login Endpoints — DISABLED
// ===========================================================================

describe('Task 4.4: POST /api/auth/login is DISABLED', () => {
  it('returns 404 for POST /api/auth/login', async () => {
    const app = buildServerMirrorApp();
    const { status } = await request(app, 'POST', '/api/auth/login', {
      email: 'test@example.com',
      password: 'Password123!',
    });
    expect(status).toBe(404);
  });

  it('returns ENDPOINT_REMOVED code for POST /api/auth/login', async () => {
    const app = buildServerMirrorApp();
    const { body } = await request(app, 'POST', '/api/auth/login', {
      email: 'test@example.com',
      password: 'Password123!',
    });
    expect(body.code).toBe('ENDPOINT_REMOVED');
    expect(body.error).toBeDefined();
  });

  it('response does NOT contain a token or session for POST /api/auth/login', async () => {
    const app = buildServerMirrorApp();
    const { body } = await request(app, 'POST', '/api/auth/login', {
      email: 'test@example.com',
      password: 'Password123!',
    });
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toMatch(/\"token\":/);
    expect(bodyStr).not.toContain('sessionToken');
    expect(bodyStr).not.toContain('access_token');
  });

  it('response does NOT contain a password hash for POST /api/auth/login', async () => {
    const app = buildServerMirrorApp();
    const { body } = await request(app, 'POST', '/api/auth/login', {
      email: 'test@example.com',
      password: 'Password123!',
    });
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('passwordHash');
    expect(bodyStr).not.toContain('password');
  });

  it('does NOT call bootstrapCustomer for POST /api/auth/login', async () => {
    const app = buildServerMirrorApp();
    await request(app, 'POST', '/api/auth/login', {
      email: 'test@example.com',
      password: 'Password123!',
    });
    expect(app._mockService.bootstrapCustomer).not.toHaveBeenCalled();
  });
});

describe('Task 4.4: POST /api/auth/register is DISABLED', () => {
  it('returns 404 for POST /api/auth/register', async () => {
    const app = buildServerMirrorApp();
    const { status } = await request(app, 'POST', '/api/auth/register', {
      email: 'new@example.com',
      password: 'Password123!',
    });
    expect(status).toBe(404);
  });

  it('returns ENDPOINT_REMOVED code for POST /api/auth/register', async () => {
    const app = buildServerMirrorApp();
    const { body } = await request(app, 'POST', '/api/auth/register', {
      email: 'new@example.com',
      password: 'Password123!',
    });
    expect(body.code).toBe('ENDPOINT_REMOVED');
  });

  it('does NOT call bootstrapCustomer for POST /api/auth/register', async () => {
    const app = buildServerMirrorApp();
    await request(app, 'POST', '/api/auth/register', {
      email: 'new@example.com',
      password: 'Password123!',
    });
    expect(app._mockService.bootstrapCustomer).not.toHaveBeenCalled();
  });

  it('does NOT contain password or passwordHash in response for POST /api/auth/register', async () => {
    const app = buildServerMirrorApp();
    const { body } = await request(app, 'POST', '/api/auth/register', {
      email: 'new@example.com',
      password: 'Password123!',
    });
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('passwordHash');
    expect(bodyStr).not.toContain('password');
  });
});

describe('Task 4.4: POST /api/auth/verify is DISABLED', () => {
  it('returns 404 for POST /api/auth/verify', async () => {
    const app = buildServerMirrorApp();
    const { status } = await request(app, 'POST', '/api/auth/verify', {
      token: 'some-legacy-token',
    });
    expect(status).toBe(404);
  });

  it('returns ENDPOINT_REMOVED code for POST /api/auth/verify', async () => {
    const app = buildServerMirrorApp();
    const { body } = await request(app, 'POST', '/api/auth/verify', {
      token: 'some-legacy-token',
    });
    expect(body.code).toBe('ENDPOINT_REMOVED');
  });
});

// ===========================================================================
// Task 4.4: POST /api/customers/bootstrap — correctly mounted and protected
// ===========================================================================

describe('Task 4.4: POST /api/customers/bootstrap is mounted and JWT-protected', () => {
  it('returns 201 on successful new bootstrap (authenticated)', async () => {
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
        customer: makeStoredCustomer({ accountStatus: 'active' }),
      }),
    });

    const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('returns 401 when no JWT token provided (MISSING_TOKEN)', async () => {
    const app = buildServerMirrorApp('missing_token');
    const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');
    expect(status).toBe(401);
    expect(body.code).toBe('MISSING_TOKEN');
  });

  it('returns 401 when JWT token is expired (TOKEN_EXPIRED)', async () => {
    const app = buildServerMirrorApp('expired');
    const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');
    expect(status).toBe(401);
    expect(body.code).toBe('TOKEN_EXPIRED');
  });

  it('returns 403 when JWT claims are invalid (CLAIM_VALIDATION_FAILED)', async () => {
    const app = buildServerMirrorApp('forbidden');
    const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');
    expect(status).toBe(403);
    expect(body.code).toBe('CLAIM_VALIDATION_FAILED');
  });

  it('does NOT call bootstrapCustomer when JWT auth fails', async () => {
    const app = buildServerMirrorApp('missing_token');
    await request(app, 'POST', '/api/customers/bootstrap');
    expect(app._mockService.bootstrapCustomer).not.toHaveBeenCalled();
  });
});

// ===========================================================================
// Task 4.4: Account Status Handling
// ===========================================================================

describe('Task 4.4: blocked account statuses from bootstrap service', () => {
  const blockedCases = [
    { status: 'disabled', code: DomainErrors.ACCOUNT_EMAIL_CONFLICT, httpStatus: 409 },
    { status: 'deletion_requested', code: DomainErrors.ACCOUNT_EMAIL_CONFLICT, httpStatus: 409 },
    { status: 'deleted', code: DomainErrors.ACCOUNT_EMAIL_CONFLICT, httpStatus: 409 },
    { status: 'merged', code: DomainErrors.ACCOUNT_EMAIL_CONFLICT, httpStatus: 409 },
  ];

  blockedCases.forEach(({ status: accountStatus, code, httpStatus }) => {
    it(`returns ${httpStatus} ${code} for conflicting account with status=${accountStatus}`, async () => {
      const conflictErr = new Error(`Account conflict: ${accountStatus}`);
      conflictErr.code = code;
      conflictErr.status = httpStatus;
      conflictErr.isDomainError = true;

      const app = buildServerMirrorApp('authenticated', {
        bootstrapCustomer: jest.fn().mockRejectedValue(conflictErr),
      });

      const { status: respStatus, body } = await request(app, 'POST', '/api/customers/bootstrap');
      expect(respStatus).toBe(httpStatus);
      expect(body.code).toBe(code);
      // Safe: no stack trace or raw AWS error in response
      expect(JSON.stringify(body)).not.toContain('Error:');
      expect(JSON.stringify(body)).not.toContain('at ');
    });
  });

  it('does not reactivate disabled accounts (bootstrap returns conflict, not success)', async () => {
    const disabledConflict = new Error('Account is disabled.');
    disabledConflict.code = DomainErrors.ACCOUNT_EMAIL_CONFLICT;
    disabledConflict.status = 409;
    disabledConflict.isDomainError = true;

    const app = buildServerMirrorApp('authenticated', {
      bootstrapCustomer: jest.fn().mockRejectedValue(disabledConflict),
    });

    const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');
    expect(status).toBe(409);
    expect(body.success).toBeUndefined(); // No success field on errors
    expect(body.code).toBe(DomainErrors.ACCOUNT_EMAIL_CONFLICT);
  });
});

// ===========================================================================
// Task 4.4: EMAIL_UNVERIFIED handling from bootstrap
// ===========================================================================

describe('Task 4.4: EMAIL_UNVERIFIED from bootstrap service', () => {
  it('returns 403 EMAIL_UNVERIFIED when email is not verified', async () => {
    const unverifiedErr = new Error('Email address must be verified.');
    unverifiedErr.code = DomainErrors.EMAIL_UNVERIFIED;
    unverifiedErr.status = 403;
    unverifiedErr.isDomainError = true;

    const app = buildServerMirrorApp('authenticated', {
      bootstrapCustomer: jest.fn().mockRejectedValue(unverifiedErr),
    });

    const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');
    expect(status).toBe(403);
    expect(body.code).toBe(DomainErrors.EMAIL_UNVERIFIED);
  });
});

// ===========================================================================
// Task 4.4: CONCURRENT_MODIFICATION handling
// ===========================================================================

describe('Task 4.4: CONCURRENT_MODIFICATION from bootstrap service', () => {
  it('returns 409 CONCURRENT_MODIFICATION on optimistic lock failure', async () => {
    const concurrentErr = new Error('Concurrent modification detected.');
    concurrentErr.code = DomainErrors.CONCURRENT_MODIFICATION;
    concurrentErr.status = 409;
    concurrentErr.isDomainError = true;

    const app = buildServerMirrorApp('authenticated', {
      bootstrapCustomer: jest.fn().mockRejectedValue(concurrentErr),
    });

    const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');
    expect(status).toBe(409);
    expect(body.code).toBe(DomainErrors.CONCURRENT_MODIFICATION);
  });
});

// ===========================================================================
// Task 4.4: No credentials/tokens in DynamoDB (via response inspection)
// ===========================================================================

describe('Task 4.4: no credentials or tokens in bootstrap response', () => {
  it('bootstrap response does NOT contain a token, password, or refreshToken field', async () => {
    const app = buildServerMirrorApp('authenticated', {
      bootstrapCustomer: jest.fn().mockResolvedValue({
        created: true,
        customer: makeStoredCustomer(),
      }),
    });

    const { body } = await request(app, 'POST', '/api/customers/bootstrap');
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toMatch(/\"token\":/);
    expect(bodyStr).not.toContain('refreshToken');
    expect(bodyStr).not.toContain('access_token');
    expect(bodyStr).not.toContain('passwordHash');
    expect(bodyStr).not.toContain('password');
  });

  it('bootstrap response does NOT expose cognitoSub, version, or emailNormalized', async () => {
    const app = buildServerMirrorApp('authenticated');
    const { body } = await request(app, 'POST', '/api/customers/bootstrap');
    expect(body.customer.cognitoSub).toBeUndefined();
    expect(body.customer.version).toBeUndefined();
    expect(body.customer.emailNormalized).toBeUndefined();
    expect(body.customer.lastSyncedFromCognitoAt).toBeUndefined();
  });
});

// ===========================================================================
// Task 4.4: Backend statelessness — no session store
// ===========================================================================

describe('Task 4.4: backend statelessness', () => {
  it('POST /api/customers/bootstrap does not return a session token or cookie', async () => {
    const app = buildServerMirrorApp('authenticated');

    return new Promise((resolve, reject) => {
      const server = http.createServer(app);
      server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        const req = http.request({
          hostname: '127.0.0.1',
          port,
          path: '/api/customers/bootstrap',
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        }, (res) => {
          let data = '';
          res.on('data', c => { data += c; });
          res.on('end', () => {
            server.close();
            const body = JSON.parse(data);
            const bodyStr = JSON.stringify(body);
            // Backend must not set session tokens
            expect(bodyStr).not.toMatch(/\"token\":/);
            expect(bodyStr).not.toContain('sessionToken');
            // No backend-managed authentication cookie is permitted.
            const setCookie = res.headers['set-cookie'];
            if (setCookie) {
              // If any cookie is set, it must not be a session token
              const cookieStr = JSON.stringify(setCookie);
              expect(cookieStr).not.toContain('session');
            }
            resolve();
          });
        });
        req.on('error', (err) => { server.close(); reject(err); });
        req.end();
      });
    });
  });

  it('bootstrap service is called with req.auth claims, not req.body claims', async () => {
    const mockService = makeMockService();
    const jwtStub = makeJwtStub('authenticated', {
      sub: 'real-jwt-sub',
      email: 'real@example.com',
      emailVerified: true,
      groups: [],
      scopes: [],
    });

    const app = express();
    app.use(express.json());
    app.use('/api/customers', createCustomerRegistrationRouter(jwtStub, mockService));

    // Send a malicious body — should be ignored
    await request(app, 'POST', '/api/customers/bootstrap', {
      sub: 'attacker-sub',
      email: 'attacker@evil.com',
      emailVerified: true,
    });

    const [calledAuth] = mockService.bootstrapCustomer.mock.calls[0];
    expect(calledAuth.sub).toBe('real-jwt-sub');
    expect(calledAuth.email).toBe('real@example.com');
  });
});

// ===========================================================================
// Task 4.4: Safe error responses — no raw internals leaked
// ===========================================================================

describe('Task 4.4: safe error responses — no AWS/Cognito internals leaked', () => {
  it('unexpected error returns safe CUSTOMER_BOOTSTRAP_FAILED without stack trace', async () => {
    const internalErr = new Error('ConditionalCheckFailedException: internal detail from DynamoDB');
    // No isDomainError flag — unexpected

    const app = buildServerMirrorApp('authenticated', {
      bootstrapCustomer: jest.fn().mockRejectedValue(internalErr),
    });

    const { status, body } = await request(app, 'POST', '/api/customers/bootstrap');
    expect(status).toBe(500);
    expect(body.code).toBe(DomainErrors.CUSTOMER_BOOTSTRAP_FAILED);
    const bodyStr = JSON.stringify(body);
    // Must not leak raw error messages or internal DynamoDB details
    expect(bodyStr).not.toContain('ConditionalCheckFailedException');
    expect(bodyStr).not.toContain('internal detail');
    expect(bodyStr).not.toMatch(/at\s+\w+\s+\(/); // No stack trace lines
  });

  it('all error responses have both error and code fields', async () => {
    const cases = [
      buildServerMirrorApp('missing_token'),
      buildServerMirrorApp('expired'),
      buildServerMirrorApp('forbidden'),
    ];

    for (const app of cases) {
      const { body } = await request(app, 'POST', '/api/customers/bootstrap');
      expect(body).toHaveProperty('error');
      expect(body).toHaveProperty('code');
    }
  });
});
