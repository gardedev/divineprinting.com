/**
 * Divine Printing account API.
 *
 * API Gateway verifies Cognito access-token signatures through its JWT
 * authorizer. This Lambda accepts identity only from the verified authorizer
 * claims and performs defense-in-depth Cognito claim checks before accessing
 * customer data.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';

const defaultDdb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

function authFailure(statusCode, code, error) {
  return { ok: false, response: respond(statusCode, { error, code }) };
}

/**
 * Reads identity exclusively from API Gateway's verified JWT authorizer.
 * Raw Authorization headers and client-supplied identity are never inspected.
 */
export function getTrustedIdentity(event, env = process.env, nowSeconds = Math.floor(Date.now() / 1000)) {
  const claims = event.requestContext?.authorizer?.jwt?.claims;
  if (!claims) {
    return authFailure(401, 'MISSING_TOKEN', 'A valid Cognito access token is required.');
  }

  const expectedIssuer = env.COGNITO_ISSUER;
  const expectedClientId = env.COGNITO_CLIENT_ID;

  if (!expectedIssuer || !expectedClientId) {
    return authFailure(500, 'AUTH_CONFIGURATION_ERROR', 'Authentication is unavailable.');
  }
  if (claims.iss !== expectedIssuer) {
    return authFailure(403, 'INVALID_ISSUER', 'Token issuer is invalid.');
  }
  if (claims.client_id !== expectedClientId) {
    return authFailure(403, 'INVALID_CLIENT_ID', 'Token client is invalid.');
  }
  if (claims.token_use !== 'access') {
    return authFailure(403, 'INVALID_TOKEN_USE', 'An access token is required.');
  }
  if (!claims.exp || Number(claims.exp) <= nowSeconds) {
    return authFailure(401, 'TOKEN_EXPIRED', 'Token has expired.');
  }
  if (!claims.sub || typeof claims.email !== 'string' || !claims.email.trim()) {
    return authFailure(403, 'MISSING_CLAIMS', 'Required identity claims are missing.');
  }

  return {
    ok: true,
    identity: {
      sub: claims.sub,
      email: claims.email.trim().toLowerCase(),
    },
  };
}

export function createHandler({
  ddb = defaultDdb,
  env = process.env,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  const ordersTable = env.ORDERS_TABLE || 'divine-printing-orders';
  const customersTable = env.CUSTOMERS_TABLE || 'divine-printing-customers';

  return async function accountApiHandler(event) {
    if (event.requestContext?.http?.method === 'OPTIONS') {
      return respond(200, {});
    }

    const auth = getTrustedIdentity(event, env, now());
    if (!auth.ok) return auth.response;

    const routeKey = event.routeKey || event.requestContext?.http?.path || '';
    if (routeKey.includes('/account/orders')) {
      return getOrders(ddb, ordersTable, auth.identity.email);
    }
    if (routeKey.includes('/account/profile')) {
      return getProfile(ddb, customersTable, auth.identity.email);
    }
    return respond(404, { error: 'Not found' });
  };
}

async function getOrders(ddb, ordersTable, email) {
  try {
    const result = await ddb.send(new QueryCommand({
      TableName: ordersTable,
      IndexName: 'CustomerEmailIndex',
      KeyConditionExpression: 'customerEmail = :email',
      ExpressionAttributeValues: { ':email': email },
      ScanIndexForward: false,
    }));

    const orders = (result.Items || []).map(order => ({
      orderId: order.orderId,
      items: order.items || [],
      subtotal: order.subtotal,
      taxesTotal: order.taxesTotal,
      shippingTotal: order.shippingTotal,
      total: order.total,
      currency: order.currency,
      status: order.status,
      shippingAddress: order.shippingAddress || {},
      createdAt: order.createdAt,
    }));

    const totalSpent = orders.reduce((sum, order) => sum + (order.total || 0), 0);
    return respond(200, {
      orders,
      summary: {
        totalOrders: orders.length,
        totalSpent: Math.round(totalSpent * 100) / 100,
      },
    });
  } catch (_error) {
    return respond(500, { error: 'Failed to fetch orders' });
  }
}

async function getProfile(ddb, customersTable, email) {
  try {
    const result = await ddb.send(new GetCommand({
      TableName: customersTable,
      Key: { email },
    }));

    if (!result.Item) return respond(404, { error: 'Customer not found' });

    return respond(200, {
      customer: {
        email: result.Item.email,
        name: result.Item.name || '',
        orderCount: result.Item.orderCount || 0,
        createdAt: result.Item.createdAt || '',
        lastOrderAt: result.Item.lastOrderAt || '',
      },
    });
  } catch (_error) {
    return respond(500, { error: 'Failed to fetch profile' });
  }
}

export const handler = createHandler();
