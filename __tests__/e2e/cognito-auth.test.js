'use strict';

/**
 * Task 4.4 — Customer Login: Frontend Unit Tests (cognito-auth.js)
 *
 * Test coverage:
 *   1. PKCE Flow: verifier/challenge generation, state validation, code exchange
 *   2. Token Storage: sessionStorage for Access/ID, never localStorage for refresh
 *   3. Automatic Bootstrap: callBootstrap invoked after verified login
 *   4. Token Usage: Access Token sent as Bearer, ID Token NOT for backend auth
 *   5. Logout: all auth state cleared from sessionStorage, in-memory, localStorage
 *   6. Email verified/unverified handling in bootstrap
 *   7. Idempotency/conflict error handling from bootstrap
 *   8. Transient retry logic in bootstrap
 *   9. Blocked account statuses
 *  10. Safe error mapping (no raw Cognito errors)
 *  11. State mismatch (CSRF protection)
 *  12. Legacy localStorage cleanup on logout
 */

// ---------------------------------------------------------------------------
// Browser-environment shimming for Node.js
// ---------------------------------------------------------------------------

// Web Crypto API (for generateCodeVerifier / generateCodeChallenge)
const { webcrypto } = require('crypto');
global.crypto = webcrypto;

// sessionStorage mock
const _sessionStore = {};
const sessionStorageMock = {
  getItem: jest.fn(key => _sessionStore[key] !== undefined ? _sessionStore[key] : null),
  setItem: jest.fn((key, value) => { _sessionStore[key] = String(value); }),
  removeItem: jest.fn(key => { delete _sessionStore[key]; }),
  clear: jest.fn(() => { Object.keys(_sessionStore).forEach(k => delete _sessionStore[k]); }),
};
Object.defineProperty(global, 'sessionStorage', { value: sessionStorageMock, writable: true });

// localStorage mock
const _localStore = {};
const localStorageMock = {
  getItem: jest.fn(key => _localStore[key] !== undefined ? _localStore[key] : null),
  setItem: jest.fn((key, value) => { _localStore[key] = String(value); }),
  removeItem: jest.fn(key => { delete _localStore[key]; }),
  clear: jest.fn(() => { Object.keys(_localStore).forEach(k => delete _localStore[k]); }),
};
Object.defineProperty(global, 'localStorage', { value: localStorageMock, writable: true });

// window mock
global.window = {
  location: {
    hostname: 'localhost',
    origin: 'http://localhost',
    pathname: '/account/account.html',
    search: '',
    href: '',
  },
  history: {
    replaceState: jest.fn(),
  },
  dispatchEvent: jest.fn(),
  addEventListener: jest.fn(),
};

// CustomEvent mock
global.CustomEvent = class CustomEvent {
  constructor(name, opts) {
    this.type = name;
    this.detail = opts && opts.detail;
  }
};

// document mock (for DOMContentLoaded listener registration)
global.document = {
  addEventListener: jest.fn(),
  getElementById: jest.fn(() => null),
  querySelectorAll: jest.fn(() => []),
};

// ---------------------------------------------------------------------------
// Load module under test
// ---------------------------------------------------------------------------

// We must load cognito-auth.js AFTER the globals are set up.
// Clear Node module cache to ensure fresh load.
let cognitoAuth;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();

  // Clear storage state
  Object.keys(_sessionStore).forEach(k => delete _sessionStore[k]);
  Object.keys(_localStore).forEach(k => delete _localStore[k]);

  // Reset window.location
  global.window.location = {
    hostname: 'localhost',
    origin: 'http://localhost',
    pathname: '/account/account.html',
    search: '',
    href: '',
  };

  // Re-require the module to get a fresh instance with clean state
  cognitoAuth = require('../../js/cognito-auth');
});

// ---------------------------------------------------------------------------
// 1. PKCE Flow — Code Verifier / Challenge Generation
// ---------------------------------------------------------------------------

