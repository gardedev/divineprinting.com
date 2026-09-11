'use strict';

const serverlessExpress = require('@codegenie/serverless-express');
const { createCheckoutApp } = require('./checkoutApp');
const { createCheckoutService } = require('./services/checkoutService');
const { createOrderService } = require('./services/orderService');
const { createStripeCheckoutClient } = require('./integrations/stripeCheckoutClient');
const { createStripeSecretProvider } = require('./integrations/stripeSecretProvider');
const { createStripeWebhookSecretProvider } = require('./integrations/stripeWebhookSecretProvider');
const { createStripeWebhookValidator } = require('./integrations/stripeWebhookValidator');
const { jwtAuth } = require('./middleware/jwtAuth');

const stripeClient = createStripeCheckoutClient({
  secretProvider: createStripeSecretProvider(),
  config: {
    successUrl: process.env.CHECKOUT_SUCCESS_URL,
    cancelUrl: process.env.CHECKOUT_CANCEL_URL,
    taxEnabled: process.env.STRIPE_TAX_ENABLED === 'true',
  },
});
const checkoutService = createCheckoutService({ stripeClient });
const orderService = createOrderService();
const webhookValidator = createStripeWebhookValidator({
  secretProvider: createStripeWebhookSecretProvider(),
});
const app = createCheckoutApp({ checkoutService, orderService, webhookValidator, jwtAuthMiddleware: jwtAuth });
const handler = serverlessExpress({ app });

module.exports = { handler };
