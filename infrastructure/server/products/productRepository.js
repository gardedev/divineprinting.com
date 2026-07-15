'use strict';

const { PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { v4: uuidv4 } = require('uuid');
const { docClient } = require('../utils/dynamoDbClient');

const TABLE_NAME = 'divine-printing-products';
const SLUG_INDEX_NAME = 'slug-index';

/** Valid product status values */
const VALID_STATUSES = ['active', 'draft', 'archived'];

/**
 * Creates a new product in DynamoDB.
 *
 * Money values (e.g. basePrice) must be supplied as positive integer cents.
 * A ConditionExpression prevents overwriting an existing product with the
 * same productId (practically impossible with UUIDs, but enforced for safety).
 *
 * @param {Object} productData - The product fields to persist.
 * @param {string} productData.name - Human-readable product name.
 * @param {string} [productData.description] - Optional product description.
 * @param {number} productData.basePrice - Price in integer cents (e.g. 1999 = $19.99).
 * @returns {Promise<Object>} The newly created product item (with productId, timestamps).
 * @throws {Error} If a product with the same productId already exists, or on DynamoDB errors.
 */
async function createProduct(productData) {
  const now = new Date().toISOString();
  const productId = uuidv4();

  // Validate basePrice is a non-negative integer representing cents
  const basePrice = productData.basePrice;
  if (
    typeof basePrice !== 'number' ||
    !Number.isInteger(basePrice) ||
    basePrice < 0
  ) {
    throw new Error(
      'basePrice must be a non-negative integer representing cents (e.g. 1999 for $19.99).'
    );
  }

  const item = {
    ...productData,
    productId,
    basePrice, // stored as integer cents
    createdAt: now,
    updatedAt: now,
  };

  const command = new PutCommand({
    TableName: TABLE_NAME,
    Item: item,
    // Prevent overwriting an existing item with the same key
    ConditionExpression: 'attribute_not_exists(productId)',
  });

  await docClient.send(command);

  return item;
}

/**
 * Retrieves a product by its unique ID.
 *
 * @param {string} productId - The UUID of the product to retrieve.
 * @returns {Promise<Object|null>} The product item, or null if not found.
 * @throws {Error} On DynamoDB communication errors.
 */
async function getProductById(productId) {
  const command = new GetCommand({
    TableName: TABLE_NAME,
    Key: { productId },
  });

  const response = await docClient.send(command);

  // GetCommand returns an empty object (no Item) when the key does not exist
  return response.Item ?? null;
}

/**
 * Retrieves a product by its URL slug using the slug-index GSI.
 *
 * @param {string} slug - The unique URL slug of the product (e.g. 'vinyl-banner').
 * @returns {Promise<Object|null>} The matching product item, or null if not found.
 * @throws {Error} If slug is invalid or on DynamoDB communication errors.
 */
async function getProductBySlug(slug) {
  if (typeof slug !== 'string' || slug.trim() === '') {
    throw new Error('slug must be a non-empty string.');
  }

  const command = new QueryCommand({
    TableName: TABLE_NAME,
    IndexName: SLUG_INDEX_NAME,
    KeyConditionExpression: 'slug = :slug',
    ExpressionAttributeValues: {
      ':slug': slug.trim(),
    },
    Limit: 1,
  });

  const response = await docClient.send(command);

  if (!response.Items || response.Items.length === 0) {
    return null;
  }

  return response.Items[0];
}

/**
 * Lists products from DynamoDB using a Scan (with optional status filter and pagination).
 *
 * @param {Object} [options={}] - Listing options.
 * @param {number} [options.limit=10] - Maximum number of products to return (positive integer).
 * @param {string} [options.status] - Optional status filter: 'active', 'draft', or 'archived'.
 * @param {string} [options.cursor] - Optional base64-encoded pagination cursor (LastEvaluatedKey).
 * @returns {Promise<{items: Object[], nextCursor: string|null}>}
 *   An object with:
 *   - `items`: Array of product items.
 *   - `nextCursor`: A base64-encoded cursor for the next page, or null if no more pages.
 * @throws {Error} If options values are invalid or on DynamoDB communication errors.
 */
async function listProducts(options = {}) {
  const { limit = 10, status, cursor } = options;

  // Validate limit
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('limit must be a positive integer.');
  }

  // Validate status if provided
  if (status !== undefined && !VALID_STATUSES.includes(status)) {
    throw new Error(
      `status must be one of: ${VALID_STATUSES.join(', ')}.`
    );
  }

  // Decode cursor if provided
  let exclusiveStartKey;
  if (cursor !== undefined) {
    if (typeof cursor !== 'string' || cursor.trim() === '') {
      throw new Error('cursor must be a non-empty string.');
    }
    try {
      exclusiveStartKey = JSON.parse(
        Buffer.from(cursor, 'base64').toString('utf8')
      );
    } catch {
      throw new Error('cursor is not a valid pagination token.');
    }
  }

  const params = {
    TableName: TABLE_NAME,
    Limit: limit,
  };

  if (exclusiveStartKey) {
    params.ExclusiveStartKey = exclusiveStartKey;
  }

  // Apply status filter via FilterExpression
  if (status !== undefined) {
    params.FilterExpression = '#status = :status';
    params.ExpressionAttributeNames = { '#status': 'status' };
    params.ExpressionAttributeValues = { ':status': status };
  }

  const command = new ScanCommand(params);
  const response = await docClient.send(command);

  const items = response.Items || [];

  // Encode the LastEvaluatedKey into a base64 cursor for the caller
  let nextCursor = null;
  if (response.LastEvaluatedKey) {
    nextCursor = Buffer.from(
      JSON.stringify(response.LastEvaluatedKey)
    ).toString('base64');
  }

  return { items, nextCursor };
}

