/**
 * cognito-auth.js — Divine Printing Cognito Authentication (Task 4.4)
 *
 * Canonical login flow: Hosted UI + PKCE (Authorization Code + PKCE).
 *
 * Token storage strategy (security-first):
 *   - Access Token  : sessionStorage only. Never localStorage. Sent as
 *                     Authorization: Bearer <token> for all protected API calls.
 *   - ID Token      : sessionStorage only. Used ONLY for displaying user
 *                     identity on the frontend. MUST NOT be sent to the backend.
 *   - Refresh Token : sessionStorage only (ephemeral — cleared on tab/window close).
 *                     Frontend-to-Cognito only. NEVER sent to the backend.
 *                     NEVER stored in localStorage.
 *
 * Post-login bootstrap: Immediately after a verified login the frontend calls
 * POST /api/customers/bootstrap (Task 4.3) with the Access Token to ensure the
 * customer profile is created/synced in CustomersTableV2.
 */

'use strict';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const COGNITO_DOMAIN = 'https://divine-printing-auth.auth.us-east-1.amazoncognito.com';
const USER_POOL_ID = 'us-east-1_hs1jWXB87';
const CLIENT_ID = 'pf2ioscnn7vf7c4if5mjemos';

const API_BASE = 'https://cad1wdj8c8.execute-api.us-east-1.amazonaws.com';
const BOOTSTRAP_PATH = '/api/customers/bootstrap';

// Bootstrap retry configuration
const BOOTSTRAP_MAX_RETRIES = 3;
const BOOTSTRAP_RETRY_BASE_MS = 500; // Base delay for exponential backoff
const ACCESS_TOKEN_REFRESH_SKEW_SECONDS = 60;

/**
 * Returns the correct OAuth redirect URI based on the current hostname.
 * Must exactly match one of the registered callback URLs in the Cognito App Client.
 */
function getRedirectUri() {
  const hostname = window.location.hostname;
  const isAdmin = window.location.pathname.startsWith('/admin/');
  const path = isAdmin ? '/admin/index.html' : '/account/account.html';
  if (hostname === 'www.divineprinting.com') {
    return `https://www.divineprinting.com${path}`;
  }
  if (hostname === 'divineprinting.com') {
    return `https://divineprinting.com${path}`;
  }
  // Fallback: localhost / development
  return window.location.origin + path;
}

const REDIRECT_URI = getRedirectUri();

function getLogoutUri() {
  const path = window.location.pathname.startsWith('/admin/')
    ? '/admin/login.html'
    : '/account/account.html';
  return window.location.origin + path;
}

// ---------------------------------------------------------------------------
// In-memory token store (cleared on page unload / tab close)
// ---------------------------------------------------------------------------

/**
 * In-memory store for the access token and ID token within the current
 * JavaScript execution context. These are also mirrored to sessionStorage
 * so that same-tab page navigations survive (e.g., redirect back from
 * Cognito Hosted UI).
 *
 * The refresh token is handled separately (sessionStorage only, never localStorage,
 * never sent to the backend).
 */
const _tokenStore = {
  accessToken: null,
  idToken: null,
};

// All callers in this tab share one Cognito refresh operation. This prevents
// parallel API calls from creating a refresh storm.
let _refreshPromise = null;
let _lastRefreshFailureCode = null;

// ---------------------------------------------------------------------------
// PKCE helpers
// ---------------------------------------------------------------------------

/**
 * Generates a cryptographically random code verifier (43-128 chars, URL-safe).
 * @returns {string}
 */
function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

/**
 * Derives the S256 code challenge from a code verifier.
 * @param {string} verifier
 * @returns {Promise<string>}
 */
async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
}

// ---------------------------------------------------------------------------
// Token storage helpers
// ---------------------------------------------------------------------------

/**
 * Persists the access and ID tokens to both in-memory store and sessionStorage.
 * sessionStorage survives same-tab navigation but is cleared on tab/window close.
 *
 * @param {string} accessToken
 * @param {string} idToken
 */
function storeSessionTokens(accessToken, idToken) {
  _tokenStore.accessToken = accessToken;
  _tokenStore.idToken = idToken;
  try {
    sessionStorage.setItem('dp_access_token', accessToken);
    sessionStorage.setItem('dp_id_token', idToken);
  } catch (_e) {
    // sessionStorage may be unavailable in certain iframe contexts; in-memory
    // fallback is already set above.
  }
}

