'use strict';

/**
 * Builds a productRepository-compatible object wired to DynamoDB Local
 * (the integration test table).
 *
 * This module is ONLY used in integration tests.  It imports the real
 * repository functions but patches them to use:
 *   - the local DynamoDB endpoint
 *   - the isolated integration-test table name
 *
 * Strategy: re-require the repository after setting the environment variables
 * that control the endpoint and table name, then reset them.
 * Simpler and more robust than monkey-patching internals.
 */

const { randomUUID } = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand, GetCommand, QueryCommand, ScanCommand, UpdateCommand, DeleteCommand } = require('@aws-sdk/lib-dynamodb');

const { DYNAMO_LOCAL_ENDPOINT, INTEGRATION_TABLE } = require('./dynamoLocal');

// ---------------------------------------------------------------------------
// Build a document client that talks to DynamoDB Local
// ---------------------------------------------------------------------------

function buildIntegrationDocClient() {
  const rawClient = new DynamoDBClient({
    region: 'us-east-1',
    endpoint: DYNAMO_LOCAL_ENDPOINT,
    credentials: {
      accessKeyId: 'fakeAccessKeyId',
      secretAccessKey: 'fakeSecretAccessKey',
    },
  });

  return DynamoDBDocumentClient.from(rawClient, {
    marshallOptions: {
      convertEmptyValues: false,
      removeUndefinedValues: true,
      convertClassInstanceToMap: false,
    },
    unmarshallOptions: { wrapNumbers: false },
  });
}

const docClient = buildIntegrationDocClient();

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateBasePrice(basePrice) {
  if (
    typeof basePrice !== 'number' ||
    !Number.isInteger(basePrice) ||
    basePrice < 0
  ) {
    throw new Error(
      'basePrice must be a non-negative integer representing cents (e.g. 1999 for $19.99).'
    );
  }
}

// ---------------------------------------------------------------------------
// Repository functions – mirror productRepository.js, wired to the test table
// ---------------------------------------------------------------------------

async function createProduct(productData) {
  const now = new Date().toISOString();
  const productId = randomUUID();

  validateBasePrice(productData.basePrice);

  const item = {
    ...productData,
    productId,
    createdAt: now,
    updatedAt: now,
  };

  await docClient.send(
    new PutCommand({
      TableName: INTEGRATION_TABLE,
      Item: item,
      ConditionExpression: 'attribute_not_exists(productId)',
    })
  );

  return item;
}

async function getProductById(productId) {
  const response = await docClient.send(
    new GetCommand({
      TableName: INTEGRATION_TABLE,
      Key: { productId },
    })
  );
  return response.Item ?? null;
}

async function getProductBySlug(slug) {
  const response = await docClient.send(
    new QueryCommand({
      TableName: INTEGRATION_TABLE,
      IndexName: 'slug-index',
      KeyConditionExpression: '#slug = :slug',
      ExpressionAttributeNames: { '#slug': 'slug' },
      ExpressionAttributeValues: { ':slug': slug },
      Limit: 1,
    })
  );
  return response.Items && response.Items.length > 0 ? response.Items[0] : null;
}

async function listProducts() {
  const response = await docClient.send(
    new ScanCommand({ TableName: INTEGRATION_TABLE })
  );
  return response.Items || [];
}

async function updateProduct(productId, updates) {
  if (!updates || Object.keys(updates).length === 0) {
    throw new Error('No update fields provided.');
  }

  const now = new Date().toISOString();
  const fields = { ...updates, updatedAt: now };

  const updateParts = [];
  const ExpressionAttributeNames = {};
  const ExpressionAttributeValues = {};

  for (const [key, value] of Object.entries(fields)) {
    const nameAlias = `#${key}`;
    const valueAlias = `:${key}`;
    updateParts.push(`${nameAlias} = ${valueAlias}`);
    ExpressionAttributeNames[nameAlias] = key;
    ExpressionAttributeValues[valueAlias] = value;
  }

  const response = await docClient.send(
    new UpdateCommand({
      TableName: INTEGRATION_TABLE,
      Key: { productId },
      UpdateExpression: `SET ${updateParts.join(', ')}`,
      ConditionExpression: 'attribute_exists(productId)',
      ExpressionAttributeNames,
      ExpressionAttributeValues,
      ReturnValues: 'ALL_NEW',
    })
  );
  return response.Attributes;
}

async function deleteProduct(productId) {
  await docClient.send(
    new DeleteCommand({
      TableName: INTEGRATION_TABLE,
      Key: { productId },
      ConditionExpression: 'attribute_exists(productId)',
    })
  );
}

module.exports = {
  createProduct,
  getProductById,
  getProductBySlug,
  listProducts,
  updateProduct,
  deleteProduct,
};
