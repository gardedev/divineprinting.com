'use strict';

const express = require('express');
const { createCheckoutRouter } = require('./api/checkoutApi');

function createCheckoutApp({ checkoutService, jwtAuthMiddleware } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.use('/api/checkout', createCheckoutRouter({ checkoutService, jwtAuthMiddleware }));
  app.use((_req, res) => res.status(404).json({ code: 'NOT_FOUND', error: 'Not found.' }));
  return app;
}

module.exports = { createCheckoutApp };
