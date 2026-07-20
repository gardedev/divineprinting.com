'use strict';

/**
 * publicProductRoutes.js — Public (unauthenticated) product routes.
 *
 * Mounted at: /api/products  (see server.js)
 *
 * Exposes only active, non-soft-deleted products to anonymous callers.
 * All routes call ProductService exclusively; no direct DynamoDB or
 * ProductRepository access occurs here.
 *
 * Route ordering note:
 *   /by-slug/:slug is registered before /:productId so that the literal
 *   path segment "by-slug" is not captured as a productId.
 */

const express = require('express');
const router = express.Router();

const productService = require('./productService');
const logger = require('../utils/logger');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Wraps an async route handler so that unhandled promise rejections are
 * forwarded to Express's next() error handler rather than crashing the
 * process.
 *
 * @param {Function} fn - Async (req, res, next) handler.
 * @returns {Function} Express-compatible middleware.
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Maps a known ProductService error message to an HTTP status code.
 *
 * @param {Error} err
 * @returns {number} HTTP status code.
 */
function httpStatusForError(err) {
  const msg = err.message || '';

  // Validation errors → 400
  if (
    msg.includes('must be') ||
    msg.includes('required') ||
    msg.includes('must not') ||
    msg.includes('non-empty') ||
    msg.includes('positive integer') ||
    msg.includes('non-negative integer') ||
    msg.includes('non-null object') ||
    msg.includes('status must be one of') ||
    msg.includes('Invalid status transition')
  ) {
    return 400;
  }

  // Not found → 404
  if (msg.startsWith('Product not found:')) {
    return 404;
  }

  // Everything else → 500
  return 500;
}

/**
 * Returns true if the product is publicly visible:
 *   - status is 'active'
 *   - not soft-deleted (no deletedAt timestamp)
 *
 * @param {Object|null} product
 * @returns {boolean}
 */
function isPubliclyVisible(product) {
  if (!product) return false;
  return product.status === 'active' && !product.deletedAt;
}

// ---------------------------------------------------------------------------
// GET /api/products — List active products
//
// Query parameters:
 //   limit  {number}  - Max items per page (positive integer, optional)
//   cursor {string}  - Base64-encoded pagination cursor (optional)
//
// Always forces status=active and excludes soft-deleted items.
// ---------------------------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { cursor } = req.query;
    let { limit } = req.query;

    // Coerce limit from query string to integer when supplied
    if (limit !== undefined) {
      limit = parseInt(limit, 10);
      if (Number.isNaN(limit) || limit <= 0) {
        return res.status(400).json({ error: 'limit must be a positive integer.' });
      }
    }

    // Public API always filters to active products only
    const result = await productService.listProducts({ limit, status: 'active', cursor });

    // Additionally strip any soft-deleted items that may have slipped through
    const items = (result.items || []).filter(isPubliclyVisible);

    return res.status(200).json({
      items,
      nextCursor: result.nextCursor,
    });
  })
);

// ---------------------------------------------------------------------------
// GET /api/products/by-slug/:slug — Fetch active product by slug
//
// Must be registered before /:productId to prevent "by-slug" being captured
// as a productId.
// ---------------------------------------------------------------------------
router.get(
  '/by-slug/:slug',
  asyncHandler(async (req, res) => {
    const { slug } = req.params;

    if (!slug || slug.trim() === '') {
      return res.status(400).json({ error: 'slug is required.' });
    }

    const product = await productService.getProductBySlug(slug.trim());

    if (!isPubliclyVisible(product)) {
      // Treat not-found, inactive, and soft-deleted the same to avoid leaking
      // information about non-public products.
      return res.status(404).json({ error: `Product not found with slug: ${slug}` });
    }

    return res.status(200).json({ product });
  })
);

// ---------------------------------------------------------------------------
// GET /api/products/:productId — Fetch active product by ID
// ---------------------------------------------------------------------------
router.get(
  '/:productId',
  asyncHandler(async (req, res) => {
    const { productId } = req.params;

    if (!productId || productId.trim() === '') {
      return res.status(400).json({ error: 'productId is required.' });
    }

    const product = await productService.getProduct(productId.trim());

    if (!isPubliclyVisible(product)) {
      // Treat not-found, inactive, and soft-deleted the same to avoid leaking
      // information about non-public products.
      return res.status(404).json({ error: `Product not found: ${productId}` });
    }

    return res.status(200).json({ product });
  })
);

// ---------------------------------------------------------------------------
// Route-level error handler
// Catches errors forwarded by asyncHandler's next(err).
// ---------------------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  const status = httpStatusForError(err);
  const message = err.message || 'Internal server error';

  if (status === 500) {
    logger.error('[public/products] Unexpected error', err);
  }

  return res.status(status).json({ error: message });
});

module.exports = router;
