'use strict';

const request = require('supertest');
jest.mock('../../middleware/authorization', () => ({ requireGroup: () => (_req, _res, next) => next() }));
const { createCheckoutApp } = require('../../checkoutApp');

function appFor(orderService, auth = { sub: 'customer-sub' }) {
  return createCheckoutApp({
    checkoutService: { startCheckout: jest.fn(), handleWebhookEvent: jest.fn() },
    orderService,
    jwtAuthMiddleware: (req, _res, next) => { req.auth = auth; next(); },
  });
}

describe('customer order history API', () => {
  test('lists only the authenticated customer orders newest-first through the service', async () => {
    const orderService = { listOwnOrders: jest.fn().mockResolvedValue({
      orders: [{
        orderId: 'order-1', orderNumber: 'DP-1001', customerId: 'customer-sub',
        contactSnapshot: { email: 'private@example.test' }, createdAt: '2026-09-11T12:00:00.000Z',
        orderState: 'submitted', paymentState: 'paid', currency: 'USD', itemCount: 2, totalCents: 2500,
        stripeCheckoutSessionId: 'cs_private', idempotencyKey: 'private-key',
      }],
      lastEvaluatedKey: { customerId: 'customer-sub', createdAt: '2026-09-11T12:00:00.000Z', orderId: 'order-1' },
    }) };
    const response = await request(appFor(orderService)).get('/api/orders?limit=10');
    expect(response.status).toBe(200);
    expect(orderService.listOwnOrders).toHaveBeenCalledWith({ auth: { sub: 'customer-sub' }, pagination: { limit: 10 } });
    expect(response.body.orders).toEqual([expect.objectContaining({ orderId: 'order-1', orderNumber: 'DP-1001', totalCents: 2500 })]);
    expect(JSON.stringify(response.body)).not.toContain('private@example.test');
    expect(JSON.stringify(response.body)).not.toContain('cs_private');
    expect(response.body.nextCursor).toEqual(expect.any(String));
  });

  test('passes an opaque continuation cursor without accepting customer authority fields', async () => {
    const orderService = { listOwnOrders: jest.fn().mockResolvedValue({ orders: [] }) };
    const key = { customerId: 'customer-sub', createdAt: '2026-09-11T12:00:00.000Z', orderId: 'order-1' };
    const cursor = Buffer.from(JSON.stringify(key)).toString('base64url');
    const response = await request(appFor(orderService)).get(`/api/orders?cursor=${cursor}`);
    expect(response.status).toBe(200);
    expect(orderService.listOwnOrders).toHaveBeenCalledWith({ auth: { sub: 'customer-sub' }, pagination: { limit: 20, exclusiveStartKey: key } });
  });

  test.each(['/api/orders?limit=0', '/api/orders?limit=51', '/api/orders?limit=ten', '/api/orders?cursor=%%%'])('rejects invalid pagination safely: %s', async (path) => {
    const orderService = { listOwnOrders: jest.fn() };
    const response = await request(appFor(orderService)).get(path);
    expect(response.status).toBe(400);
    expect(orderService.listOwnOrders).not.toHaveBeenCalled();
  });

  test('rejects a continuation cursor for another customer', async () => {
    const orderService = { listOwnOrders: jest.fn() };
    const cursor = Buffer.from(JSON.stringify({ customerId: 'other-customer', createdAt: '2026-09-11T12:00:00.000Z', orderId: 'order-1' })).toString('base64url');
    const response = await request(appFor(orderService)).get(`/api/orders?cursor=${cursor}`);
    expect(response.status).toBe(400);
    expect(orderService.listOwnOrders).not.toHaveBeenCalled();
  });

  test('maps persistence failures without exposing sensitive details', async () => {
    const orderService = { listOwnOrders: jest.fn().mockRejectedValue(new Error('customer private@example.test token')) };
    const response = await request(appFor(orderService)).get('/api/orders');
    expect(response.status).toBe(503);
    expect(response.body).toEqual({ code: 'ORDER_READ_FAILED', error: 'Order history is temporarily unavailable.' });
  });
});
