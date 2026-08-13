'use strict';

/**
 * customerService.js — Business logic for customer bootstrap/registration
 *
 * Core responsibility:
 *   Accept trusted claims from a verified Cognito JWT (via req.auth, populated
 *   by the jwtAuth middleware) and create or update a customer record in
 *   CustomersTableV2.
 *
 * Security invariants (enforced here, not by callers):
 *   1. NEVER trust client-supplied identity claims (customerId, email, etc.).
 *      All identity is derived exclusively from trustedAuth (req.auth).
 *   2. emailVerified MUST be true before any record is created or updated.
 *   3. customerId and cognitoSub are always set to trustedAuth.sub.
 *   4. No tokens, passwords, or credentials are ever stored.
 *   5. Duplicate email detection uses normalized email against EmailIndex.
 *   6. Optimistic locking via `version` ensures safe concurrent updates.
 *   7. DynamoDB failures never roll back Cognito. Partial writes are avoided
 *      by using PutItem with a condition (atomic create) or UpdateItem
 *      with conditional expression (atomic update). No multi-step writes.
 */

const customerRepository = require('../repositories/customerRepository');

// ---------------------------------------------------------------------------
// Domain errors
// ---------------------------------------------------------------------------

/**
 * Domain error codes — returned to API layer for safe HTTP responses.
 * NEVER expose AWS/Cognito internals or stack traces to clients.
 */
const DomainErrors = {
  MISSING_CLAIMS: 'MISSING_CLAIMS',
  EMAIL_UNVERIFIED: 'EMAIL_UNVERIFIED',
  ACCOUNT_EMAIL_CONFLICT: 'ACCOUNT_EMAIL_CONFLICT',
  CUSTOMER_BOOTSTRAP_FAILED: 'CUSTOMER_BOOTSTRAP_FAILED',
  CONCURRENT_MODIFICATION: 'CONCURRENT_MODIFICATION',
};

/**
 * Creates a structured domain error.
 *
 * @param {string} code    - Error code from DomainErrors.
 * @param {string} message - Safe, user-facing message.
 * @param {number} status  - HTTP status code.
 * @returns {Error}
 */
function createDomainError(code, message, status) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.isDomainError = true;
  return err;
}

// ---------------------------------------------------------------------------
// Claim normalization
// ---------------------------------------------------------------------------

/**
 * Normalizes an email for storage and comparison.
 * Converts to lowercase and trims whitespace.
 *
 * @param {string} email
 * @returns {string}
 */
function normalizeEmail(email) {
  return email.trim().toLowerCase();
}

/**
 * Validates and extracts trusted claims from req.auth.
 * Throws a MISSING_CLAIMS domain error if required claims are absent.
 *
 * @param {object} auth - The req.auth object populated by jwtAuth middleware.
 * @returns {{ sub: string, emailNormalized: string, emailDisplay: string, emailVerified: boolean }}
 * @throws {Error} If required claims are missing.
 */
function extractTrustedClaims(auth) {
  if (!auth || typeof auth !== 'object') {
    throw createDomainError(
      DomainErrors.MISSING_CLAIMS,
      'Authentication claims are required.',
      400
    );
  }

  const { sub, email, emailVerified } = auth;

  if (!sub || typeof sub !== 'string' || sub.trim() === '') {
    throw createDomainError(
      DomainErrors.MISSING_CLAIMS,
      'A valid sub claim is required.',
      400
    );
  }

  if (!email || typeof email !== 'string' || email.trim() === '') {
    throw createDomainError(
      DomainErrors.MISSING_CLAIMS,
      'A valid email claim is required.',
      400
    );
  }

  return {
    sub: sub.trim(),
    emailNormalized: normalizeEmail(email),
    emailDisplay: email.trim(),
    emailVerified: emailVerified === true,
  };
}

// ---------------------------------------------------------------------------
// Bootstrap logic
// ---------------------------------------------------------------------------

