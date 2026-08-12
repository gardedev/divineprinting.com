'use strict';

/**
 * jwtAuth.js — Cognito Access-Token JWT Authentication Middleware
 *
 * Validates Cognito-issued RS256 access tokens and extracts trusted claims
 * into req.auth for downstream route handlers.
 *
 * Validation enforced:
 *   - Algorithm: RS256 only
 *   - kid: must be present in header; unknown kid triggers a one-time JWKS refresh
 *   - Issuer: must match configured COGNITO_ISSUER
 *   - client_id: must match configured COGNITO_CLIENT_ID
 *   - exp: must not be expired
 *   - nbf: must not be in the future (if present)
 *   - token_use: must be "access"
 *
 * On success, attaches req.auth:
 *   {
 *     sub:            string   — Cognito user UUID
 *     email:          string   — user's email (from token if present)
 *     emailVerified:  boolean  — email_verified claim
 *     groups:         string[] — cognito:groups claim
 *     scopes:         string[] — space-delimited scope claim split into array
 *   }
 *
 * Error responses:
 *   401 Unauthorized — missing / malformed / expired token
 *   403 Forbidden    — structurally valid token but fails claim assertion
 *
 * Configuration (environment variables):
 *   COGNITO_USER_POOL_ID — e.g. "us-east-1_hs1jWXB87"
 *   COGNITO_REGION        — e.g. "us-east-1" (defaults to "us-east-1")
 *   COGNITO_CLIENT_ID     — App client ID, e.g. "pf2ioscnn7vf7c4if5mjemos"
 *
 * Derived from the above:
 *   Issuer:   https://cognito-idp.{region}.amazonaws.com/{poolId}
 *   JWKS URI: https://cognito-idp.{region}.amazonaws.com/{poolId}/.well-known/jwks.json
 */

const jwt = require('jsonwebtoken');
const jwksClient = require('jwks-rsa');

// ---------------------------------------------------------------------------
// Configuration helpers
// ---------------------------------------------------------------------------

/**
 * Build configuration from environment variables.
 * Throws if required variables are absent.
 * Exported for testability.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{ issuer: string, clientId: string, jwksUri: string }}
 */
function buildConfig(env = process.env) {
  const poolId = env.COGNITO_USER_POOL_ID;
  const region = env.COGNITO_REGION || 'us-east-1';
  const clientId = env.COGNITO_CLIENT_ID;

  if (!poolId) throw new Error('COGNITO_USER_POOL_ID environment variable is required');
  if (!clientId) throw new Error('COGNITO_CLIENT_ID environment variable is required');

  const issuer = `https://cognito-idp.${region}.amazonaws.com/${poolId}`;
  const jwksUri = `${issuer}/.well-known/jwks.json`;

  return { issuer, clientId, jwksUri };
}

// ---------------------------------------------------------------------------
// JWKS client factory (exported so tests can override)
// ---------------------------------------------------------------------------

/**
 * Creates a jwks-rsa client with in-memory caching.
 * Cache TTL is 10 minutes; max cache size 5 keys.
 *
 * @param {string} jwksUri
 * @returns {import('jwks-rsa').JwksClient}
 */
function createJwksClient(jwksUri) {
  return jwksClient({
    jwksUri,
    cache: true,
    cacheMaxAge: 10 * 60 * 1000, // 10 minutes
    cacheMaxEntries: 5,
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  });
}

// ---------------------------------------------------------------------------
// Module-level singletons (lazily initialised)
// ---------------------------------------------------------------------------

let _config = null;
let _client = null;

/**
 * Returns (or creates) the singleton JWKS client and config.
 * Re-created if environment changes (test-friendly via reset).
 *
 * @returns {{ config: ReturnType<typeof buildConfig>, client: import('jwks-rsa').JwksClient }}
 */
function getSingletons() {
  if (!_config || !_client) {
    _config = buildConfig();
    _client = createJwksClient(_config.jwksUri);
  }
  return { config: _config, client: _client };
}

/**
 * Reset singletons (for testing only).
 */
function _resetSingletons() {
  _config = null;
  _client = null;
}

// ---------------------------------------------------------------------------
// JWKS key retrieval
// ---------------------------------------------------------------------------