/**
 * Updates an existing product in DynamoDB.
 *
 * Only the fields present in `updates` are written; productId and createdAt
 * are never overwritten.  updatedAt is always set to now.
 *
 * @param {string} productId  - The UUID of the product to update.
 * @param {Object} updates    - Partial product fields to apply.
 * @returns {Promise<Object>} The updated product item (Attributes from DynamoDB).
 * @throws {Error} If productId is invalid or DynamoDB returns an error.
 */
async function updateProduct(productId, updates) {
  if (typeof productId !== 'string' || productId.trim() === '') {
    throw new Error('productId must be a non-empty string.');
  }

  const now = new Date().toISOString();

  // Build a dynamic UpdateExpression from the provided fields.
  // We exclude productId and createdAt from being overwritten.
  const PROTECTED = new Set(['productId', 'createdAt']);

  const setExpressions = [];
  const expressionAttributeNames = {};
  const expressionAttributeValues = {};

  for (const [key, value] of Object.entries(updates)) {
    if (PROTECTED.has(key)) continue;
    const nameAlias = `#upd_${key}`;
    const valueAlias = `:upd_${key}`;
    setExpressions.push(`${nameAlias} = ${valueAlias}`);
    expressionAttributeNames[nameAlias] = key;
    expressionAttributeValues[valueAlias] = value;
  }

  // Always update updatedAt
  setExpressions.push('#upd_updatedAt = :upd_updatedAt');
  expressionAttributeNames['#upd_updatedAt'] = 'updatedAt';
  expressionAttributeValues[':upd_updatedAt'] = now;

  if (setExpressions.length === 1) {
    // Only updatedAt would be set — still valid, just a timestamp touch
  }

  const command = new UpdateCommand({
    TableName: TABLE_NAME,
    Key: { productId: productId.trim() },
    UpdateExpression: `SET ${setExpressions.join(', ')}`,
    ExpressionAttributeNames: expressionAttributeNames,
    ExpressionAttributeValues: expressionAttributeValues,
    // Ensure the item exists before updating
    ConditionExpression: 'attribute_exists(productId)',
    ReturnValues: 'ALL_NEW',
  });

  const response = await docClient.send(command);
  return response.Attributes;
}

module.exports = {
  createProduct,
  getProductById,
  getProductBySlug,
  listProducts,
  updateProduct,
};
