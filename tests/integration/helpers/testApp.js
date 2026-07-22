'use strict';

/**
 * Builds an Express app wired to the integration repository (DynamoDB Local).
 *
 * Two variants are exported:
 *   - createTestApp()         → admin routes return 503 (production behaviour)
 *   - createAuthBypassApp()   → admin routes bypass auth (test-only, never used in prod)
 *
 * The auth bypass is implemented by injecting a permissive middleware via the
 * createApp({ adminAuthMiddleware }) injection point.  adminAuth.js is NEVER
 * modified or weakened.
 */

const { createApp } = require('../../../infrastructure/server/app');
const { ProductService } = require('./integrationService');
const integrationRepository = require('./integrationRepository');

// ---------------------------------------------------------------------------
// Shared service instance (uses the real integration repository)
// ---------------------------------------------------------------------------

const integrationService = new ProductService(integrationRepository);

// ---------------------------------------------------------------------------
// Middleware: test-only auth bypass
// ---------------------------------------------------------------------------

/**
 * Permissive admin middleware used ONLY in integration tests.
 * Never ship this in production code.
 */
function testAdminBypass(req, res, next) {
  // Attach a stub "admin" principal so downstream handlers know who's asking.
  req.admin = { id: 'test-admin', role: 'admin' };
  next();
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

/**
 * Creates an app that uses production adminAuth (deny-by-default, 503).
 * Used for testing auth-rejection behaviour.
 */
function createTestApp() {
  return createApp({ productService: integrationService });
}

/**
 * Creates an app with the auth guard bypassed.
 * Used for testing admin route logic independently of authentication.
 */
function createAuthBypassApp() {
  return createApp({
    productService: integrationService,
    adminAuthMiddleware: testAdminBypass,
  });
}

module.exports = {
  integrationService,
  integrationRepository,
  createTestApp,
  createAuthBypassApp,
};
