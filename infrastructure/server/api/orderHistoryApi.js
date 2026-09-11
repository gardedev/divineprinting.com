'use strict';

const { Router } = require('express');
const { jwtAuth } = require('../middleware/jwtAuth');
const { requireGroup } = require('../middleware/authorization');

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;

function parseLimit(value) {
  if (value === undefined) return DEFAULT_PAGE_SIZE;
  if (!/^\d+$/.test(String(value))) return null;
  const limit = Number(value);
  return Number.isInteger(limit) && limit >= 1 && limit <= MAX_PAGE_SIZE ? limit : null;
}

function encodeCursor(key) {
  if (!key) return null;
  return Buffer.from(JSON.stringify(key), 'utf8').toString('base64url');
}

function decodeCursor(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value || value.length > 2048 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError('invalid cursor');
  }
  const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded) ||
      Object.keys(decoded).some((key) => !['customerId', 'createdAt', 'orderId'].includes(key)) ||
      !['customerId', 'createdAt', 'orderId'].every((key) => typeof decoded[key] === 'string' && decoded[key])) {
    throw new TypeError('invalid cursor');
  }
  return decoded;
}

function publicOrderSummary(order) {
  return {
    orderId: order.orderId,
    orderNumber: order.orderNumber,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    orderState: order.orderState,
    paymentState: order.paymentState,
    currency: order.currency,
    itemCount: order.itemCount,
    subtotalCents: order.subtotalCents,
    discountTotalCents: order.discountTotalCents,
    shippingCents: order.shippingCents,
    taxCents: order.taxCents,
    totalCents: order.totalCents,
  };
}

function createOrderHistoryRouter({ orderService, jwtAuthMiddleware = jwtAuth } = {}) {
  if (!orderService) throw new TypeError('orderService is required');
  const router = Router();

  router.get('/', jwtAuthMiddleware, requireGroup('customer'), async (req, res) => {
    try {
      const limit = parseLimit(req.query.limit);
      if (limit === null) {
        return res.status(400).json({ code: 'ORDER_PAGINATION_INVALID', error: 'Pagination is invalid.' });
      }
      const exclusiveStartKey = decodeCursor(req.query.cursor);
      if (exclusiveStartKey && exclusiveStartKey.customerId !== req.auth?.sub) {
        return res.status(400).json({ code: 'ORDER_PAGINATION_INVALID', error: 'Pagination is invalid.' });
      }
      const result = await orderService.listOwnOrders({
        auth: req.auth,
        pagination: { limit, ...(exclusiveStartKey ? { exclusiveStartKey } : {}) },
      });
      const orders = (result.orders || []).map(publicOrderSummary);
      return res.status(200).json({
        orders,
        count: orders.length,
        nextCursor: encodeCursor(result.lastEvaluatedKey),
      });
    } catch (error) {
      if (error instanceof SyntaxError || error instanceof TypeError || error?.code === 'ORDER_PAGINATION_INVALID') {
        return res.status(400).json({ code: 'ORDER_PAGINATION_INVALID', error: 'Pagination is invalid.' });
      }
      if (error?.code === 'ORDER_AUTH_REQUIRED') {
        return res.status(401).json({ code: 'ORDER_AUTH_REQUIRED', error: 'Authentication is required.' });
      }
      return res.status(503).json({ code: 'ORDER_READ_FAILED', error: 'Order history is temporarily unavailable.' });
    }
  });

  return router;
}

module.exports = {
  createOrderHistoryRouter,
  decodeCursor,
  encodeCursor,
  publicOrderSummary,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
};