/**
 * Stores the refresh token in sessionStorage only.
 *
 * The refresh token is frontend-to-Cognito only and MUST NEVER be sent to
 * the backend, stored in localStorage, or persisted beyond the current
 * browsing session. sessionStorage is cleared on tab/window close, which
 * provides the correct ephemeral scope.
 *
 * @param {string} refreshToken
 */
function storeRefreshToken(refreshToken) {
  if (!refreshToken) return;
  // sessionStorage only — never localStorage, never sent to backend.
  try {
    sessionStorage.setItem('dp_refresh_token', refreshToken);
  } catch (_e) {
    // sessionStorage unavailable (e.g. private-browsing restriction) — discard.
  }
}

function getRefreshToken() {
  try {
    return sessionStorage.getItem('dp_refresh_token');
  } catch (_e) {
    return null;
  }
}

function clearSessionTokens({ preserveRefreshToken = false } = {}) {
  _tokenStore.accessToken = null;
  _tokenStore.idToken = null;
  try {
    sessionStorage.removeItem('dp_access_token');
    sessionStorage.removeItem('dp_id_token');
    if (!preserveRefreshToken) sessionStorage.removeItem('dp_refresh_token');
  } catch (_e) {
    // Storage unavailable.
  }
}

/**
 * Retrieves the current access token from in-memory store or sessionStorage.
 * Falls back to sessionStorage after a page navigation (e.g., Cognito redirect).
 *
 * @returns {string|null}
 */
function getAccessToken() {
  if (_tokenStore.accessToken) return _tokenStore.accessToken;
  try {
    const token = sessionStorage.getItem('dp_access_token');
    if (token) {
      _tokenStore.accessToken = token; // Re-hydrate in-memory store
      return token;
    }
  } catch (_e) {
    // sessionStorage unavailable
  }
  return null;
}

/**
 * Retrieves the current ID token from in-memory store or sessionStorage.
 * ID Token is ONLY for frontend identity display — never for backend API auth.
 *
 * @returns {string|null}
 */
function getIdToken() {
  if (_tokenStore.idToken) return _tokenStore.idToken;
  try {
    const token = sessionStorage.getItem('dp_id_token');
    if (token) {
      _tokenStore.idToken = token; // Re-hydrate in-memory store
      return token;
    }
  } catch (_e) {
    // sessionStorage unavailable
  }
  return null;
}

/**
 * Clears all auth state from in-memory store and sessionStorage.
 */
function clearAllAuthState() {
  clearSessionTokens();
  try {
    sessionStorage.removeItem('pkce_verifier');
    sessionStorage.removeItem('oauth_state');
  } catch (_e) {
    // sessionStorage unavailable
  }
  // Explicitly ensure no legacy localStorage tokens remain
  try {
    localStorage.removeItem('dp_access_token');
    localStorage.removeItem('dp_id_token');
    localStorage.removeItem('dp_refresh_token');
    localStorage.removeItem('dp_token');
    localStorage.removeItem('dp_customer');
    localStorage.removeItem('dp_session_token');
  } catch (_e) {
    // localStorage unavailable
  }
}

// ---------------------------------------------------------------------------
// Token exchange (PKCE Authorization Code flow)
// ---------------------------------------------------------------------------

/**
 * Safe error codes for OAuth/Cognito failures. Never expose raw Cognito errors.
 */
const AUTH_ERRORS = {
  INVALID_GRANT: 'INVALID_GRANT',             // Bad authorization code
  INVALID_REQUEST: 'INVALID_REQUEST',          // State mismatch / malformed request
  STATE_MISMATCH: 'STATE_MISMATCH',            // CSRF / state parameter mismatch
  TOKEN_EXCHANGE_FAILED: 'TOKEN_EXCHANGE_FAILED',
  EMAIL_UNVERIFIED: 'EMAIL_UNVERIFIED',
  MFA_REQUIRED: 'MFA_REQUIRED',
  CONFIRMATION_REQUIRED: 'CONFIRMATION_REQUIRED',
  OAUTH_ERROR: 'OAUTH_ERROR',                  // Generic mapped OAuth error from Cognito
  REFRESH_FAILED: 'REFRESH_FAILED',
  REFRESH_NETWORK_ERROR: 'REFRESH_NETWORK_ERROR',
};

