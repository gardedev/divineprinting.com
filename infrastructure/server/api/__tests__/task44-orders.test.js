'use strict';

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  QueryCommand: jest.fn().mockImplementation(input => ({ input })),
}));

const express = require('express');
const request = require('supertest');
const { createCustomerOrdersRouter } = require('../customerOrdersApi');

function authStub(mode = 'valid', groups = ['customer']) {
  return (req, res, next) => {
    if (mode === 'missing') return res.status(401).json({ code: 'MISSING_TOKEN' });
    if (mode === 'invalid') return res.status(403).json({ code: 'INVALID_SIGNATURE' });
    req.auth = {
      sub: 'trusted-sub', email: 'Trusted@Example.com', emailVerified: true, groups,
    };
    return next();
  };
}

function buildApp(mode, sendResult = { Items: [], Count: 0 }, groups = ['customer']) {
  const client = { send: jest.fn().mockResolvedValue(sendResult) };
  const app = express();
  app.use(express.json());
  app.use('/api/orders', createCustomerOrdersRouter(authStub(mode, groups), client, 'orders-table'));
  return { app, client };
}

describe('Task 4.4 customer orders JWT protection', () => {
  it('returns the existing compatible orders response for an authenticated customer', async () => {
    const orders = [{ orderId: 'order-1', total: 25 }];
    const { app } = buildApp('valid', { Items: orders, Count: 1 });
    const response = await request(app).get('/api/orders').set('Authorization', 'Bearer access-token');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ orders, count: 1 });
  });

  it('rejects a missing JWT', async () => {
    const { app, client } = buildApp('missing');
    const response = await request(app).get('/api/orders');
    expect(response.status).toBe(401);
    expect(client.send).not.toHaveBeenCalled();
  });

  it('rejects an invalid JWT', async () => {
    const { app, client } = buildApp('invalid');
    const response = await request(app).get('/api/orders').set('Authorization', 'Bearer invalid');
    expect(response.status).toBe(403);
    expect(client.send).not.toHaveBeenCalled();
  });

  it('uses trusted JWT email and ignores client-supplied identity', async () => {
    const { app, client } = buildApp('valid');
    await request(app)
      .get('/api/orders?email=attacker@example.com')
      .send({ email: 'body-attacker@example.com', customerId: 'attacker' });
    const command = client.send.mock.calls[0][0];
    expect(command.input.ExpressionAttributeValues[':email']).toBe('trusted@example.com');
  });

  test.each([
    ['admin only', ['admin']],
    ['system only', ['system']],
    ['no groups', []],
    ['malformed groups', 'customer'],
  ])('denies %s from customer orders', async (_label, groups) => {
    const { app, client } = buildApp('valid', { Items: [], Count: 0 }, groups);
    const response = await request(app).get('/api/orders');
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('CUSTOMER_REQUIRED');
    expect(client.send).not.toHaveBeenCalled();
  });

  it('accepts admin plus customer without treating admin as customer', async () => {
    const { app } = buildApp('valid', { Items: [], Count: 0 }, ['admin', 'customer']);
    expect((await request(app).get('/api/orders')).status).toBe(200);
  });
});
