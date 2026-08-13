'use strict';

const express = require('express');
const { createPublicProductRouter } = require('./routes/publicProducts');
const { createAdminProductRouter } = require('./routes/adminProducts');
const { adminAuth } = require('./middleware/adminAuth');
const { jwtAuth } = require('./middleware/jwtAuth');
const { createCustomerRegistrationRouter } = require('./api/customerRegistrationApi');

/**
 * Creates and configures an Express application.
 *
 * Accepts an options object to allow dependency injection:
 *   - productService              : ProductService instance (required)
 *   - adminAuthMiddleware         : Express middleware for admin routes.
 *                                   Defaults to the production adminAuth (deny-by-default, 503).
 *                                   Integration tests MUST pass a test-only middleware here.
 *                                   Do NOT use this hook to weaken production behaviour.
 *   - jwtAuthMiddleware           : JWT auth middleware for customer routes.
 *                                   Defaults to the production jwtAuth.
 *                                   Tests may inject a stub to control auth behaviour.
 *   - customerRegistrationRouter  : Pre-built customer registration router.
 *                                   Defaults to createCustomerRegistrationRouter(jwtAuthMiddleware).
 *                                   Allows tests to inject a fully mocked router.
 *
 * @param {Object} options
 * @param {Object} options.productService - Injected ProductService.
 * @param {Function} [options.adminAuthMiddleware] - Override for admin auth (test use only).
 * @param {Function} [options.jwtAuthMiddleware] - Override for JWT auth (test use only).
 * @param {import('express').Router} [options.customerRegistrationRouter] - Override for customer routes (test use only).
 * @returns {import('express').Application}
 */
function createApp({
  productService,
  adminAuthMiddleware = adminAuth,
  jwtAuthMiddleware: injectedJwtAuth = jwtAuth,
  customerRegistrationRouter: injectedCustomerRouter,
} = {}) {
  if (!productService) {
    throw new Error('createApp requires a productService instance.');
  }

  const app = express();

  // --------------------------------------------------------------------------
  // Middleware
  // --------------------------------------------------------------------------
  app.use(express.json());

  // --------------------------------------------------------------------------
  // Health check (unauthenticated)
  // --------------------------------------------------------------------------
  app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

  // --------------------------------------------------------------------------
  // Public routes (no auth)
  // --------------------------------------------------------------------------
  app.use('/api/products', createPublicProductRouter(productService));

  // --------------------------------------------------------------------------
  // Admin routes (auth-gated)
  // --------------------------------------------------------------------------
  app.use('/api/admin/products', createAdminProductRouter(productService, adminAuthMiddleware));

  // --------------------------------------------------------------------------
  // Customer registration routes (JWT-gated)
  // --------------------------------------------------------------------------
  const customerRouter =
    injectedCustomerRouter ||
    createCustomerRegistrationRouter(injectedJwtAuth);
  app.use('/api/customers', customerRouter);

  // --------------------------------------------------------------------------
  // Global error handler
  // --------------------------------------------------------------------------
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err.message);
    return res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}

module.exports = { createApp };