const BOOTSTRAP_AUTHORIZATION_DENIALS = new Set([
  'EMAIL_UNVERIFIED',
  'ACCOUNT_DISABLED',
  'DELETION_REQUESTED',
  'ACCOUNT_DELETION_REQUESTED',
  'DELETED',
  'ACCOUNT_DELETED',
  'MERGED',
  'ACCOUNT_MERGED',
  'ACCOUNT_EMAIL_CONFLICT',
]);

/**
 * Maps a raw Cognito/OAuth error code to a safe AUTH_ERRORS code.
 * NEVER returns raw Cognito error details to the UI.
 *
 * @param {string} rawError
 * @returns {string}
 */
function mapOAuthError(rawError) {
  if (!rawError) return AUTH_ERRORS.OAUTH_ERROR;
  const e = rawError.toLowerCase();
  if (e.includes('invalid_grant')) return AUTH_ERRORS.INVALID_GRANT;
  if (e.includes('invalid_request')) return AUTH_ERRORS.INVALID_REQUEST;
  if (e.includes('mfa')) return AUTH_ERRORS.MFA_REQUIRED;
  if (e.includes('notauthorized') || e.includes('not_authorized')) return AUTH_ERRORS.INVALID_GRANT;
  return AUTH_ERRORS.OAUTH_ERROR;
}

const OAUTH_CALLBACK_PARAMETERS = [
  'code',
  'state',
  'error',
  'error_description',
  'error_uri',
  'session_state',
  'iss',
];

/**
 * Removes OAuth-only callback parameters from the visible URL without
 * navigating or exposing them to another origin. Non-OAuth query parameters
 * and the URL fragment are preserved.
 */
function scrubOAuthCallbackUrl() {
  try {
    const currentPath = `${window.location.pathname || '/'}${window.location.search || ''}${window.location.hash || ''}`;
    const url = new URL(currentPath, window.location.origin);
    let changed = false;
    for (const parameter of OAUTH_CALLBACK_PARAMETERS) {
      if (url.searchParams.has(parameter)) {
        url.searchParams.delete(parameter);
        changed = true;
      }
    }
    if (!changed) return;
    const query = url.searchParams.toString();
    const cleanUrl = `${url.pathname}${query ? `?${query}` : ''}${url.hash}`;
    window.history.replaceState({}, document.title, cleanUrl);
  } catch (_e) {
    // URL/history APIs may be unavailable in constrained test environments.
  }
}

/**
 * Exchanges a Cognito authorization code for Access, ID, and Refresh tokens.
 * PKCE code_verifier is retrieved from sessionStorage and removed after use.
 *
 * Returns { accessToken, idToken, refreshToken } on success, or null on failure.
 *
 * @param {string} code - The authorization_code from the Cognito Hosted UI redirect.
 * @returns {Promise<{accessToken: string, idToken: string, refreshToken: string}|null>}
 */
async function exchangeCodeForTokens(code) {
  // Defense in depth: direct callers must not leave callback credentials in
  // browser history, including when the verifier is missing or exchange fails.
  scrubOAuthCallbackUrl();

  const verifier = sessionStorage.getItem('pkce_verifier');
  sessionStorage.removeItem('pkce_verifier');

  if (!verifier) {
    console.error('[cognito-auth] PKCE verifier missing — possible CSRF or duplicate callback');
    return null;
  }

  const tokenUrl = `${COGNITO_DOMAIN}/oauth2/token`;
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code: code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier,
  });

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
    });

    if (!response.ok) {
      let errorBody = {};
      try { errorBody = await response.json(); } catch (_e) { /* ignore */ }
      const mappedError = mapOAuthError(errorBody.error || '');
      console.error('[cognito-auth] Token exchange failed:', mappedError);
      return null;
    }

    const tokens = await response.json();

    if (!tokens.access_token || !tokens.id_token) {
      console.error('[cognito-auth] Token exchange returned incomplete token set');
      return null;
    }

    return {
      accessToken: tokens.access_token,
      idToken: tokens.id_token,
      refreshToken: tokens.refresh_token || null,
    };
  } catch (error) {
    // Do not log raw error (may contain sensitive details)
    console.error('[cognito-auth] Token exchange network error');
    return null;
  }
}

