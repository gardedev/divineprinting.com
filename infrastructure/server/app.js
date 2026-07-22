'use strict';

const express = require('express');
const { createPublicProductRouter } = require('./routes/publicProducts');
const { createAdminProductRouter } = require('./routes/adminProducts');
const { adminAuth } = require('./middleware/adminAuth');

/**
 * Creates and configures an Express application.
 *
 * Accepts an options object to allow dependency injection:
 *   - productService   : ProductService instance (required)
 *   - adminAuthMiddleware : Express middleware for admin routes.
 *                          Defaults to the production adminAuth (deny-by-default, 503).
 *                          Integration tests MUST pass a test-only middleware here.
 *                          Do NOT use this hook to weaken production behaviour.
 *
 * @param {Object} options
 * @param {Object} options.productService - Injected ProductService.
 * @param {Function} [options.adminAuthMiddleware] - Override for admin auth (test use only).
 * @returns {import('express').Application}
 */
function createApp({ productService, adminAuthMiddleware = adminAuth } = {}) {
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
