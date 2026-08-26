'use strict';
const express = require('express'); const request = require('supertest');
jest.mock('../../middleware/authorization', () => ({ requireGroup: () => (_req, _res, next) => next() }));
const { createCheckoutRouter } = require('../checkoutApi');
function appFor(service) { const app = express(); app.use(express.json()); app.use('/api/checkout', createCheckoutRouter({ checkoutService: service, jwtAuthMiddleware: (req, _res, next) => { req.auth = { sub: 'trusted-sub', emailVerified: true }; next(); } })); return app; }
describe('checkoutApi', () => {
  test('accepts only transport fields and returns safe hosted URL response', async () => {
    const service = { startCheckout: jest.fn().mockResolvedValue({ orderId: 'o1', checkoutUrl: 'https://checkout.stripe.com/x', expiresAt: 123 }) };
    const response = await request(appFor(service)).post('/api/checkout/session').set('Idempotency-Key', 'checkout-key').set('If-Match', '4').send({});
    expect(response.status).toBe(201); expect(service.startCheckout).toHaveBeenCalledWith(expect.objectContaining({ auth: expect.objectContaining({ sub: 'trusted-sub' }), expectedCartVersion: 4 }));
  });
  test('rejects browser authority and redirect fields', async () => {
    const service = { startCheckout: jest.fn() };
    const response = await request(appFor(service)).post('/api/checkout/session').set('Idempotency-Key', 'checkout-key').set('If-Match', '4').send({ customerId: 'spoof', success_url: 'https://evil.test' });
    expect(response.status).toBe(400); expect(service.startCheckout).not.toHaveBeenCalled();
  });
  test('maps unexpected/provider errors without exposing details', async () => {
    const service = { startCheckout: jest.fn().mockRejectedValue(new Error('sk_live_secret provider response')) };
    const response = await request(appFor(service)).post('/api/checkout/session').set('Idempotency-Key', 'checkout-key').set('If-Match', '4').send({});
    expect(response.status).toBe(500); expect(JSON.stringify(response.body)).not.toContain('sk_live');
  });
});