// ---------------------------------------------------------------------------
// URL / state parsing
// ---------------------------------------------------------------------------

/**
 * Parses the OAuth callback parameters from the current URL.
 * Validates the state parameter (CSRF protection).
 * Cleans the URL query string after parsing.
 *
 * Returns the authorization code on success, or null if:
 *   - An OAuth error is present in the URL
 *   - The state parameter does not match what was stored
 *   - No code is present
 *
 * @returns {string|null}
 */
function parseCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');
  const errorDescription = params.get('error_description');
  const hasOAuthCallbackParameters = OAUTH_CALLBACK_PARAMETERS.some(parameter =>
    params.has(parameter)
  );

  // Scrub callback credentials before any validation, logging, event dispatch,
  // token exchange, or final error rendering.
  if (hasOAuthCallbackParameters) scrubOAuthCallbackUrl();

  // Check for OAuth errors from Cognito
  if (error) {
    clearAllAuthState();
    const mappedError = mapOAuthError(error);
    console.error('[cognito-auth] OAuth error in callback:', mappedError);
    _dispatchAuthEvent('auth:error', { code: mappedError });
    return null;
  }

  if (!code) {
    if (hasOAuthCallbackParameters) {
      try {
        sessionStorage.removeItem('pkce_verifier');
        sessionStorage.removeItem('oauth_state');
      } catch (_e) {
        // sessionStorage unavailable
      }
      _dispatchAuthEvent('auth:error', { code: AUTH_ERRORS.INVALID_REQUEST });
    }
    return null;
  }

  // Validate state parameter (CSRF protection — required when state was stored)
  const savedState = sessionStorage.getItem('oauth_state');
  sessionStorage.removeItem('oauth_state');

  // State is mandatory for every callback initiated by this application.
  if (!state || !savedState || state !== savedState) {
    clearAllAuthState();
    console.error('[cognito-auth] OAuth state validation failed');
    _dispatchAuthEvent('auth:error', { code: AUTH_ERRORS.STATE_MISMATCH });
    return null;
  }

  return code;
}

// ---------------------------------------------------------------------------
// JWT decode (client-side only, for display purposes)
// ---------------------------------------------------------------------------

/**
 * Decodes a JWT payload without verifying the signature.
 * Used ONLY for extracting user display info from the ID Token on the frontend.
 * The backend MUST verify tokens independently via jwks-rsa.
 *
 * @param {string} token
 * @returns {object|null}
 */
