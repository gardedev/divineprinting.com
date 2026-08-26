'use strict';

const serverlessExpress = require('@codegenie/serverless-express');
const { createCheckoutApp } = require('./checkoutApp');
const { createCheckoutService } = require('./services/checkoutService');
const { createStripeCheckoutClient } = require('./integrations/stripeCheckoutClient');
const { jwtAuth } = require('./middleware/jwtAuth');

function requiredSecret() {
  const value = process.env.STRIPE_SECRET_KEY;
  if (typeof value !== 'string' || !value.startsWith('sk_')) throw new Error('Stripe secret configuration is unavailable.');
  return value;
}

const stripeClient = createStripeCheckoutClient({
  secretProvider: async () => requiredSecret(),
  config: {
    successUrl: process.env.CHECKOUT_SUCCESS_URL,
    cancelUrl: process.env.CHECKOUT_CANCEL_URL,
    taxEnabled: process.env.STRIPE_TAX_ENABLED === 'true',
  },
});
const checkoutService = createCheckoutService({ stripeClient });
const app = createCheckoutApp({ checkoutService, jwtAuthMiddleware: jwtAuth });
const handler = serverlessExpress({ app });

module.exports = { handler, requiredSecret };