describe('PKCE: generateCodeVerifier', () => {
  it('returns a non-empty string', async () => {
    const verifier = cognitoAuth.generateCodeVerifier();
    expect(typeof verifier).toBe('string');
    expect(verifier.length).toBeGreaterThan(0);
  });

  it('returns URL-safe base64 (no +, /, or = characters)', () => {
    const verifier = cognitoAuth.generateCodeVerifier();
    expect(verifier).not.toMatch(/[+/=]/);
  });

  it('generates unique verifiers on successive calls', () => {
    const v1 = cognitoAuth.generateCodeVerifier();
    const v2 = cognitoAuth.generateCodeVerifier();
    expect(v1).not.toBe(v2);
  });

  it('verifier is at least 43 characters (RFC 7636 minimum)', () => {
    const verifier = cognitoAuth.generateCodeVerifier();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });
});

describe('PKCE: generateCodeChallenge', () => {
  it('returns a URL-safe base64 string', async () => {
    const verifier = cognitoAuth.generateCodeVerifier();
    const challenge = await cognitoAuth.generateCodeChallenge(verifier);
    expect(typeof challenge).toBe('string');
    expect(challenge).not.toMatch(/[+/=]/);
    expect(challenge.length).toBeGreaterThan(0);
  });

  it('same verifier always produces same challenge (deterministic)', async () => {
    const verifier = cognitoAuth.generateCodeVerifier();
    const c1 = await cognitoAuth.generateCodeChallenge(verifier);
    const c2 = await cognitoAuth.generateCodeChallenge(verifier);
    expect(c1).toBe(c2);
  });

  it('different verifiers produce different challenges', async () => {
    const v1 = cognitoAuth.generateCodeVerifier();
    const v2 = cognitoAuth.generateCodeVerifier();
    const c1 = await cognitoAuth.generateCodeChallenge(v1);
    const c2 = await cognitoAuth.generateCodeChallenge(v2);
    expect(c1).not.toBe(c2);
  });
});

// ---------------------------------------------------------------------------
// 2. PKCE Flow — OAuth State Validation (CSRF protection)
// ---------------------------------------------------------------------------

describe('parseCodeFromUrl: OAuth state validation', () => {
  it('returns null when OAuth error is in URL', () => {
    global.window.location.search = '?error=access_denied&error_description=User+cancelled';
    const code = cognitoAuth.parseCodeFromUrl();
    expect(code).toBeNull();
  });

  it('returns null when no code in URL', () => {
    global.window.location.search = '';
    const code = cognitoAuth.parseCodeFromUrl();
    expect(code).toBeNull();
  });

  it('returns null on state mismatch (CSRF protection)', () => {
    global.window.location.search = '?code=abc123&state=bad-state';
    _sessionStore['oauth_state'] = 'expected-state';
    _sessionStore['dp_access_token'] = 'existing-access-token';
    const code = cognitoAuth.parseCodeFromUrl();
    expect(code).toBeNull();
    expect(_sessionStore['pkce_verifier']).toBeUndefined();
    expect(_sessionStore['dp_access_token']).toBeUndefined();
  });

  it('returns code when state matches', () => {
    global.window.location.search = '?code=valid-code&state=matching-state';
    _sessionStore['oauth_state'] = 'matching-state';
    const code = cognitoAuth.parseCodeFromUrl();
    expect(code).toBe('valid-code');
  });

  it('clears oauth_state from sessionStorage after validation', () => {
    global.window.location.search = '?code=some-code&state=some-state';
    _sessionStore['oauth_state'] = 'some-state';
    cognitoAuth.parseCodeFromUrl();
    expect(_sessionStore['oauth_state']).toBeUndefined();
  });

  it('rejects callback when both state values are missing', () => {
    global.window.location.search = '?code=stateless-code';
    delete _sessionStore['oauth_state'];
    const code = cognitoAuth.parseCodeFromUrl();
    expect(code).toBeNull();
  });

  it('rejects callback when stored state is missing', () => {
    global.window.location.search = '?code=code&state=returned-state';
    delete _sessionStore['oauth_state'];
    expect(cognitoAuth.parseCodeFromUrl()).toBeNull();
  });

  it('rejects callback when returned state is missing', () => {
    global.window.location.search = '?code=code';
    _sessionStore['oauth_state'] = 'stored-state';
    expect(cognitoAuth.parseCodeFromUrl()).toBeNull();
  });

  it('maps invalid_grant OAuth error correctly', () => {
    // parseCodeFromUrl returns null — error mapping is tested via mapOAuthError
    const { mapOAuthError, AUTH_ERRORS } = cognitoAuth;
    expect(mapOAuthError('invalid_grant')).toBe(AUTH_ERRORS.INVALID_GRANT);
  });

  it('maps invalid_request OAuth error correctly', () => {
    const { mapOAuthError, AUTH_ERRORS } = cognitoAuth;
    expect(mapOAuthError('invalid_request')).toBe(AUTH_ERRORS.INVALID_REQUEST);
  });

  it('maps unknown OAuth error to OAUTH_ERROR', () => {
    const { mapOAuthError, AUTH_ERRORS } = cognitoAuth;
    expect(mapOAuthError('something_weird')).toBe(AUTH_ERRORS.OAUTH_ERROR);
  });
});