function decodeJwtPayload(token) {
  try {
    const base64Url = token.split('.')[1];
    if (!base64Url) return null;
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch (_e) {
    return null;
  }
}

function isTokenExpired(token, skewSeconds = ACCESS_TOKEN_REFRESH_SKEW_SECONDS) {
  const claims = decodeJwtPayload(token);
  if (!claims || typeof claims.exp !== 'number') return true;
  return claims.exp <= Math.floor(Date.now() / 1000) + skewSeconds;
}

/**
 * Refreshes browser tokens directly with Cognito. Refresh credentials never
 * cross the DivinePrinting API boundary. Concurrent callers share one promise.
 */
function refreshSession() {
  if (_refreshPromise) return _refreshPromise;

  _refreshPromise = (async () => {
    _lastRefreshFailureCode = null;
    const refreshToken = getRefreshToken();
    if (!refreshToken) {
      clearAllAuthState();
      _lastRefreshFailureCode = AUTH_ERRORS.REFRESH_FAILED;
      return { success: false, code: AUTH_ERRORS.REFRESH_FAILED };
    }

    const params = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: refreshToken,
    });

    try {
      const response = await fetch(`${COGNITO_DOMAIN}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });
      if (!response.ok) {
        // Cognito 4xx responses mean the refresh credential is no longer usable.
        if (response.status >= 400 && response.status < 500) clearAllAuthState();
        else clearSessionTokens({ preserveRefreshToken: true });
        const code = response.status >= 500
          ? AUTH_ERRORS.REFRESH_NETWORK_ERROR
          : AUTH_ERRORS.REFRESH_FAILED;
        _lastRefreshFailureCode = code;
        return {
          success: false,
          code,
        };
      }

      const tokens = await response.json();
      if (!tokens.access_token || !tokens.id_token) {
        clearAllAuthState();
        _lastRefreshFailureCode = AUTH_ERRORS.REFRESH_FAILED;
        return { success: false, code: AUTH_ERRORS.REFRESH_FAILED };
      }
      storeSessionTokens(tokens.access_token, tokens.id_token);
      if (tokens.refresh_token) storeRefreshToken(tokens.refresh_token);
      return {
        success: true,
        accessToken: tokens.access_token,
        idToken: tokens.id_token,
      };
    } catch (_error) {
      // Keep only the refresh credential so a later navigation/request can retry.
      clearSessionTokens({ preserveRefreshToken: true });
      _lastRefreshFailureCode = AUTH_ERRORS.REFRESH_NETWORK_ERROR;
      return { success: false, code: AUTH_ERRORS.REFRESH_NETWORK_ERROR };
    }
  })().finally(() => {
    _refreshPromise = null;
  });

  return _refreshPromise;
}

async function ensureFreshAccessToken() {
  const accessToken = getAccessToken();
  if (accessToken && !isTokenExpired(accessToken)) return accessToken;
  const result = await refreshSession();
  return result.success ? result.accessToken : null;
}

// ---------------------------------------------------------------------------
// Customer bootstrap (Task 4.3 integration)
// ---------------------------------------------------------------------------

/**
 * Calls POST /api/customers/bootstrap with the current Access Token.
 * This ensures the customer profile is created/synced in CustomersTableV2
 * after a verified Cognito login.
 *
 * Implements exponential backoff retry for transient failures.
 * The Access Token (not the ID Token) is sent as Authorization: Bearer.
 *
 * @param {string} accessToken - The Cognito Access Token.
 * @param {number} [attempt=0]  - Current retry attempt (internal).
 * @returns {Promise<{success: boolean, customer?: object, error?: string, code?: string}>}
 */
async function callBootstrap(accessToken, attempt = 0) {
  try {
    const response = await fetch(`${API_BASE}${BOOTSTRAP_PATH}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      // Body is intentionally empty — the backend derives identity from the JWT
    });

    if (response.ok) {
      const data = await response.json();
      return { success: true, customer: data.customer };
    }

    const errorData = await response.json().catch(() => ({}));
    const code = errorData.code || 'CUSTOMER_BOOTSTRAP_FAILED';

    // Non-retryable errors
    if (response.status === 401 || response.status === 403) {
      return { success: false, error: code, code, authorizationDenied: true };
    }
    if (response.status === 409) {
      return {
        success: false,
        error: code,
        code,
        authorizationDenied: BOOTSTRAP_AUTHORIZATION_DENIALS.has(String(code).toUpperCase()),
      };
    }

    // 5xx / transient errors: retry with exponential backoff
    if (response.status >= 500 && attempt < BOOTSTRAP_MAX_RETRIES) {
      const delay = BOOTSTRAP_RETRY_BASE_MS * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
      return callBootstrap(accessToken, attempt + 1);
    }

    return { success: false, error: code, code };
  } catch (networkError) {
    // Network error: retry
    if (attempt < BOOTSTRAP_MAX_RETRIES) {
      const delay = BOOTSTRAP_RETRY_BASE_MS * Math.pow(2, attempt);
      await new Promise(resolve => setTimeout(resolve, delay));
      return callBootstrap(accessToken, attempt + 1);
    }
    console.error('[cognito-auth] Bootstrap network error after retries');
    return { success: false, error: 'CUSTOMER_BOOTSTRAP_FAILED', code: 'CUSTOMER_BOOTSTRAP_FAILED' };
  }
}

// ---------------------------------------------------------------------------
// Current user (from ID Token — frontend display only)
// ---------------------------------------------------------------------------

/**
 * Returns the current user's display info from the ID Token.
 * Returns null if not authenticated or if the ID Token has expired.
 *
 * The ID Token is used ONLY for display purposes on the frontend.
 * The backend uses the Access Token for authorization.
 *
 * @returns {{email: string, name: string, sub: string, emailVerified: boolean}|null}
 */
function getCurrentUser() {
  const idToken = getIdToken();
  if (!idToken) return null;

  const decoded = decodeJwtPayload(idToken);
  if (!decoded) return null;

  // Expired display data is not a reason to destroy a still-refreshable session.
  if (decoded.exp && decoded.exp * 1000 < Date.now()) {
    return null;
  }

  return {
    email: decoded.email,
    name: decoded.name || decoded.email,
    sub: decoded.sub,
    emailVerified: decoded.email_verified === true || decoded.email_verified === 'true',
  };
}

