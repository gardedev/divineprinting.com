'use strict';

const { Router } = require('express');

/**
 * Public product routes – no authentication required.
 *
 * Factory function receives a productService instance so tests can inject
 * a service backed by any repository (including the integration-test table).
 *
 * Routes:
 *   GET /api/products          - list all published products
 *   GET /api/products/:slug    - get a single product by URL slug
 *
 * NOTE: There is intentionally NO GET /api/products/:id endpoint.
 *       Public consumers must use slugs.
 */
function createPublicProductRouter(productService) {
  const router = Router();

  // -------------------------------------------------------------------------
  // GET /api/products
  // -------------------------------------------------------------------------
  router.get('/', async (req, res, next) => {
    try {
      const products = await productService.listProducts();
      return res.status(200).json({ products });
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/products/:slug
  // -------------------------------------------------------------------------
  router.get('/:slug', async (req, res, next) => {
    try {
      const { slug } = req.params;

      if (!slug || typeof slug !== 'string') {
        return res.status(400).json({ error: 'slug is required.' });
      }

      const product = await productService.getProductBySlug(slug);

      if (!product) {
        return res.status(404).json({ error: `Product not found: ${slug}` });
      }

      return res.status(200).json({ product });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { createPublicProductRouter };