/**
 * Retrieves the public key for the given kid from the JWKS endpoint.
 * jwks-rsa handles caching; unknown kids result in a fresh JWKS fetch.
 *
 * @param {import('jwks-rsa').JwksClient} client
 * @param {string} kid
 * @returns {Promise<string>} PEM-encoded public key
 */
async function getSigningKey(client, kid) {
  const key = await client.getSigningKey(kid);
  return key.getPublicKey();
}

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

/**
 * Extracts the Bearer token from the Authorization header.
 * Returns null if the header is absent or malformed.
 *
 * @param {import('express').Request} req
 * @returns {string|null}
 */
function extractBearerToken(req) {
  const authHeader = req.headers && req.headers['authorization'];
  if (!authHeader || typeof authHeader !== 'string') return null;

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') return null;

  const token = parts[1];
  if (!token || token.trim() === '') return null;

  return token;
}

// ---------------------------------------------------------------------------
// Claim validation
// ---------------------------------------------------------------------------

/**
 * Validates the decoded JWT claims against Cognito requirements.
 * Throws a structured error if any claim is invalid.
 *
 * Note: issuer (iss) validation is handled authoritatively by jwt.verify() via
 * the `issuer` option — it throws JsonWebTokenError (→ INVALID_SIGNATURE) if
 * the issuer does not match. The redundant iss check has been removed here to
 * keep a single authoritative validation point.
 *
 * @param {object} payload — Verified JWT payload from jwt.verify()
 * @param {string} _expectedIssuer — unused; issuer is validated by jwt.verify()
 * @param {string} expectedClientId
 * @throws {{ status: number, code: string, message: string }}
 */
function validateClaims(payload, _expectedIssuer, expectedClientId) {
  const now = Math.floor(Date.now() / 1000);

  // token_use must be "access"
  if (payload.token_use !== 'access') {
    throw {
      status: 403,
      code: 'INVALID_TOKEN_USE',
      message: 'Token must be an access token (token_use: access).',
    };
  }

  // client_id
  if (payload.client_id !== expectedClientId) {
    throw {
      status: 403,
      code: 'INVALID_CLIENT_ID',
      message: 'Token client_id does not match the configured app client.',
    };
  }

  // exp — token must not be expired (jwt.verify already checks this, but we
  // also check here for explicit claim validation logic transparency)
  if (!payload.exp || payload.exp <= now) {
    throw {
      status: 401,
      code: 'TOKEN_EXPIRED',
      message: 'Token has expired.',
    };
  }

  // nbf — not before
  if (payload.nbf !== undefined && payload.nbf > now) {
    throw {
      status: 401,
      code: 'TOKEN_NOT_YET_VALID',
      message: 'Token is not yet valid (nbf claim).',
    };
  }
}

// ---------------------------------------------------------------------------
// Claim extraction
// ---------------------------------------------------------------------------

/**
 * Extracts trusted claims from the verified payload into a normalized context.
 *
 * @param {object} payload — Verified decoded JWT payload
 * @returns {{ sub: string, email: string|undefined, emailVerified: boolean, groups: string[], scopes: string[] }}
 */
function extractClaims(payload) {
  return {
    sub: payload.sub,
    email: payload.email || undefined,
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    groups: Array.isArray(payload['cognito:groups']) ? payload['cognito:groups'] : [],
    scopes: typeof payload.scope === 'string' && payload.scope.trim()
      ? payload.scope.trim().split(/\s+/)
      : [],
  };
}

// ---------------------------------------------------------------------------
// Error response helpers
// ---------------------------------------------------------------------------

/**
 * Sends a standardized authentication error response.
 * Never leaks internal error details in the response body.
 *
 * @param {import('express').Response} res
 * @param {number} status - HTTP status code (401 or 403)
 * @param {string} code   - Machine-readable error code
 * @param {string} message - Human-readable error message
 */
function sendAuthError(res, status, code, message) {
  return res.status(status).json({ error: message, code });
}

// ---------------------------------------------------------------------------
// Core middleware factory (exported for testability)
// ---------------------------------------------------------------------------

/**
 * Creates the JWT authentication middleware with injected dependencies.
 * This factory form enables unit tests to inject mock JWKS clients and configs.
 *
 * @param {{
 *   config: { issuer: string, clientId: string, jwksUri: string },
 *   client: import('jwks-rsa').JwksClient
 * }} deps
 * @returns {import('express').RequestHandler}
 */