// ---------------------------------------------------------------------------
// 3. Token Storage — Access Token in sessionStorage, never localStorage
// ---------------------------------------------------------------------------

describe('Token Storage: storeSessionTokens', () => {
  it('stores access token in sessionStorage', () => {
    cognitoAuth.storeSessionTokens('access-tok', 'id-tok');
    expect(_sessionStore['dp_access_token']).toBe('access-tok');
  });

  it('stores ID token in sessionStorage', () => {
    cognitoAuth.storeSessionTokens('access-tok', 'id-tok');
    expect(_sessionStore['dp_id_token']).toBe('id-tok');
  });

  it('does NOT store access token in localStorage', () => {
    cognitoAuth.storeSessionTokens('access-tok', 'id-tok');
    expect(_localStore['dp_access_token']).toBeUndefined();
  });

  it('does NOT store ID token in localStorage', () => {
    cognitoAuth.storeSessionTokens('access-tok', 'id-tok');
    expect(_localStore['dp_id_token']).toBeUndefined();
  });
});

describe('Token Storage: getAccessToken', () => {
  it('returns access token from sessionStorage', () => {
    _sessionStore['dp_access_token'] = 'stored-access-tok';
    const tok = cognitoAuth.getAccessToken();
    expect(tok).toBe('stored-access-tok');
  });

  it('returns null when sessionStorage is empty and no in-memory token', () => {
    delete _sessionStore['dp_access_token'];
    // Fresh module with no stored tokens
    const tok = cognitoAuth.getAccessToken();
    expect(tok).toBeNull();
  });
});

