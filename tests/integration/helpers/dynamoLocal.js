'use strict';

/**
 * DynamoDB Local management helpers for integration tests.
 *
 * Manages a Docker-based DynamoDB Local instance.  Uses a fixed host port so
 * multiple test runs do not collide with each other (CI typically serialises
 * integration suites).
 *
 * The integration test table is ALWAYS a dedicated table:
 *   divine-printing-products-integration-test
 *
 * This file NEVER touches the production table name.
 */

const { execSync, exec } = require('child_process');
const { promisify } = require('util');
const {
  DynamoDBClient,
  CreateTableCommand,
  DeleteTableCommand,
  ListTablesCommand,
  ResourceNotFoundException,
} = require('@aws-sdk/client-dynamodb');

const execAsync = promisify(exec);

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DYNAMO_LOCAL_PORT = 8100; // Isolated port – avoids conflicts on 8000
const DYNAMO_LOCAL_ENDPOINT = `http://localhost:${DYNAMO_LOCAL_PORT}`;
const CONTAINER_NAME = 'dynamodb-local-integration-test';
const INTEGRATION_TABLE = 'divine-printing-products-integration-test';

// ---------------------------------------------------------------------------
// Low-level DynamoDB client pointing at DynamoDB Local
// ---------------------------------------------------------------------------

function createLocalClient() {
  return new DynamoDBClient({
    region: 'us-east-1',
    endpoint: DYNAMO_LOCAL_ENDPOINT,
    credentials: {
      accessKeyId: 'fakeAccessKeyId',
      secretAccessKey: 'fakeSecretAccessKey',
    },
  });
}

// ---------------------------------------------------------------------------
// Docker container lifecycle
// ---------------------------------------------------------------------------

/**
 * Starts a DynamoDB Local Docker container (if not already running).
 * Waits until the service is ready to accept connections.
 */
async function startDynamoLocal() {
  // Remove any leftover container from a previous crashed test run
  try {
    execSync(
      `docker rm -f ${CONTAINER_NAME}`,
      { stdio: 'ignore' }
    );
  } catch (_) { /* nothing to remove */ }

  execSync(
    `docker run -d --name ${CONTAINER_NAME} -p ${DYNAMO_LOCAL_PORT}:8000 ` +
    `amazon/dynamodb-local:latest -jar DynamoDBLocal.jar -inMemory -sharedDb`,
    { stdio: 'inherit' }
  );

  await waitForDynamoLocal();
}

/**
 * Stops and removes the DynamoDB Local Docker container.
 */
async function stopDynamoLocal() {
  try {
    execSync(`docker rm -f ${CONTAINER_NAME}`, { stdio: 'ignore' });
  } catch (_) { /* already gone */ }
}

/**
 * Polls DynamoDB Local until it responds to ListTables (or times out).
 */
async function waitForDynamoLocal(timeoutMs = 15000) {
  const client = createLocalClient();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await client.send(new ListTablesCommand({}));
      return; // Ready!
    } catch (_) {
      await sleep(200);
    }
  }

  throw new Error(
    `DynamoDB Local did not become ready within ${timeoutMs}ms on port ${DYNAMO_LOCAL_PORT}.`
  );
}

// ---------------------------------------------------------------------------
// Table lifecycle
// ---------------------------------------------------------------------------

/**
 * Creates the integration test table.
 * Schema mirrors the production table but uses the isolated table name.
 *
 * Includes a GSI on `slug` so slug-based queries work end-to-end.
 */
async function createIntegrationTable() {
  const client = createLocalClient();

  await client.send(
    new CreateTableCommand({
      TableName: INTEGRATION_TABLE,
      AttributeDefinitions: [
        { AttributeName: 'productId', AttributeType: 'S' },
        { AttributeName: 'slug', AttributeType: 'S' },
      ],
      KeySchema: [{ AttributeName: 'productId', KeyType: 'HASH' }],
      GlobalSecondaryIndexes: [
        {
          IndexName: 'slug-index',
          KeySchema: [{ AttributeName: 'slug', KeyType: 'HASH' }],
          Projection: { ProjectionType: 'ALL' },
          ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
        },
      ],
      BillingMode: 'PAY_PER_REQUEST',
    })
  );
}

/**
 * Drops the integration test table (if it exists).
 */
async function dropIntegrationTable() {
  const client = createLocalClient();
  try {
    await client.send(new DeleteTableCommand({ TableName: INTEGRATION_TABLE }));
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') throw err;
    // Table didn't exist – that's fine
  }
}

/**
 * Recreates the integration test table.
 * Ensures a clean slate between test suites.
 */
async function resetIntegrationTable() {
  await dropIntegrationTable();
  await createIntegrationTable();
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = {
  DYNAMO_LOCAL_ENDPOINT,
  DYNAMO_LOCAL_PORT,
  INTEGRATION_TABLE,
  CONTAINER_NAME,
  createLocalClient,
  startDynamoLocal,
  stopDynamoLocal,
  waitForDynamoLocal,
  createIntegrationTable,
  dropIntegrationTable,
  resetIntegrationTable,
};

// ---------------------------------------------------------------------------
// Internal
// ---------------------------------------------------------------------------
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
