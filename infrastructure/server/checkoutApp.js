'use strict';

const express = require('express');
const { createCheckoutRouter } = require('./api/checkoutApi');
const { createOrderHistoryRouter } = require('./api/orderHistoryApi');

function createCheckoutApp({ checkoutService, orderService, webhookValidator, jwtAuthMiddleware } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({
    limit: '32kb',
    type: (req) => req.path !== '/api/checkout/webhook' && Boolean(req.is('application/json')),
  }));
  app.use('/api/checkout', createCheckoutRouter({ checkoutService, webhookValidator, jwtAuthMiddleware }));
  app.use('/api/orders', createOrderHistoryRouter({ orderService, jwtAuthMiddleware }));
  app.use((_req, res) => res.status(404).json({ code: 'NOT_FOUND', error: 'Not found.' }));
  return app;
}

module.exports = { createCheckoutApp };