describe('Token Storage: storeRefreshToken', () => {
  it('stores refresh token in sessionStorage', () => {
    cognitoAuth.storeRefreshToken('refresh-tok');
    expect(_sessionStore['dp_refresh_token']).toBe('refresh-tok');
  });

  it('does NOT store refresh token in localStorage', () => {
    cognitoAuth.storeRefreshToken('refresh-tok');
    expect(_localStore['dp_refresh_token']).toBeUndefined();
  });

  it('does NOT make any network request when storing the refresh token', () => {
    // The refresh token is frontend-to-Cognito only. storeRefreshToken() MUST
    // not send any fetch/XHR to the backend, including /auth/session/ routes.
    const fetchSpy = jest.spyOn(global, 'fetch');
    cognitoAuth.storeRefreshToken('my-refresh-tok');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('does NOT send the refresh token to /auth/session/refresh-token', () => {
    // Belt-and-suspenders: assert the specific violating endpoint is never called.
    const fetchSpy = jest.spyOn(global, 'fetch');
    cognitoAuth.storeRefreshToken('my-refresh-tok');
    const relayCalls = fetchSpy.mock.calls.filter(([url]) =>
      typeof url === 'string' && url.includes('/auth/session/refresh-token')
    );
    expect(relayCalls.length).toBe(0);
    fetchSpy.mockRestore();
  });

  it('does nothing when refreshToken is null/undefined', () => {
    cognitoAuth.storeRefreshToken(null);
    cognitoAuth.storeRefreshToken(undefined);
    expect(_sessionStore['dp_refresh_token']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 4. Token Usage — Access Token sent as Bearer, ID Token NOT for backend auth
// ---------------------------------------------------------------------------

describe('authenticatedFetch: sends Access Token as Bearer', () => {
  beforeEach(() => {
    _sessionStore['dp_access_token'] = 'test-access-token';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ orders: [] }),
    });
  });

  it('sends Authorization: Bearer <access_token> header', async () => {
    await cognitoAuth.authenticatedFetch('/api/orders');
    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer test-access-token');
  });

  it('does NOT send the ID Token in the Authorization header', async () => {
    _sessionStore['dp_id_token'] = 'test-id-token';
    await cognitoAuth.authenticatedFetch('/api/orders');
    const [, options] = global.fetch.mock.calls[0];
    // Authorization header must contain Access Token, not ID Token
    expect(options.headers['Authorization']).toBe('Bearer test-access-token');
    expect(options.headers['Authorization']).not.toContain('test-id-token');
  });

  it('throws when no access token is available', async () => {
    delete _sessionStore['dp_access_token'];
    // Re-require to reset in-memory store
    jest.resetModules();
    Object.keys(_sessionStore).forEach(k => delete _sessionStore[k]);
    const freshAuth = require('../../js/cognito-auth');
    await expect(freshAuth.authenticatedFetch('/orders')).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. Logout — clears all auth state
// ---------------------------------------------------------------------------

describe('logout: clearAllAuthState', () => {
  beforeEach(() => {
    // Pre-populate storage with tokens
    _sessionStore['dp_access_token'] = 'access';
    _sessionStore['dp_id_token'] = 'id';
    _sessionStore['dp_refresh_token'] = 'refresh';
    _sessionStore['pkce_verifier'] = 'verifier';
    _sessionStore['oauth_state'] = 'state';

    // Pre-populate legacy localStorage items
    _localStore['dp_token'] = 'legacy-token';
    _localStore['dp_customer'] = '{"email":"test@example.com"}';
    _localStore['dp_access_token'] = 'old-access';
    _localStore['dp_id_token'] = 'old-id';
    _localStore['dp_refresh_token'] = 'old-refresh';
    _localStore['dp_session_token'] = 'old-session';
  });

  it('removes dp_access_token from sessionStorage', () => {
    cognitoAuth.clearAllAuthState();
    expect(_sessionStore['dp_access_token']).toBeUndefined();
  });

  it('removes dp_id_token from sessionStorage', () => {
    cognitoAuth.clearAllAuthState();
    expect(_sessionStore['dp_id_token']).toBeUndefined();
  });

  it('removes dp_refresh_token from sessionStorage', () => {
    cognitoAuth.clearAllAuthState();
    expect(_sessionStore['dp_refresh_token']).toBeUndefined();
  });

  it('removes pkce_verifier from sessionStorage', () => {
    cognitoAuth.clearAllAuthState();
    expect(_sessionStore['pkce_verifier']).toBeUndefined();
  });

  it('removes oauth_state from sessionStorage', () => {
    cognitoAuth.clearAllAuthState();
    expect(_sessionStore['oauth_state']).toBeUndefined();
  });

  it('removes legacy dp_token from localStorage', () => {
    cognitoAuth.clearAllAuthState();
    expect(_localStore['dp_token']).toBeUndefined();
  });

  it('removes legacy dp_customer from localStorage', () => {
    cognitoAuth.clearAllAuthState();
    expect(_localStore['dp_customer']).toBeUndefined();
  });

  it('removes legacy dp_access_token from localStorage', () => {
    cognitoAuth.clearAllAuthState();
    expect(_localStore['dp_access_token']).toBeUndefined();
  });

  it('removes legacy dp_id_token from localStorage', () => {
    cognitoAuth.clearAllAuthState();
    expect(_localStore['dp_id_token']).toBeUndefined();
  });

  it('removes legacy dp_refresh_token from localStorage', () => {
    cognitoAuth.clearAllAuthState();
    expect(_localStore['dp_refresh_token']).toBeUndefined();
  });

  it('removes legacy dp_session_token from localStorage', () => {
    cognitoAuth.clearAllAuthState();
    expect(_localStore['dp_session_token']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 6. Automatic Bootstrap — called after verified login
// ---------------------------------------------------------------------------

describe('callBootstrap: invoked after verified login', () => {
  const MOCK_ACCESS_TOKEN = 'mock-access-token';

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('calls POST /api/customers/bootstrap with Authorization: Bearer <accessToken>', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, customer: { customerId: 'abc' } }),
    });

    await cognitoAuth.callBootstrap(MOCK_ACCESS_TOKEN);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toContain('/api/customers/bootstrap');
    expect(options.method).toBe('POST');
    expect(options.headers['Authorization']).toBe(`Bearer ${MOCK_ACCESS_TOKEN}`);
  });

  it('does NOT send the ID Token in the bootstrap request', async () => {
    _sessionStore['dp_id_token'] = 'id-token-value';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, customer: {} }),
    });

    await cognitoAuth.callBootstrap(MOCK_ACCESS_TOKEN);

    const [, options] = global.fetch.mock.calls[0];
    const authHeader = options.headers['Authorization'];
    expect(authHeader).toBe(`Bearer ${MOCK_ACCESS_TOKEN}`);
    expect(authHeader).not.toContain('id-token-value');
  });

  it('returns success:true on 200/201 response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, customer: { customerId: 'abc' } }),
    });

    const result = await cognitoAuth.callBootstrap(MOCK_ACCESS_TOKEN);
    expect(result.success).toBe(true);
    expect(result.customer).toBeDefined();
  });

  it('returns EMAIL_UNVERIFIED on 403 EMAIL_UNVERIFIED response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({ code: 'EMAIL_UNVERIFIED', error: 'Email not verified' }),
    });

    const result = await cognitoAuth.callBootstrap(MOCK_ACCESS_TOKEN);
    expect(result.success).toBe(false);
    expect(result.code).toBe('EMAIL_UNVERIFIED');
  });

  it('returns ACCOUNT_EMAIL_CONFLICT on 409 conflict response', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ code: 'ACCOUNT_EMAIL_CONFLICT', error: 'Conflict' }),
    });

    const result = await cognitoAuth.callBootstrap(MOCK_ACCESS_TOKEN);
    expect(result.success).toBe(false);
    expect(result.code).toBe('ACCOUNT_EMAIL_CONFLICT');
  });

  it('does NOT retry on 409 (non-retryable conflict)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 409,
      json: () => Promise.resolve({ code: 'ACCOUNT_EMAIL_CONFLICT' }),
    });

    await cognitoAuth.callBootstrap(MOCK_ACCESS_TOKEN);

    // Should only call once — no retry on 409
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// 7. Transient Retry — exponential backoff on 5xx errors
// ---------------------------------------------------------------------------

