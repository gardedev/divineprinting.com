'use strict';

const express = require('express');
const serverlessExpress = require('@codegenie/serverless-express');
const productService = require('./products/productService');
const { createCartRouter } = require('./api/cartApi');
const { jwtAuth } = require('./middleware/jwtAuth');

// Task 5.4 production boundary: health and cart APIs only. ProductService is
// consumed internally for trusted catalog validation/pricing; admin, account,
// customer, order, design, webhook, and catalog mutation routes are not mounted.
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '256kb' }));
app.get('/api/cart-health', (_req, res) => res.status(200).json({ status: 'ok', service: 'divine-printing-cart-api' }));
app.use('/api/carts', createCartRouter({ jwtAuthMiddleware: jwtAuth, productService }));
app.use((err, _req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'The cart request is too large.', code: 'CART_ITEM_TOO_LARGE' });
  if (err instanceof SyntaxError && err.status === 400) return res.status(400).json({ error: 'The request JSON is invalid.', code: 'CART_INVALID_INPUT' });
  return next(err);
});

exports.app = app;
exports.handler = serverlessExpress({ app });