function createJwtAuthMiddleware(deps) {
  const { config, client } = deps;

  return async function jwtAuthMiddleware(req, res, next) {
    // 1. Extract token
    const token = extractBearerToken(req);
    if (!token) {
      return sendAuthError(res, 401, 'MISSING_TOKEN',
        'Authorization header with Bearer token is required.');
    }

    // 2. Decode header to get kid (without verifying signature yet)
    let decoded;
    try {
      decoded = jwt.decode(token, { complete: true });
    } catch (_err) {
      return sendAuthError(res, 401, 'MALFORMED_TOKEN', 'Token is malformed.');
    }

    if (!decoded || !decoded.header) {
      return sendAuthError(res, 401, 'MALFORMED_TOKEN', 'Token is malformed.');
    }

    const { header, payload } = decoded;

    // 3. Validate algorithm (RS256 only)
    if (header.alg !== 'RS256') {
      return sendAuthError(res, 401, 'INVALID_ALGORITHM',
        'Token must use RS256 algorithm.');
    }

    // 4. Validate kid is present
    const { kid } = header;
    if (!kid) {
      return sendAuthError(res, 401, 'MISSING_KID',
        'Token header is missing the kid (Key ID) field.');
    }

    // 5. Fetch signing key (jwks-rsa handles cache; unknown kid triggers refresh)
    let signingKey;
    try {
      signingKey = await getSigningKey(client, kid);
    } catch (err) {
      // Differentiate between "key not found" and network errors
      const isKeyNotFound = err && (
        err.name === 'SigningKeyNotFoundError' ||
        (err.message && err.message.includes('Unable to find a signing key'))
      );
      if (isKeyNotFound) {
        return sendAuthError(res, 401, 'INVALID_KID',
          'Token key ID not recognized. The token may have been issued by a different key.');
      }
      // Network/configuration errors — avoid leaking details
      return sendAuthError(res, 401, 'JWKS_FETCH_FAILED',
        'Unable to verify token at this time. Please try again.');
    }

    // 6. Verify JWT signature, exp, and standard claims
    let verifiedPayload;
    try {
      verifiedPayload = jwt.verify(token, signingKey, {
        algorithms: ['RS256'],
        issuer: config.issuer,
        // Note: jwt.verify does not validate client_id or token_use natively;
        // we validate those explicitly in validateClaims below.
      });
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return sendAuthError(res, 401, 'TOKEN_EXPIRED', 'Token has expired.');
      }
      if (err.name === 'NotBeforeError') {
        return sendAuthError(res, 401, 'TOKEN_NOT_YET_VALID', 'Token is not yet valid.');
      }
      if (err.name === 'JsonWebTokenError') {
        return sendAuthError(res, 401, 'INVALID_SIGNATURE',
          'Token signature is invalid.');
      }
      return sendAuthError(res, 401, 'TOKEN_VERIFICATION_FAILED',
        'Token verification failed.');
    }

    // 7. Validate Cognito-specific claims
    try {
      validateClaims(verifiedPayload, config.issuer, config.clientId);
    } catch (claimErr) {
      if (claimErr && claimErr.status && claimErr.code) {
        return sendAuthError(res, claimErr.status, claimErr.code, claimErr.message);
      }
      return sendAuthError(res, 403, 'CLAIM_VALIDATION_FAILED',
        'Token claims are invalid.');
    }

    // 8. Extract and attach normalized claims
    req.auth = extractClaims(verifiedPayload);

    // 9. Pass control to next handler
    return next();
  };
}

// ---------------------------------------------------------------------------
// Production middleware (singleton-based)
// ---------------------------------------------------------------------------

/**
 * Production-ready JWT auth middleware.
 * Lazily initialises the JWKS client from environment variables on first call.
 *
 * Usage:
 *   app.use('/api/protected', jwtAuth, yourRouteHandler);
 *
 * @type {import('express').RequestHandler}
 */
async function jwtAuth(req, res, next) {
  const { config, client } = getSingletons();
  return createJwtAuthMiddleware({ config, client })(req, res, next);
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  // Production middleware
  jwtAuth,

  // Internals exposed for unit testing
  createJwtAuthMiddleware,
  buildConfig,
  createJwksClient,
  extractBearerToken,
  validateClaims,
  extractClaims,
  getSigningKey,
  _resetSingletons,
};