describe('callBootstrap: exponential backoff retry on transient failures', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('retries on 500 and succeeds on second attempt', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ code: 'CUSTOMER_BOOTSTRAP_FAILED' }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, customer: { customerId: 'abc' } }),
      });
    });

    const resultPromise = cognitoAuth.callBootstrap('access-tok');
    // Advance timers to allow retry delay to pass
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('retries on network error and succeeds on second attempt', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.reject(new Error('Network error'));
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, customer: {} }),
      });
    });

    const resultPromise = cognitoAuth.callBootstrap('access-tok');
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(true);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('returns failure after all retries exhausted', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ code: 'CUSTOMER_BOOTSTRAP_FAILED' }),
    });

    const resultPromise = cognitoAuth.callBootstrap('access-tok', 3); // Start at max retries
    await jest.runAllTimersAsync();
    const result = await resultPromise;

    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Email Verified/Unverified handling
// ---------------------------------------------------------------------------

describe('callBootstrap: email verified/unverified handling', () => {
  it('succeeds when backend returns 201 (email verified path)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 201,
      json: () => Promise.resolve({
        success: true,
        customer: {
          customerId: 'sub123',
          email: 'user@example.com',
          emailVerified: true,
          accountStatus: 'pending_profile',
        },
      }),
    });

    const result = await cognitoAuth.callBootstrap('access-tok');
    expect(result.success).toBe(true);
    expect(result.customer.emailVerified).toBe(true);
  });

  it('returns EMAIL_UNVERIFIED when backend rejects unverified email', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: () => Promise.resolve({
        error: 'Email address must be verified.',
        code: 'EMAIL_UNVERIFIED',
      }),
    });

    const result = await cognitoAuth.callBootstrap('access-tok');
    expect(result.success).toBe(false);
    expect(result.code).toBe('EMAIL_UNVERIFIED');
  });
});

