'use strict';

/**
 * Jest globalSetup – runs once before all integration test suites.
 *
 * Starts the DynamoDB Local Docker container and creates the integration table.
 */

const {
  startDynamoLocal,
  createIntegrationTable,
} = require('./dynamoLocal');

module.exports = async function globalSetup() {
  console.log('\n[integration] Starting DynamoDB Local…');
  await startDynamoLocal();
  console.log('[integration] Creating integration test table…');
  await createIntegrationTable();
  console.log('[integration] DynamoDB Local ready.\n');
};
