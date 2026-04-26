/**
 * Divine Printing — Account API
 *
 * Authenticated endpoints for customers to fetch their orders and profile.
 * Expects Authorization: Bearer <sessionToken> header.
 *
 * Routes (via API Gateway):
 *   GET /account/orders  — list customer orders
 *   GET /account/profile — get customer profile
 *
 * AWS SDK v3 — Node.js 20.x
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, QueryCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { createHmac } from 'node:crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const ORDERS_TABLE      = process.env.ORDERS_TABLE      || 'divine-printing-orders';
const CUSTOMERS_TABLE   = process.env.CUSTOMERS_TABLE   || 'divine-printing-customers';
const MAGIC_LINK_SECRET = process.env.MAGIC_LINK_SECRET || '';

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

/**
 * Verify the session token from Authorization header.
 * Returns { email, exp } or null.
 */
function verifySession(event) {
  const authHeader = event.headers?.authorization || event.headers?.Authorization || '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!token || !token.includes('.')) return null;

  const [payload, sig] = token.split('.');
  const expectedSig = createHmac('sha256', MAGIC_LINK_SECRET).update(payload).digest('hex');

  if (sig !== expectedSig) return null;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

export async function handler(event) {
  // Handle CORS preflight
  if (event.requestContext?.http?.method === 'OPTIONS') {
    return respond(200, {});
  }

  // Authenticate
  const session = verifySession(event);
  if (!session) {
    return respond(401, { error: 'Unauthorized — please sign in' });
  }

  const email = session.email;
  const routeKey = event.routeKey || event.requestContext?.http?.path || '';

  // Route: GET /account/orders
  if (routeKey.includes('/account/orders')) {
    return await getOrders(email);
  }

  // Route: GET /account/profile
  if (routeKey.includes('/account/profile')) {
    return await getProfile(email);
  }

  return respond(404, { error: 'Not found' });
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function getOrders(email) {
  try {
    const result = await ddb.send(new QueryCommand({
      TableName: ORDERS_TABLE,
      IndexName: 'CustomerEmailIndex',
      KeyConditionExpression: 'customerEmail = :email',
      ExpressionAttributeValues: { ':email': email },
      ScanIndexForward: false, // newest first
    }));

    const orders = (result.Items || []).map((order) => ({
      orderId:       order.orderId,
      items:         order.items || [],
      subtotal:      order.subtotal,
      taxesTotal:    order.taxesTotal,
      shippingTotal: order.shippingTotal,
      total:         order.total,
      currency:      order.currency,
      status:        order.status,
      shippingAddress: order.shippingAddress || {},
      createdAt:     order.createdAt,
    }));

    // Compute summary stats
    const totalSpent = orders.reduce((sum, o) => sum + (o.total || 0), 0);

    return respond(200, {
      orders,
      summary: {
        totalOrders: orders.length,
        totalSpent: Math.round(totalSpent * 100) / 100,
      },
    });
  } catch (err) {
    console.error('Error fetching orders:', err);
    return respond(500, { error: 'Failed to fetch orders' });
  }
}

async function getProfile(email) {
  try {
    const result = await ddb.send(new GetCommand({
      TableName: CUSTOMERS_TABLE,
      Key: { email },
    }));

    if (!result.Item) {
      return respond(404, { error: 'Customer not found' });
    }

    return respond(200, {
      customer: {
        email:      result.Item.email,
        name:       result.Item.name || '',
        orderCount: result.Item.orderCount || 0,
        createdAt:  result.Item.createdAt || '',
        lastOrderAt: result.Item.lastOrderAt || '',
      },
    });
  } catch (err) {
    console.error('Error fetching profile:', err);
    return respond(500, { error: 'Failed to fetch profile' });
  }
}
