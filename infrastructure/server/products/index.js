'use strict';

/**
 * products/index.js — Admin product routes.
 *
 * Mounted at: /api/admin/products  (see server.js)
 *
 * All routes call ProductService exclusively; no direct DynamoDB or
 * ProductRepository access happens here.
 *
 * Route ordering note:
 *   /by-slug/:slug is registered before /:productId so that the literal
 *   path segment "by-slug" is not captured as a productId.
 */

const express = require('express');
const router = express.Router();

const productService = require('./productService');
const { adminAuth } = require('../middleware/adminAuth');
const logger = require('../utils/logger');

// Apply admin auth guard to every route in this router.
router.use(adminAuth);

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
    msg.includes('Invalid status transition') ||
    msg.includes('Cannot update a soft-deleted product') ||
    msg.includes('Product is already deleted')
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

// ---------------------------------------------------------------------------
// POST /api/admin/products — Create a product
// ---------------------------------------------------------------------------
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, description, basePrice, status, slug } = req.body || {};

    // Require name and basePrice at the route boundary before hitting the service
    if (name === undefined || basePrice === undefined) {
      return res.status(400).json({
        error: 'name and basePrice are required.',
      });
    }

    const product = await productService.createProduct({
      name,
      description,
      basePrice,
      status,
      slug,
    });

    return res.status(201).json({ product });
  })
);

// ---------------------------------------------------------------------------
// GET /api/admin/products — List products
// ---------------------------------------------------------------------------
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const { status, cursor } = req.query;
    let { limit } = req.query;

    // Coerce limit from query string to integer when supplied
    if (limit !== undefined) {
      limit = parseInt(limit, 10);
      if (Number.isNaN(limit)) {
        return res.status(400).json({ error: 'limit must be a positive integer.' });
      }
    }

    const result = await productService.listProducts({ limit, status, cursor });

    return res.status(200).json(result);
  })
);

// ---------------------------------------------------------------------------
// GET /api/admin/products/by-slug/:slug — Fetch product by slug
//
// Must be registered before /:productId to prevent "by-slug" being captured
// as a productId.
// ---------------------------------------------------------------------------
router.get(
  '/by-slug/:slug',
  asyncHandler(async (req, res) => {
    const { slug } = req.params;

    const product = await productService.getProductBySlug(slug);

    if (!product) {
      return res.status(404).json({ error: `Product not found with slug: ${slug}` });
    }

    return res.status(200).json({ product });
  })
);

// ---------------------------------------------------------------------------
// GET /api/admin/products/:productId — Fetch product by ID
// ---------------------------------------------------------------------------
router.get(
  '/:productId',
  asyncHandler(async (req, res) => {
    const { productId } = req.params;

    const product = await productService.getProduct(productId);

    if (!product) {
      return res.status(404).json({ error: `Product not found: ${productId}` });
    }

    return res.status(200).json({ product });
  })
);

// ---------------------------------------------------------------------------
// PATCH /api/admin/products/:productId — Partial update
// ---------------------------------------------------------------------------
router.patch(
  '/:productId',
  asyncHandler(async (req, res) => {
    const { productId } = req.params;
    const updates = req.body || {};

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: 'Request body must not be empty.' });
    }

    const product = await productService.updateProduct(productId, updates);

    return res.status(200).json({ product });
  })
);

// ---------------------------------------------------------------------------
// POST /api/admin/products/:productId/publish — Publish (draft → active)
// ---------------------------------------------------------------------------
router.post(
  '/:productId/publish',
  asyncHandler(async (req, res) => {
    const { productId } = req.params;

    const product = await productService.publishProduct(productId);

    return res.status(200).json({ product });
  })
);

// ---------------------------------------------------------------------------
// POST /api/admin/products/:productId/archive — Archive (active → archived)
// ---------------------------------------------------------------------------
router.post(
  '/:productId/archive',
  asyncHandler(async (req, res) => {
    const { productId } = req.params;

    const product = await productService.archiveProduct(productId);

    return res.status(200).json({ product });
  })
);

// ---------------------------------------------------------------------------
// POST /api/admin/products/:productId/restore — Restore (archived → draft)
// ---------------------------------------------------------------------------
router.post(
  '/:productId/restore',
  asyncHandler(async (req, res) => {
    const { productId } = req.params;

    const product = await productService.restoreProduct(productId);

    return res.status(200).json({ product });
  })
);

// ---------------------------------------------------------------------------
// DELETE /api/admin/products/:productId — Soft-delete
// ---------------------------------------------------------------------------
router.delete(
  '/:productId',
  asyncHandler(async (req, res) => {
    const { productId } = req.params;

    const product = await productService.deleteProduct(productId);

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
    logger.error('[admin/products] Unexpected error', err);
  }

  return res.status(status).json({ error: message });
});

module.exports = router;
