'use strict';

jest.mock('../../middleware/jwtAuth', () => ({ jwtAuth: (_req, res) => res.status(401).json({ code: 'UNAUTHORIZED' }) }));
jest.mock('../../products/productRepository', () => ({ getProductById: jest.fn() }));
jest.mock('../../carts/cartService', () => ({
  createCartService: () => ({
    createCart: jest.fn().mockResolvedValue({ cartId: 'cart-1', cartType: 'anonymous', status: 'draft', currency: 'USD', version: 1 }),
  }),
}));

const request = require('supertest');
const { app } = require('../../lambda-cart');

describe('isolated cart Lambda Express boundary', () => {
  test('exposes health and anonymous cart routes', async () => {
    await request(app).get('/api/cart-health').expect(200, { status: 'ok', service: 'divine-printing-cart-api' });
    await request(app).post('/api/carts/anonymous').expect(201).expect(({ body }) => {
      expect(body.cart.cartId).toBe('cart-1');
      expect(body.cartToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    });
  });

  test('does not expose unrelated application boundaries', async () => {
    await request(app).get('/api/products').expect(404);
    await request(app).get('/api/admin/session').expect(404);
    await request(app).post('/api/customers/bootstrap').expect(404);
    await request(app).get('/api/orders').expect(404);
    await request(app).post('/api/webhook/snipcart').expect(404);
  });
});