/**
 * Bootstraps (creates or idempotently updates) a customer record in
 * CustomersTableV2 after a successful Cognito login.
 *
 * Flow:
 *   1. Extract and validate trusted claims from auth (never from body).
 *   2. Require emailVerified === true.
 *   3. Check if a record already exists for this sub (customerId).
 *      a. If yes: update relevant fields (idempotent).
 *      b. If no:  check for email conflict, then create a new record.
 *   4. Return the customer record.
 *
 * @param {object} trustedAuth - The req.auth object from the jwtAuth middleware.
 *   Specifically: { sub, email, emailVerified, groups, scopes }
 * @param {object} [_repo] - Optional repository override for testing.
 * @returns {Promise<{ customer: object, created: boolean }>}
 * @throws {Error} Domain errors (isDomainError=true) for all expected failure paths.
 */
async function bootstrapCustomer(trustedAuth, _repo) {
  const repo = _repo || customerRepository;

  // Step 1: Validate and extract trusted claims (never trust body).
  const { sub, emailNormalized, emailDisplay, emailVerified } = extractTrustedClaims(trustedAuth);

  // Step 2: Require email verification before any write.
  if (!emailVerified) {
    throw createDomainError(
      DomainErrors.EMAIL_UNVERIFIED,
      'Email address must be verified before creating an account.',
      403
    );
  }

  const customerId = sub;  // customerId is exclusively derived from sub
  const cognitoSub = sub;  // cognitoSub is exclusively derived from sub
  const now = new Date().toISOString();

  // Step 3a: Check if a record already exists for this customerId (sub).
  const existing = await repo.getCustomerById(customerId);

  if (existing) {
    // Idempotent update — record already exists for this sub.
    // Update mutable fields that may have changed (e.g., email sync from Cognito).
    const updates = {
      emailNormalized,
      emailDisplay,
      emailVerified,
      lastSyncedFromCognitoAt: now,
    };

    const { updated, item } = await repo.updateCustomer(
      customerId,
      updates,
      existing.version
    );

    if (!updated) {
      // Optimistic lock conflict on same sub — read the latest version and
      // treat as idempotent success (another concurrent bootstrap for the same
      // user completed first; the end-state is the same).
      // `item` from updateCustomer is already the latest re-read record.
      return { customer: item, created: false };
    }

    return { customer: item, created: false };
  }

  // Step 3b: New user — check for duplicate email before creating.
  const hasConflict = await repo.checkEmailConflict(emailNormalized, customerId);
  if (hasConflict) {
    throw createDomainError(
      DomainErrors.ACCOUNT_EMAIL_CONFLICT,
      'An account with this email address already exists.',
      409
    );
  }

  // Step 3c: Create the new customer record.
  // Fields are strictly the approved minimum — no extra fields, no credentials.
  const newItem = {
    customerId,
    cognitoSub,
    emailNormalized,
    emailDisplay,
    emailVerified,
    lastSyncedFromCognitoAt: now,
    accountStatus: 'pending_profile',
    createdAt: now,
    updatedAt: now,
    version: 1,
  };

  // createCustomer uses a conditional write (attribute_not_exists(customerId)).
  // If a race causes a duplicate, it returns created=false with the existing record.
  const { created, item } = await repo.createCustomer(newItem);

  // Guard: if the re-read after a ConditionalCheckFailedException returned null,
  // the record does not exist under our customerId. This is an unexpected transient
  // state (write collision with a concurrent delete, or a GSI propagation lag).
  // Throw a retryable domain error instead of returning success with a null customer.
  if (!item) {
    throw createDomainError(
      DomainErrors.CUSTOMER_BOOTSTRAP_FAILED,
      'Customer record could not be confirmed after write. Please retry.',
      500
    );
  }

  return { customer: item, created };
}

module.exports = {
  bootstrapCustomer,
  // Exposed for testing
  extractTrustedClaims,
  normalizeEmail,
  DomainErrors,
};
