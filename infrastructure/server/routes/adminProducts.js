'use strict';

const { Router } = require('express');

/**
 * Admin product routes – require authentication middleware.
 *
 * Factory function receives:
 *   - productService : service instance (injectable for tests)
 *   - authMiddleware : Express middleware (injectable for tests; production
 *                      code MUST pass adminAuth from adminAuth.js)
 *
 * Routes:
 *   POST   /api/admin/products           - create product
 *   GET    /api/admin/products           - list all products
 *   GET    /api/admin/products/:id       - get product by UUID
 *   PUT    /api/admin/products/:id       - update product
 *   DELETE /api/admin/products/:id       - delete product
 */
function createAdminProductRouter(productService, authMiddleware) {
  const router = Router();

  // Apply auth guard to every route in this router
  router.use(authMiddleware);

  // -------------------------------------------------------------------------
  // POST /api/admin/products
  // -------------------------------------------------------------------------
  router.post('/', async (req, res, next) => {
    try {
      const { name, description, basePrice, slug, category } = req.body;

      if (!name || typeof name !== 'string') {
        return res.status(400).json({ error: 'name is required.' });
      }
      if (basePrice === undefined || basePrice === null) {
        return res.status(400).json({ error: 'basePrice is required.' });
      }

      const product = await productService.createProduct({
        name,
        description,
        basePrice,
        slug,
        category,
      });

      return res.status(201).json({ product });
    } catch (err) {
      // Re-map known validation errors to 400
      if (err.message && err.message.includes('basePrice must be')) {
        return res.status(400).json({ error: err.message });
      }
      next(err);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/admin/products
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
  // GET /api/admin/products/:id
  // -------------------------------------------------------------------------
  router.get('/:id', async (req, res, next) => {
    try {
      const product = await productService.getProductById(req.params.id);
      if (!product) {
        return res.status(404).json({ error: `Product not found: ${req.params.id}` });
      }
      return res.status(200).json({ product });
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------------
  // PUT /api/admin/products/:id
  // -------------------------------------------------------------------------
  router.put('/:id', async (req, res, next) => {
    try {
      const updates = req.body;
      if (!updates || Object.keys(updates).length === 0) {
        return res.status(400).json({ error: 'No update fields provided.' });
      }

      const product = await productService.updateProduct(req.params.id, updates);
      return res.status(200).json({ product });
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        return res.status(404).json({ error: `Product not found: ${req.params.id}` });
      }
      next(err);
    }
  });

  // -------------------------------------------------------------------------
  // DELETE /api/admin/products/:id
  // -------------------------------------------------------------------------
  router.delete('/:id', async (req, res, next) => {
    try {
      await productService.deleteProduct(req.params.id);
      return res.status(204).send();
    } catch (err) {
      if (err.name === 'ConditionalCheckFailedException') {
        return res.status(404).json({ error: `Product not found: ${req.params.id}` });
      }
      next(err);
    }
  });

  return router;
}

module.exports = { createAdminProductRouter };