// ---------------------------------------------------------------------------
// Protected API calls (using Access Token)
// ---------------------------------------------------------------------------

/**
 * Makes an authenticated fetch request to the backend API.
 * Sends the Access Token as Authorization: Bearer.
 * The ID Token is NEVER sent to the backend.
 *
 * @param {string} path     - API path (relative to API_BASE)
 * @param {object} [options] - Fetch options
 * @returns {Promise<Response>}
 */
async function authenticatedFetch(path, options = {}) {
  const accessToken = await ensureFreshAccessToken();
  if (!accessToken) {
    const error = new Error('Not authenticated');
    error.code = _lastRefreshFailureCode || AUTH_ERRORS.REFRESH_FAILED;
    throw error;
  }

  const performRequest = token => fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
      // Always send Access Token — NEVER the ID Token — for backend authorization
      'Authorization': `Bearer ${token}`,
    },
  });

  const response = await performRequest(accessToken);
  if (response.status !== 401) return response;

  // If another request already refreshed this tab, use its token. Otherwise
  // perform one shared refresh. The original API call is retried at most once.
  const currentToken = getAccessToken();
  let retryToken = currentToken && currentToken !== accessToken ? currentToken : null;
  if (!retryToken) {
    const refreshed = await refreshSession();
    retryToken = refreshed.success ? refreshed.accessToken : null;
  }
  if (!retryToken) return response;
  const retryResponse = await performRequest(retryToken);
  if (retryResponse.status === 401) clearAllAuthState();
  return retryResponse;
}

/**
 * Fetches orders from the API using the Access Token.
 * @returns {Promise<{orders: Array, count: number}>}
 */
async function fetchOrders() {
  try {
    const response = await authenticatedFetch('/orders');
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        clearAllAuthState();
      }
      return { orders: [], count: 0 };
    }
    return await response.json();
  } catch (_error) {
    return { orders: [], count: 0 };
  }
}

// ---------------------------------------------------------------------------
// Login / Signup (Hosted UI redirect)
// ---------------------------------------------------------------------------

/**
 * Redirects the user to the Cognito Hosted UI for login.
 * Generates PKCE code_verifier/challenge and stores them in sessionStorage.
 * Generates a state parameter for CSRF protection.
 */
async function login() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateCodeVerifier(); // Use same random function for state

  sessionStorage.setItem('pkce_verifier', verifier);
  sessionStorage.setItem('oauth_state', state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'email openid profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: state,
  });

  // Ensure scope uses %20 separators (required by some Cognito configurations)
  const urlString =
    `${COGNITO_DOMAIN}/login?` +
    params.toString().replace('scope=email+openid+profile', 'scope=email%20openid%20profile');

  window.location.href = urlString;
}

/**
 * Redirects the user to the Cognito Hosted UI for signup.
 */
async function signup() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateCodeVerifier();

  sessionStorage.setItem('pkce_verifier', verifier);
  sessionStorage.setItem('oauth_state', state);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'email openid profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state: state,
  });

  const urlString =
    `${COGNITO_DOMAIN}/signup?` +
    params.toString().replace('scope=email+openid+profile', 'scope=email%20openid%20profile');

  window.location.href = urlString;
}

// ---------------------------------------------------------------------------
// Logout (client-side only — backend remains stateless)
// ---------------------------------------------------------------------------

/**
 * Clears all local auth state and redirects to the Cognito logout endpoint.
 * The backend is stateless and holds no session; only browser state is cleared.
 */
function logout() {
  clearAllAuthState();
  const logoutUrl =
    `${COGNITO_DOMAIN}/logout?client_id=${CLIENT_ID}&logout_uri=${encodeURIComponent(getLogoutUri())}`;
  window.location.href = logoutUrl;
}

// ---------------------------------------------------------------------------
// Auth initialization
// ---------------------------------------------------------------------------

/**
 * Handles the Cognito Hosted UI callback and initializes auth state.
 *
 * Called on every page load. Performs:
 *   1. Check for OAuth callback in URL (authorization code)
 *   2. If code present: exchange for tokens, store securely, trigger bootstrap
 *   3. If already authenticated (sessionStorage): display dashboard
 *   4. Otherwise: display login prompt
 */
