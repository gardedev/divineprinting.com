'use strict';

/**
 * adminAuth.js — Admin authentication/authorisation middleware placeholder.
 *
 * STATUS: PLACEHOLDER — DENIES ALL REQUESTS BY DEFAULT.
 *
 * No working admin authentication architecture exists in this codebase yet.
 * This middleware is deliberately isolated here so it is easy to find and
 * replace once a real auth system is implemented (e.g. JWT verification
 * against a Cognito user pool with an 'admin' group claim).
 *
 * Until then, every request to any /api/admin/* route will receive:
 *   HTTP 503 Service Unavailable
 *   { "error": "Admin authentication is not yet configured." }
 *
 * BLOCKER: Replace this middleware with real token verification before
 * exposing the admin API to any public or production environment.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function adminAuth(req, res, next) {
  // -------------------------------------------------------------------------
  // PLACEHOLDER — replace with real JWT/Cognito admin verification
  // -------------------------------------------------------------------------
  return res.status(503).json({
    error: 'Admin authentication is not yet configured.',
    blocker: 'PLACEHOLDER_ADMIN_AUTH — implement token verification before enabling.',
  });

  // When real auth is in place the handler should:
  //   1. Extract the Authorization: Bearer <token> header
  //   2. Verify and decode the JWT
  //   3. Assert the decoded payload has an admin role/claim
  //   4. Attach req.adminUser = { id, email, role } for downstream handlers
  //   5. Call next() on success, or return 401/403 on failure
}

module.exports = { adminAuth };
