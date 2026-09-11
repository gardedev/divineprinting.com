'use strict';
const crypto = require('crypto'); const request = require('supertest');
jest.mock('../../middleware/authorization', () => ({ requireGroup: () => (_req, _res, next) => next() }));
const serverlessExpress = require('@codegenie/serverless-express');
const { createCheckoutApp } = require('../../checkoutApp');
const { verifyWebhookSignature } = require('../../integrations/stripeWebhookValidator');
const secret = 'whsec_test_only_not_a_real_secret';
function appFor(service, webhookValidator) { return createCheckoutApp({ checkoutService: service, orderService: { listOwnOrders: jest.fn() }, webhookValidator, jwtAuthMiddleware: (req, _res, next) => { req.auth = { sub: 'trusted-sub', emailVerified: true }; next(); } }); }
function signed(body, timestamp = 1770000000) { return `t=${timestamp},v1=${crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`; }
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
  test('preserves plain webhook bytes while normal JSON routes still parse', async () => {
    const raw = '{"id":"evt_plain","type":"checkout.session.completed", "data":{"object":{}}}';
    const service = { startCheckout: jest.fn(), handleWebhookEvent: jest.fn().mockResolvedValue({ handled: true }) };
    const validator = { verify: jest.fn(async (body, header) => verifyWebhookSignature({ rawBody: body, signatureHeader: header, secret, now: () => 1770000000 })) };
    const response = await request(appFor(service, validator)).post('/api/checkout/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', signed(raw)).send(raw);
    expect(response.status).toBe(200);
    expect(validator.verify.mock.calls[0][0]).toEqual(Buffer.from(raw));
    expect(service.handleWebhookEvent).toHaveBeenCalledWith({ event: expect.objectContaining({ id: 'evt_plain' }) });
  });
  test('rejects invalid signatures and malformed signed JSON', async () => {
    const service = { startCheckout: jest.fn(), handleWebhookEvent: jest.fn() };
    const validator = { verify: jest.fn(async (body, header) => verifyWebhookSignature({ rawBody: body, signatureHeader: header, secret, now: () => 1770000000 })) };
    const invalid = await request(appFor(service, validator)).post('/api/checkout/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', 't=1770000000,v1=deadbeef').send('{}');
    const malformedBody = '{not-json';
    const malformed = await request(appFor(service, validator)).post('/api/checkout/webhook').set('Content-Type', 'application/json').set('Stripe-Signature', signed(malformedBody)).send(malformedBody);
    expect(invalid.status).toBe(400);
    expect(malformed.status).toBe(400);
    expect(service.handleWebhookEvent).not.toHaveBeenCalled();
  });
  test('decodes an HTTP API v2 base64 body exactly once', async () => {
    const raw = '{"id":"evt_base64","type":"checkout.session.completed","data":{"object":{}}}';
    const service = { startCheckout: jest.fn(), handleWebhookEvent: jest.fn().mockResolvedValue({ handled: true }) };
    const validator = { verify: jest.fn(async (body, header) => verifyWebhookSignature({ rawBody: body, signatureHeader: header, secret, now: () => 1770000000 })) };
    const handler = serverlessExpress({ app: appFor(service, validator) });
    const response = await handler({ version: '2.0', routeKey: 'POST /api/checkout/webhook', rawPath: '/api/checkout/webhook', rawQueryString: '', headers: { 'content-type': 'application/json', 'stripe-signature': signed(raw) }, requestContext: { http: { method: 'POST', path: '/api/checkout/webhook', protocol: 'HTTP/1.1', sourceIp: '127.0.0.1', userAgent: 'jest' }, requestId: 'request-1', stage: '$default', timeEpoch: 1770000000000 }, body: Buffer.from(raw).toString('base64'), isBase64Encoded: true }, {});
    expect(response.statusCode).toBe(200);
    expect(validator.verify.mock.calls[0][0]).toEqual(Buffer.from(raw));
  });
});
