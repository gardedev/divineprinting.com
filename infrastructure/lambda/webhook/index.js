/**
 * Divine Printing — Snipcart Webhook Handler
 *
 * Listens for `order.completed` events from Snipcart, stores order data
 * in DynamoDB (orders + customers tables), and optionally sends a
 * notification email via SES.
 *
 * AWS SDK v3 — runs on Node.js 20.x Lambda runtime.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { createHmac } from 'node:crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const ORDERS_TABLE    = process.env.ORDERS_TABLE    || 'divine-printing-orders';
const CUSTOMERS_TABLE = process.env.CUSTOMERS_TABLE || 'divine-printing-customers';
const SNIPCART_SECRET = process.env.SNIPCART_SECRET_KEY || '';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a standard HTTP response */
function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

/**
 * Validate the Snipcart webhook request header.
 * Snipcart sends `x-snipcart-requesttoken` which we can validate
 * against their API, but the simpler approach for now is to accept
 * requests that carry a valid token format and optionally compare
 * against a shared secret header.
 */
function validateWebhook(event) {
  // If no secret configured, skip validation (dev mode)
  if (!SNIPCART_SECRET) return true;

  // Snipcart v3 sends the request token in this header
  const token = event.headers?.['x-snipcart-requesttoken']
             || event.headers?.['X-Snipcart-RequestToken']
             || '';

  // For production, you should validate this token against
  // https://app.snipcart.com/api/requestvalidation/{token}
  // For now, we check that a token is present
  return token.length > 0;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(event) {
  console.log('Webhook received:', JSON.stringify(event.headers));

  // Validate
  if (!validateWebhook(event)) {
    console.warn('Invalid webhook request — missing/bad token');
    return respond(401, { error: 'Unauthorized' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return respond(400, { error: 'Invalid JSON body' });
  }

  const eventName = body.eventName || '';
  console.log('Event:', eventName);

  // Only process order.completed
  if (eventName !== 'order.completed') {
    return respond(200, { message: `Ignored event: ${eventName}` });
  }

  const order = body.content || {};

  try {
    await Promise.all([
      storeOrder(order),
      upsertCustomer(order),
    ]);

    const orderId = order.invoiceNumber || order.token || 'unknown';
    console.log(`Order ${orderId} stored successfully`);

    return respond(200, {
      message: 'Order processed',
      orderId,
    });
  } catch (err) {
    console.error('Error processing order:', err);
    return respond(500, { error: 'Internal error processing order' });
  }
}

// ---------------------------------------------------------------------------
// DynamoDB writes
// ---------------------------------------------------------------------------

async function storeOrder(order) {
  const orderId       = order.invoiceNumber || order.token;
  const user          = order.user || {};
  const customerEmail = (user.email || '').toLowerCase().trim();
  const createdAt     = order.completionDate || new Date().toISOString();

  // Build items array — keep only the fields the dashboard needs
  const items = (order.items || []).map((item) => ({
    name:        item.name,
    description: item.description || '',
    quantity:    item.quantity,
    unitPrice:   item.unitPrice,
    totalPrice:  item.totalPrice,
    image:       item.image || '',
    id:          item.id,
    customFields: item.customFields || [],
  }));

  const shippingAddress = order.shippingAddress || order.billingAddress || {};

  const record = {
    orderId,
    customerEmail,
    items,
    subtotal:        order.subtotal || 0,
    taxesTotal:      order.taxesTotal || 0,
    shippingTotal:   order.shippingFees || 0,
    total:           order.total || 0,
    currency:        order.currency || 'usd',
    status:          order.status || 'Processing',
    paymentStatus:   order.paymentStatus || '',
    shippingAddress: {
      name:    shippingAddress.fullName || shippingAddress.name || '',
      address1: shippingAddress.address1 || '',
      address2: shippingAddress.address2 || '',
      city:    shippingAddress.city || '',
      province: shippingAddress.province || '',
      postalCode: shippingAddress.postalCode || '',
      country: shippingAddress.country || '',
    },
    customerName:    `${user.firstName || ''} ${user.lastName || ''}`.trim(),
    createdAt,
    updatedAt:       new Date().toISOString(),
    rawSnipcartToken: order.token || '',
  };

  await ddb.send(new PutCommand({
    TableName: ORDERS_TABLE,
    Item: record,
  }));
}

async function upsertCustomer(order) {
  const user  = order.user || {};
  const email = (user.email || '').toLowerCase().trim();
  if (!email) return;

  const name = `${user.firstName || ''} ${user.lastName || ''}`.trim();
  const now  = new Date().toISOString();

  // Check if customer exists
  const existing = await ddb.send(new GetCommand({
    TableName: CUSTOMERS_TABLE,
    Key: { email },
  }));

  if (existing.Item) {
    // Update last order date + increment order count
    await ddb.send(new UpdateCommand({
      TableName: CUSTOMERS_TABLE,
      Key: { email },
      UpdateExpression: 'SET #name = :name, lastOrderAt = :now, updatedAt = :now ADD orderCount :one',
      ExpressionAttributeNames: { '#name': 'name' },
      ExpressionAttributeValues: {
        ':name': name || existing.Item.name,
        ':now':  now,
        ':one':  1,
      },
    }));
  } else {
    await ddb.send(new PutCommand({
      TableName: CUSTOMERS_TABLE,
      Item: {
        email,
        name,
        orderCount: 1,
        createdAt: now,
        updatedAt: now,
        lastOrderAt: now,
      },
    }));
  }
}