// ---------------------------------------------------------------------------
// 9. Blocked account statuses (from bootstrap response)
// ---------------------------------------------------------------------------

describe('callBootstrap: blocked account statuses', () => {
  const blockedStatuses = [
    { code: 'ACCOUNT_EMAIL_CONFLICT', status: 409 },
    { code: 'ACCOUNT_DISABLED', status: 403 },
    { code: 'DELETION_REQUESTED', status: 403 },
    { code: 'ACCOUNT_DELETED', status: 403 },
    { code: 'ACCOUNT_MERGED', status: 403 },
  ];

  blockedStatuses.forEach(({ code, status }) => {
    it(`returns failure for ${code} (${status}) without retrying`, async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status,
        json: () => Promise.resolve({ code, error: `Blocked: ${code}` }),
      });

      const result = await cognitoAuth.callBootstrap('access-tok');
      expect(result.success).toBe(false);
      expect(result.code).toBe(code);
      expect(result.authorizationDenied).toBe(true);
      // Non-retryable — only one call
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});

describe('initAuth: bootstrap authorization denial', () => {
  function makeIdToken() {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({
      sub: 'customer-sub',
      email: 'customer@example.com',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })).toString('base64url');
    return `${header}.${payload}.signature`;
  }

  ['EMAIL_UNVERIFIED', 'ACCOUNT_DISABLED', 'DELETION_REQUESTED', 'ACCOUNT_DELETED',
    'ACCOUNT_MERGED', 'ACCOUNT_EMAIL_CONFLICT'].forEach(code => {
    it(`clears all local auth state and does not show the dashboard for ${code}`, async () => {
      global.window.location.search = '?code=authorization-code&state=matching-state';
      _sessionStore.oauth_state = 'matching-state';
      _sessionStore.pkce_verifier = 'verifier';
      const loggedOut = { style: {} };
      const loggedIn = { style: {} };
      const logoutButton = { style: {} };
      global.document.getElementById.mockImplementation(id => ({
        loggedOutContent: loggedOut,
        loggedInContent: loggedIn,
        logoutBtn: logoutButton,
      })[id] || null);
      global.fetch = jest.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({
            access_token: 'access-token',
            id_token: makeIdToken(),
            refresh_token: 'refresh-token',
          }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: code === 'ACCOUNT_EMAIL_CONFLICT' ? 409 : 403,
          json: () => Promise.resolve({ code }),
        });

      await cognitoAuth.initAuth();

      expect(_sessionStore.dp_access_token).toBeUndefined();
      expect(_sessionStore.dp_id_token).toBeUndefined();
      expect(_sessionStore.dp_refresh_token).toBeUndefined();
      expect(loggedIn.style.display).toBe('none');
      expect(loggedOut.style.display).toBe('block');
    });
  });

  it('retains the Cognito session for an exhausted transient bootstrap failure', async () => {
    global.window.location.search = '?code=authorization-code&state=matching-state';
    _sessionStore.oauth_state = 'matching-state';
    _sessionStore.pkce_verifier = 'verifier';
    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          access_token: 'access-token', id_token: makeIdToken(), refresh_token: 'refresh-token',
        }),
      })
      .mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ code: 'CUSTOMER_BOOTSTRAP_FAILED' }),
      });
    jest.useFakeTimers();
    const initPromise = cognitoAuth.initAuth();
    await jest.runAllTimersAsync();
    await initPromise;
    jest.useRealTimers();

    expect(_sessionStore.dp_access_token).toBe('access-token');
    expect(_sessionStore.dp_refresh_token).toBe('refresh-token');
  });
});