async function initAuth() {
  // Step 1: Check for OAuth callback (Cognito redirect back to our page)
  const code = parseCodeFromUrl();

  if (code) {
    // Step 2: Exchange authorization code for tokens
    const tokens = await exchangeCodeForTokens(code);

    if (!tokens) {
      showLoginPrompt();
      _dispatchAuthEvent('auth:error', { code: AUTH_ERRORS.TOKEN_EXCHANGE_FAILED });
      return;
    }

    // Store Access and ID tokens (sessionStorage + in-memory, never localStorage)
    storeSessionTokens(tokens.accessToken, tokens.idToken);

    // Store Refresh token (sessionStorage only — never localStorage, never backend)
    if (tokens.refreshToken) {
      storeRefreshToken(tokens.refreshToken);
    }

    // Decode ID Token for display info (never sent to backend)
    const user = getCurrentUser();

    if (!user) {
      clearAllAuthState();
      showLoginPrompt();
      return;
    }

    // Step 3: Automatic post-login bootstrap
    // Send Access Token (not ID Token) to POST /api/customers/bootstrap
    const bootstrapResult = await callBootstrap(tokens.accessToken);

    if (!bootstrapResult.success) {
      if (bootstrapResult.authorizationDenied) {
        clearAllAuthState();
        showLoginPrompt();
        const eventName = bootstrapResult.code === AUTH_ERRORS.EMAIL_UNVERIFIED
          ? 'auth:email-unverified'
          : 'auth:access-denied';
        _dispatchAuthEvent(eventName, { code: bootstrapResult.code });
        return;
      }
      // Non-fatal bootstrap errors: still show dashboard but dispatch event
      // (profile may already exist from a previous session — idempotent)
      _dispatchAuthEvent('auth:bootstrap-warning', { code: bootstrapResult.code });
    }

    showDashboard(user);
    _dispatchAuthEvent('auth:login-success', { user, bootstrapped: bootstrapResult.success });
    return;
  }

  // Step 4: Restore and revalidate a same-tab session. Customer bootstrap is
  // deliberately repeated so account/group/status changes cannot leave stale UI.
  const accessToken = await ensureFreshAccessToken();
  if (!accessToken) {
    showLoginPrompt();
    return;
  }

  let user = getCurrentUser();
  if (!user) {
    const refreshed = await refreshSession();
    if (!refreshed.success) {
      showLoginPrompt();
      return;
    }
    user = getCurrentUser();
  }
  if (!user) {
    clearAllAuthState();
    showLoginPrompt();
    return;
  }

  const bootstrapResult = await callBootstrap(getAccessToken());
  if (!bootstrapResult.success && bootstrapResult.authorizationDenied) {
    clearAllAuthState();
    showLoginPrompt();
    const eventName = bootstrapResult.code === AUTH_ERRORS.EMAIL_UNVERIFIED
      ? 'auth:email-unverified'
      : 'auth:access-denied';
    _dispatchAuthEvent(eventName, { code: bootstrapResult.code });
    return;
  }
  if (!bootstrapResult.success) {
    _dispatchAuthEvent('auth:bootstrap-warning', { code: bootstrapResult.code });
  }
  showDashboard(user);
  _dispatchAuthEvent('auth:session-restored', { user, bootstrapped: bootstrapResult.success });
}

// ---------------------------------------------------------------------------
// Internal event helpers
// ---------------------------------------------------------------------------

/**
 * Dispatches a custom window event for auth state changes.
 * Allows other page scripts to react to auth lifecycle events without
 * tight coupling to this module.
 *
 * @param {string} eventName
 * @param {object} detail
 */
function _dispatchAuthEvent(eventName, detail) {
  try {
    window.dispatchEvent(new CustomEvent(eventName, { detail }));
  } catch (_e) {
    // CustomEvent unavailable in some test environments
  }
}

// ---------------------------------------------------------------------------
// UI functions
// ---------------------------------------------------------------------------

