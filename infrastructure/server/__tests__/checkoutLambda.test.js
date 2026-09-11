'use strict';

jest.mock('@codegenie/serverless-express', () => jest.fn(() => jest.fn()));
jest.mock('../integrations/stripeSecretProvider', () => ({ createStripeSecretProvider: jest.fn(() => jest.fn()) }));
jest.mock('../integrations/stripeWebhookSecretProvider', () => ({ createStripeWebhookSecretProvider: jest.fn(() => jest.fn()) }));
jest.mock('../integrations/stripeCheckoutClient', () => ({ createStripeCheckoutClient: jest.fn(() => ({ createSession: jest.fn() })) }));
jest.mock('../integrations/stripeWebhookValidator', () => ({ createStripeWebhookValidator: jest.fn(() => ({ verify: jest.fn() })) }));
jest.mock('../services/checkoutService', () => ({ createCheckoutService: jest.fn(() => ({ startCheckout: jest.fn(), handleWebhookEvent: jest.fn() })) }));
jest.mock('../services/orderService', () => ({ createOrderService: jest.fn(() => ({ listOwnOrders: jest.fn() })) }));
jest.mock('../checkoutApp', () => ({ createCheckoutApp: jest.fn(() => ({ app: true })) }));
jest.mock('../middleware/jwtAuth', () => ({ jwtAuth: jest.fn() }));

describe('checkout Lambda production wiring', () => {
  test('constructs and supplies the webhook validator to the application', () => {
    require('../checkoutLambda');
    const { createStripeWebhookSecretProvider } = require('../integrations/stripeWebhookSecretProvider');
    const { createStripeWebhookValidator } = require('../integrations/stripeWebhookValidator');
    const { createCheckoutApp } = require('../checkoutApp');
    expect(createStripeWebhookSecretProvider).toHaveBeenCalledTimes(1);
    expect(createStripeWebhookValidator).toHaveBeenCalledWith({ secretProvider: expect.any(Function) });
    expect(createCheckoutApp).toHaveBeenCalledWith(expect.objectContaining({ orderService: expect.objectContaining({ listOwnOrders: expect.any(Function) }), webhookValidator: expect.objectContaining({ verify: expect.any(Function) }) }));
  });
});
