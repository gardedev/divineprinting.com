'use strict';

/**
 * Jest configuration for integration tests.
 *
 * Key differences from the default (unit) config:
 *   - Only runs tests in tests/integration/
 *   - Uses globalSetup/globalTeardown to manage DynamoDB Local container
 *   - Runs tests serially (--runInBand) to share the single DynamoDB Local instance
 *   - Longer timeout (30s) to account for Docker startup and DynamoDB operations
 *   - forceExit ensures the process terminates even if open handles remain
 */

module.exports = {
  testEnvironment: 'node',

  // Only pick up integration test files
  testMatch: ['**/tests/integration/__tests__/**/*.integration.test.js'],

  // Exclude unit tests
  testPathIgnorePatterns: ['/node_modules/'],

  // One-time Docker container lifecycle
  globalSetup: './tests/integration/helpers/globalSetup.js',
  globalTeardown: './tests/integration/helpers/globalTeardown.js',

  // All integration tests share the same DynamoDB Local instance.
  // Serial execution avoids race conditions on table resets.
  // (Individual test files use beforeEach table resets for isolation.)
  maxWorkers: 1,

  // Allow time for Docker startup and DynamoDB operations
  testTimeout: 30000,

  // Verbose output shows each test individually
  verbose: true,

  // Ensure process terminates after tests complete
  forceExit: true,

  // Display test name in the test run header
  displayName: 'integration',

  // uuid v14 is pure ESM; Jest on Node < v24.9 cannot require() ESM modules.
  // Redirect uuid to a CJS shim that uses crypto.randomUUID() instead.
  moduleNameMapper: {
    '^uuid$': '<rootDir>/tests/integration/helpers/uuid-cjs-shim.js',
  },
};
