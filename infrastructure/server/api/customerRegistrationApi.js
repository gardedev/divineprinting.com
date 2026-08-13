'use strict';

/**
 * customerRegistrationApi.js — Customer Bootstrap API Route
 *
 * POST /api/customers/bootstrap
 *
 * Protected by the jwtAuth middleware (Task 4.2).
 * Creates or idempotently updates a customer record in CustomersTableV2
 * after a user has authenticated via Cognito.
 *
 * Security invariants enforced here (defense-in-depth; service layer also enforces):
 *   - Route is always protected by the injected jwtAuth middleware.
 *   - req.body claims (customerId, email, cognitoSub, etc.) are IGNORED entirely.
 *   - Only req.auth (populated by jwtAuth from the verified JWT) is trusted.
 *   - Errors are safe: no AWS internals, stack traces, or sensitive IDs.
 *
 * @module customerRegistrationApi
 */

const { Router } = require('express');
const { bootstrapCustomer, DomainErrors } = require('../services/customerService');
const { requireGroup } = require('../middleware/authorization');

// ---------------------------------------------------------------------------
// Error code → HTTP status mapping
// ---------------------------------------------------------------------------

const DOMAIN_ERROR_STATUS = {
  [DomainErrors.MISSING_CLAIMS]: 400,
  [DomainErrors.EMAIL_UNVERIFIED]: 403,
  [DomainErrors.ACCOUNT_EMAIL_CONFLICT]: 409,
  [DomainErrors.ACCOUNT_DISABLED]: 403,
  [DomainErrors.DELETION_REQUESTED]: 403,
  [DomainErrors.ACCOUNT_DELETED]: 403,
  [DomainErrors.ACCOUNT_MERGED]: 403,
  [DomainErrors.CONCURRENT_MODIFICATION]: 409,
  [DomainErrors.CUSTOMER_BOOTSTRAP_FAILED]: 500,
};

// ---------------------------------------------------------------------------
// Safe error response helper
// ---------------------------------------------------------------------------

/**
 * Sends a safe, standardized error response.
 * NEVER includes stack traces, AWS internals, or raw error messages.
 *
 * @param {import('express').Response} res
 * @param {number} status  - HTTP status code
 * @param {string} code    - Machine-readable error code
 * @param {string} message - Safe, user-facing message
 */
function sendSafeError(res, status, code, message) {
  return res.status(status).json({ error: message, code });
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------

/**
 * Creates the customer registration/bootstrap router.
 *
 * @param {import('express').RequestHandler} jwtAuthMiddleware - The JWT auth middleware (injected).
 * @param {object} [_customerService] - Optional customerService override for testing.
 * @returns {import('express').Router}
 */
function createCustomerRegistrationRouter(jwtAuthMiddleware, _customerService) {
  const router = Router();
  const service = _customerService || { bootstrapCustomer };
  const requireCustomer = requireGroup('customer');

  // -------------------------------------------------------------------------
  // POST /api/customers/bootstrap
  //
  // Creates or idempotently updates a customer record after Cognito auth.
  // Request body is intentionally ignored for all identity claims.
  // All identity derives from req.auth (set by jwtAuth middleware from the JWT).
  // -------------------------------------------------------------------------
  router.post(
    '/bootstrap',
    jwtAuthMiddleware,
    requireCustomer,
    async (req, res) => {
      try {
        // Pass ONLY req.auth (trusted JWT claims) to the service.
        // The service will reject any body-sourced identity.
        const { customer, created } = await service.bootstrapCustomer(req.auth);

        const status = created ? 201 : 200;
        return res.status(status).json({
          success: true,
          customer: sanitizeCustomerResponse(customer),
        });
      } catch (err) {
        // Handle domain errors (expected failure paths)
        if (err && err.isDomainError && err.code) {
          const status = DOMAIN_ERROR_STATUS[err.code] || 500;
          return sendSafeError(res, status, err.code, err.message);
        }

        // Unexpected error — log internally but return a safe response.
        // Do NOT include err.message or stack trace in the response.
        console.error('[customerRegistrationApi] Unexpected error during bootstrap:', {
          code: err && err.code,
          name: err && err.name,
          // Stack only in non-production for debugging; never sent to client.
          ...(process.env.NODE_ENV !== 'production' && { stack: err && err.stack }),
        });

        return sendSafeError(
          res,
          500,
          DomainErrors.CUSTOMER_BOOTSTRAP_FAILED,
          'An unexpected error occurred. Please try again.'
        );
      }
    }
  );

  return router;
}

// ---------------------------------------------------------------------------
// Response sanitization
// ---------------------------------------------------------------------------

/**
 * Strips any internal/sensitive fields from the customer object before
 * including it in the HTTP response.
 *
 * Safe fields to expose: customerId, emailDisplay, accountStatus, createdAt, updatedAt.
 * NEVER expose: cognitoSub (redundant with customerId), emailNormalized (internal),
 *               version (internal), lastSyncedFromCognitoAt (internal).
 *
 * @param {object} customer - The raw customer record from DynamoDB.
 * @returns {object} A sanitized customer object safe to include in API responses.
 */
function sanitizeCustomerResponse(customer) {
  if (!customer) return null;
  return {
    customerId: customer.customerId,
    email: customer.emailDisplay,
    emailVerified: customer.emailVerified,
    accountStatus: customer.accountStatus,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

module.exports = {
  createCustomerRegistrationRouter,
  // Exported for testing
  sanitizeCustomerResponse,
};
