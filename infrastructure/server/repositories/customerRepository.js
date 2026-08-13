'use strict';

/**
 * customerRepository.js — DynamoDB data access for CustomersTableV2
 *
 * Table: divine-printing-customers-v2
 *   PK:  customerId (S)
 *   GSI: EmailIndex (emailNormalized HASH, createdAt RANGE, ALL projection)
 *
 * Security invariants:
 *   - This module only performs DynamoDB operations; claim derivation is in the service.
 *   - No AWS/DynamoDB error details are re-thrown naked — callers receive structured domain errors.
 *   - Optimistic locking via `version` attribute and conditional writes.
 */

const {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../utils/dynamoDbClient');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TABLE_NAME = process.env.CUSTOMERS_TABLE_V2 || 'divine-printing-customers-v2';
const EMAIL_INDEX_NAME = 'EmailIndex';

/**
 * Account statuses that constitute an email conflict for a new registration.
 * Per approved ADR, all statuses except 'deleted' and 'merged' block reuse of
 * a normalized email by a different customerId.
 *
 * Conflicting statuses (block new registration): pending_profile, active,
 *   disabled, deletion_requested
 * Non-conflicting statuses (ignored for new registration): deleted, merged
 */
const CONFLICT_ACCOUNT_STATUSES = ['pending_profile', 'active', 'disabled', 'deletion_requested'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Determines if a DynamoDB error is a ConditionalCheckFailedException.
 *
 * @param {Error} err
 * @returns {boolean}
 */
function isConditionalCheckFailed(err) {
  return (
    err &&
    (err.name === 'ConditionalCheckFailedException' ||
      (err.__type && err.__type.includes('ConditionalCheckFailed')) ||
      (err.code && err.code === 'ConditionalCheckFailedException'))
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/**
 * Retrieves a customer record by customerId (the Cognito sub).
 *
 * @param {string} customerId - The Cognito sub / customer primary key.
 * @param {object} [_docClient] - Injected DynamoDB DocumentClient (for testing).
 * @returns {Promise<object|null>} The customer item, or null if not found.
 */
async function getCustomerById(customerId, _docClient) {
  const client = _docClient || docClient;

  const command = new GetCommand({
    TableName: TABLE_NAME,
    Key: { customerId },
  });

  const response = await client.send(command);
  return response.Item ?? null;
}

/**
 * Queries the EmailIndex GSI for customers with the given normalized email.
 * Returns only records whose accountStatus is considered "active" and whose
 * customerId differs from the requester's own customerId.
 *
 * Used for duplicate email detection before creating a new customer record.
 *
 * @param {string} emailNormalized - Normalized (lowercase/trimmed) email address.
 * @param {string} ownCustomerId   - The requesting user's customerId (excluded from conflicts).
 * @param {object} [_docClient]    - Injected DynamoDB DocumentClient (for testing).
 * @returns {Promise<boolean>} True if a conflicting active record exists.
 */
async function checkEmailConflict(emailNormalized, ownCustomerId, _docClient) {
  const client = _docClient || docClient;

  const command = new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: EMAIL_INDEX_NAME,
    KeyConditionExpression: 'emailNormalized = :email',
    FilterExpression:
      'customerId <> :ownId AND accountStatus IN (:s1, :s2, :s3, :s4)',
    ExpressionAttributeValues: {
      ':email': emailNormalized,
      ':ownId': ownCustomerId,
      ':s1': CONFLICT_ACCOUNT_STATUSES[0],  // pending_profile
      ':s2': CONFLICT_ACCOUNT_STATUSES[1],  // active
      ':s3': CONFLICT_ACCOUNT_STATUSES[2],  // disabled
      ':s4': CONFLICT_ACCOUNT_STATUSES[3],  // deletion_requested
    },
    // We only need one result to confirm a conflict.
    Limit: 1,
    // Fetch only what we need to evaluate the conflict.
    ProjectionExpression: 'customerId, accountStatus',
  });

  const response = await client.send(command);
  return !!(response.Items && response.Items.length > 0);
}

/**
 * Creates a new customer record in CustomersTableV2 using a conditional write.
 * The condition ensures no record exists with the same customerId (prevents
 * duplicate creation in race conditions).
 *
 * @param {object} item - The fully-constructed customer record to persist.
 *   Must include: customerId, cognitoSub, emailNormalized, emailDisplay,
 *   emailVerified, accountStatus, createdAt, updatedAt, version,
 *   lastSyncedFromCognitoAt.
 * @param {object} [_docClient] - Injected DynamoDB DocumentClient (for testing).
 * @returns {Promise<{ created: boolean, item: object }>}
 *   created=true  → item was written (new record).
 *   created=false → item already existed (idempotent; item is what was read back).
 * @throws {{ code: string, retryable: boolean }} On unrecoverable DynamoDB errors.
 */
async function createCustomer(item, _docClient) {
  const client = _docClient || docClient;

  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
    // Prevent overwriting an existing record with the same customerId.
    // If the record already exists (same sub), ConditionalCheckFailedException is thrown.
    ConditionExpression: 'attribute_not_exists(customerId)',
  });

  try {
    await client.send(command);
    return { created: true, item };
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      // Record already exists for this customerId — idempotent success path.
      // Re-read the existing record to return it.
      const existing = await getCustomerById(item.customerId, client);
      return { created: false, item: existing };
    }
    // Surface retryable domain error without leaking AWS internals.
    const domainErr = new Error('Customer record write failed. Please retry.');
    domainErr.code = 'CUSTOMER_BOOTSTRAP_FAILED';
    domainErr.retryable = true;
    domainErr.cause = err; // preserved for internal logging, never sent to client
    throw domainErr;
  }
}

