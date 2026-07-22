'use strict';

/**
 * Jest globalTeardown – runs once after all integration test suites complete.
 *
 * Stops and removes the DynamoDB Local Docker container.
 */

const { stopDynamoLocal } = require('./dynamoLocal');

module.exports = async function globalTeardown() {
  console.log('\n[integration] Stopping DynamoDB Local…');
  await stopDynamoLocal();
  console.log('[integration] Done.\n');
};
