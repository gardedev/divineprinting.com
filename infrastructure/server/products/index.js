// products/index.js
// Product routes — mounted at /api/admin/products in server.js.
// Placeholder routes defined here; full CRUD will be implemented in Task 2.2+.

const express = require('express');
const router = express.Router();

// GET /api/admin/products
// List all products (placeholder — returns empty array until Task 2.2 implements it).
router.get('/', (req, res) => {
  res.json({ products: [], message: 'Product listing not yet implemented.' });
});

// GET /api/admin/products/:productId
// Fetch a single product by ID (placeholder).
router.get('/:productId', (req, res) => {
  res.json({ product: null, message: 'Single-product fetch not yet implemented.' });
});

// POST /api/admin/products
// Create a new product (placeholder).
router.post('/', (req, res) => {
  res.status(501).json({ message: 'Product creation not yet implemented.' });
});

// PUT /api/admin/products/:productId
// Update an existing product (placeholder).
router.put('/:productId', (req, res) => {
  res.status(501).json({ message: 'Product update not yet implemented.' });
});

// DELETE /api/admin/products/:productId
// Delete a product (placeholder).
router.delete('/:productId', (req, res) => {
  res.status(501).json({ message: 'Product deletion not yet implemented.' });
});

module.exports = router;