// ---------------------------------------------------------------------------
// 10. exchangeCodeForTokens — PKCE verifier exchange
// ---------------------------------------------------------------------------

describe('exchangeCodeForTokens: PKCE verifier exchange', () => {
  beforeEach(() => {
    _sessionStore['pkce_verifier'] = 'test-verifier-value';
  });

  it('uses code_verifier from sessionStorage', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        access_token: 'new-access',
        id_token: 'new-id',
        refresh_token: 'new-refresh',
      }),
    });

    await cognitoAuth.exchangeCodeForTokens('auth-code-123');

    const [, options] = global.fetch.mock.calls[0];
    const body = new URLSearchParams(options.body);
    expect(body.get('code_verifier')).toBe('test-verifier-value');
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code-123');
  });

  it('removes pkce_verifier from sessionStorage after exchange', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        access_token: 'a', id_token: 'i', refresh_token: 'r',
      }),
    });

    await cognitoAuth.exchangeCodeForTokens('code');
    expect(_sessionStore['pkce_verifier']).toBeUndefined();
  });

  it('returns null when PKCE verifier is missing (replay/CSRF guard)', async () => {
    delete _sessionStore['pkce_verifier'];
    const result = await cognitoAuth.exchangeCodeForTokens('code');
    expect(result).toBeNull();
  });

  it('returns tokens object on success', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        access_token: 'access-tok',
        id_token: 'id-tok',
        refresh_token: 'refresh-tok',
      }),
    });

    const tokens = await cognitoAuth.exchangeCodeForTokens('code');
    expect(tokens).not.toBeNull();
    expect(tokens.accessToken).toBe('access-tok');
    expect(tokens.idToken).toBe('id-tok');
    expect(tokens.refreshToken).toBe('refresh-tok');
  });

  it('returns null on non-ok response (invalid_grant)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve({ error: 'invalid_grant' }),
    });

    const tokens = await cognitoAuth.exchangeCodeForTokens('bad-code');
    expect(tokens).toBeNull();
  });

  it('does NOT store tokens in localStorage', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        access_token: 'a', id_token: 'i', refresh_token: 'r',
      }),
    });

    await cognitoAuth.exchangeCodeForTokens('code');

    expect(_localStore['dp_access_token']).toBeUndefined();
    expect(_localStore['dp_id_token']).toBeUndefined();
    expect(_localStore['dp_refresh_token']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 11. No Dynamo Credential/Token Storage (via bootstrap request structure)
// ---------------------------------------------------------------------------

describe('Security: no tokens or credentials passed to the backend', () => {
  it('bootstrap POST body is empty (identity derives from JWT header only)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, customer: {} }),
    });

    await cognitoAuth.callBootstrap('access-token');

    const [, options] = global.fetch.mock.calls[0];
    // The body should be absent or empty — no identity claims in body
    const bodyStr = options.body || '';
    const bodyObj = bodyStr ? JSON.parse(bodyStr) : {};
    expect(Object.keys(bodyObj).length).toBe(0);
  });

  it('refresh token is NOT included in bootstrap request headers or body', async () => {
    _sessionStore['dp_refresh_token'] = 'my-secret-refresh-token';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, customer: {} }),
    });

    await cognitoAuth.callBootstrap('access-token');

    const [, options] = global.fetch.mock.calls[0];
    const allHeaderValues = JSON.stringify(options.headers);
    const bodyStr = options.body || '';

    expect(allHeaderValues).not.toContain('my-secret-refresh-token');
    expect(bodyStr).not.toContain('my-secret-refresh-token');
  });

  it('ID token is NOT sent in the bootstrap Authorization header', async () => {
    _sessionStore['dp_id_token'] = 'should-not-be-sent';
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ success: true, customer: {} }),
    });

    await cognitoAuth.callBootstrap('actual-access-token');

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers['Authorization']).toBe('Bearer actual-access-token');
    expect(options.headers['Authorization']).not.toContain('should-not-be-sent');
  });
});