/**
 * Updates an existing customer record using optimistic locking on `version`.
 *
 * Increments `version` by 1 and updates `updatedAt` and `lastSyncedFromCognitoAt`.
 * Uses ConditionExpression to ensure the current version matches before writing.
 *
 * @param {string} customerId         - The customer's primary key (Cognito sub).
 * @param {object} updates            - Fields to update. Only approved mutable fields are applied.
 * @param {number} expectedVersion    - The version the caller read; write fails if stale.
 * @param {object} [_docClient]       - Injected DynamoDB DocumentClient (for testing).
 * @returns {Promise<{ updated: boolean, item: object }>}
 *   updated=true  → item was updated.
 *   updated=false → optimistic lock failed (same-sub conflict); item is the latest record.
 * @throws {{ code: string, retryable: boolean }} On unrecoverable DynamoDB errors.
 */
async function updateCustomer(customerId, updates, expectedVersion, _docClient) {
  const client = _docClient || docClient;
  const now = new Date().toISOString();

  // Approved mutable fields for bootstrap updates.
  const MUTABLE_FIELDS = new Set([
    'emailNormalized',
    'emailDisplay',
    'emailVerified',
    'accountStatus',
    'lastSyncedFromCognitoAt',
  ]);

  const setExpressions = [];
  const expressionAttributeNames = {};
  const expressionAttributeValues = {
    ':expectedVersion': expectedVersion,
    ':newVersion': expectedVersion + 1,
    ':updatedAt': now,
  };

  // Always update updatedAt and increment version
  setExpressions.push('#updatedAt = :updatedAt');
  expressionAttributeNames['#updatedAt'] = 'updatedAt';

  setExpressions.push('#version = :newVersion');
  expressionAttributeNames['#version'] = 'version';

  // Apply allowed update fields
  for (const [key, value] of Object.entries(updates)) {
    if (!MUTABLE_FIELDS.has(key)) continue;
    const nameAlias = `#upd_${key}`;
    const valueAlias = `:upd_${key}`;
    setExpressions.push(`${nameAlias} = ${valueAlias}`);
    expressionAttributeNames[nameAlias] = key;
    expressionAttributeValues[valueAlias] = value;
  }

  const command = new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { customerId },
    UpdateExpression: `SET ${setExpressions.join(', ')}`,
    ConditionExpression: '#version = :expectedVersion',
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    ReturnValues: 'ALL_NEW',
  });

  try {
    const response = await client.send(command);
    return { updated: true, item: response.Attributes };
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      // Optimistic lock conflict — re-read the latest record.
      const latest = await getCustomerById(customerId, client);
      return { updated: false, item: latest };
    }
    const domainErr = new Error('Customer record update failed. Please retry.');
    domainErr.code = 'CUSTOMER_BOOTSTRAP_FAILED';
    domainErr.retryable = true;
    domainErr.cause = err;
    throw domainErr;
  }
}

module.exports = {
  getCustomerById,
  checkEmailConflict,
  createCustomer,
  updateCustomer,
  // Exposed for testing
  TABLE_NAME,
  EMAIL_INDEX_NAME,
};
