'use strict';

const { Router } = require('express');
const { QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { requireGroup } = require('../middleware/authorization');

function createCustomerOrdersRouter(jwtAuthMiddleware, documentClient, ordersTable) {
  const router = Router();
  const requireCustomer = requireGroup('customer');

  router.get('/', jwtAuthMiddleware, requireCustomer, async (req, res) => {
    try {
      const email = req.auth && typeof req.auth.email === 'string'
        ? req.auth.email.trim().toLowerCase()
        : '';

      if (!email) {
        return res.status(400).json({
          error: 'A verified customer email claim is required.',
          code: 'MISSING_CLAIMS',
        });
      }

      const result = await documentClient.send(new QueryCommand({
        TableName: ordersTable,
        KeyConditionExpression: 'email = :email',
        ExpressionAttributeValues: { ':email': email },
        ScanIndexForward: false,
      }));

      return res.json({
        orders: result.Items || [],
        count: result.Count || 0,
      });
    } catch (error) {
      return res.status(500).json({ error: 'Server error' });
    }
  });

  return router;
}

module.exports = { createCustomerOrdersRouter };