// ---------------------------------------------------------------------------
// 12. getCurrentUser — ID Token decode (display only)
// ---------------------------------------------------------------------------

describe('getCurrentUser: ID Token decode for display', () => {
  function makeJwt(payload) {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.fake-sig`;
  }

  it('returns user object from valid non-expired ID Token', () => {
    const payload = {
      sub: 'user-sub-123',
      email: 'user@example.com',
      name: 'Test User',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    };
    _sessionStore['dp_id_token'] = makeJwt(payload);

    const user = cognitoAuth.getCurrentUser();
    expect(user).not.toBeNull();
    expect(user.email).toBe('user@example.com');
    expect(user.name).toBe('Test User');
    expect(user.sub).toBe('user-sub-123');
    expect(user.emailVerified).toBe(true);
  });

  it('returns null and clears state for expired ID Token', () => {
    const payload = {
      sub: 'user-sub',
      email: 'user@example.com',
      exp: Math.floor(Date.now() / 1000) - 100, // Expired
    };
    _sessionStore['dp_id_token'] = makeJwt(payload);
    _sessionStore['dp_access_token'] = 'some-access-tok';

    const user = cognitoAuth.getCurrentUser();
    expect(user).toBeNull();
    // Tokens should be cleared
    expect(_sessionStore['dp_access_token']).toBeUndefined();
  });

  it('returns null when no ID Token is stored', () => {
    delete _sessionStore['dp_id_token'];
    const user = cognitoAuth.getCurrentUser();
    expect(user).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 13. Safe Error Mapping
// ---------------------------------------------------------------------------

describe('mapOAuthError: safe error mapping', () => {
  it('never returns raw Cognito error strings', () => {
    const { mapOAuthError, AUTH_ERRORS } = cognitoAuth;
    const knownRawErrors = [
      'invalid_grant',
      'invalid_request',
      'NotAuthorizedException',
      'UserNotFoundException',
    ];
    knownRawErrors.forEach(rawErr => {
      const mapped = mapOAuthError(rawErr);
      // Must return a known AUTH_ERRORS code
      expect(Object.values(AUTH_ERRORS)).toContain(mapped);
      // Must NOT leak the raw Cognito error class names
      expect(mapped).not.toContain('Exception');
    });
  });

  it('AUTH_ERRORS object is defined with required codes', () => {
    const { AUTH_ERRORS } = cognitoAuth;
    expect(AUTH_ERRORS.INVALID_GRANT).toBeDefined();
    expect(AUTH_ERRORS.INVALID_REQUEST).toBeDefined();
    expect(AUTH_ERRORS.STATE_MISMATCH).toBeDefined();
    expect(AUTH_ERRORS.TOKEN_EXCHANGE_FAILED).toBeDefined();
    expect(AUTH_ERRORS.EMAIL_UNVERIFIED).toBeDefined();
    expect(AUTH_ERRORS.OAUTH_ERROR).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 14. Idempotency (bootstrap 200 on re-login)
// ---------------------------------------------------------------------------

describe('callBootstrap: idempotency', () => {
  it('returns success on 200 (existing record — idempotent re-login)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        success: true,
        customer: { customerId: 'abc', accountStatus: 'active' },
      }),
    });

    const result = await cognitoAuth.callBootstrap('access-tok');
    expect(result.success).toBe(true);
    expect(result.customer.accountStatus).toBe('active');
  });
});