function showDashboard(user) {
  const loggedOutContent = document.getElementById('loggedOutContent');
  const loggedInContent = document.getElementById('loggedInContent');
  const logoutBtn = document.getElementById('logoutBtn');

  if (loggedOutContent) loggedOutContent.style.display = 'none';
  if (loggedInContent) loggedInContent.style.display = 'block';
  if (logoutBtn) logoutBtn.style.display = '';

  // Display user name from ID Token (display only — never used for backend auth)
  const customerNameEl = document.getElementById('customerName');
  if (customerNameEl) customerNameEl.textContent = user.name || user.email;

  loadOrders();

  // Load saved designs count (local UI state)
  try {
    const savedDesigns = JSON.parse(localStorage.getItem('divinePrinting_savedDesigns') || '[]');
    const savedDesignsEl = document.getElementById('savedDesigns');
    if (savedDesignsEl) savedDesignsEl.textContent = savedDesigns.length;
  } catch (_e) {
    // localStorage unavailable
  }
}

function showLoginPrompt() {
  const loggedOutContent = document.getElementById('loggedOutContent');
  const loggedInContent = document.getElementById('loggedInContent');
  const logoutBtn = document.getElementById('logoutBtn');

  if (loggedOutContent) loggedOutContent.style.display = 'block';
  if (loggedInContent) loggedInContent.style.display = 'none';
  if (logoutBtn) logoutBtn.style.display = 'none';
}

async function loadOrders() {
  const ordersListEl = document.getElementById('recentOrdersList');
  if (!ordersListEl) return;

  ordersListEl.innerHTML = '<p>Loading orders...</p>';

  try {
    const data = await fetchOrders();
    if (data.orders && data.orders.length > 0) {
      ordersListEl.innerHTML = data.orders
        .map(
          order => `
        <div class="order-card">
          <div class="order-header">
            <span class="order-id">Order #${order.invoiceNumber || order.orderId.slice(0, 8)}</span>
            <span class="order-status ${order.status}">${order.status}</span>
          </div>
          <div class="order-date">${new Date(order.createdAt).toLocaleDateString()}</div>
          <div class="order-items">${order.items.length} item(s)</div>
          <div class="order-total">$${order.total.toFixed(2)}</div>
        </div>
      `
        )
        .join('');

      const totalOrdersEl = document.getElementById('totalOrders');
      const totalSpentEl = document.getElementById('totalSpent');
      if (totalOrdersEl) totalOrdersEl.textContent = data.count;
      if (totalSpentEl) {
        const total = data.orders.reduce((sum, o) => sum + o.total, 0);
        totalSpentEl.textContent = '$' + total.toFixed(2);
      }
    } else {
      ordersListEl.innerHTML = '<p>No orders yet.</p>';
    }
  } catch (_error) {
    ordersListEl.innerHTML = '<p>Error loading orders.</p>';
  }
}

// ---------------------------------------------------------------------------
// DOM initialization
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
  // Admin pages own their callback lifecycle and must never invoke customer
  // bootstrap. They reuse the primitives above through admin-auth.js.
  if (!window.location.pathname.startsWith('/admin/')) {
    initAuth();
  }

  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) loginBtn.addEventListener('click', () => login());

  const signupBtn = document.getElementById('signupBtn');
  if (signupBtn) signupBtn.addEventListener('click', () => signup());

  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
});

// A page restored from the browser back/forward cache can contain stale UI.
// Reload it so the appropriate customer/admin initializer revalidates tokens,
// groups, and backend authorization from current sessionStorage state.
window.addEventListener('pageshow', event => {
  if (event.persisted) window.location.reload();
});

// ---------------------------------------------------------------------------
// Exports (for testing and inter-module use)
// ---------------------------------------------------------------------------

// Allow test environments and other modules to import individual functions.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    // Core auth flow
    login,
    signup,
    logout,
    initAuth,
    // Token management
    getAccessToken,
    getIdToken,
    storeSessionTokens,
    storeRefreshToken,
    getRefreshToken,
    clearSessionTokens,
    clearAllAuthState,
    isTokenExpired,
    refreshSession,
    ensureFreshAccessToken,
    // PKCE
    generateCodeVerifier,
    generateCodeChallenge,
    exchangeCodeForTokens,
    parseCodeFromUrl,
    // User info
    getCurrentUser,
    decodeJwtPayload,
    // Bootstrap
    callBootstrap,
    // Protected API
    authenticatedFetch,
    fetchOrders,
    // Error codes (for testing assertions)
    AUTH_ERRORS,
    getRedirectUri,
    getLogoutUri,
    // Internals exposed for testing
    mapOAuthError,
  };
}
