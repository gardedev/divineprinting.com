// Snipcart webhook handler - captures orders to DynamoDB
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const CUSTOMERS_TABLE = process.env.CUSTOMERS_TABLE || 'divine-printing-customers';
const ORDERS_TABLE = process.env.ORDERS_TABLE || 'divine-printing-orders';

exports.handler = async (event) => {
  console.log('Webhook received:', JSON.stringify(event, null, 2));

  // Verify it's a POST request
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const body = JSON.parse(event.body);
    const { eventName, content } = body;

    // Only process completed orders
    if (eventName !== 'order.completed') {
      return { statusCode: 200, body: JSON.stringify({ message: 'Event ignored' }) };
    }

    const order = content;
    const email = order.email?.toLowerCase();
    
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No email in order' }) };
    }

    // Extract customer info
    const customerName = order.billingAddress?.name || order.shippingAddress?.name || 'Customer';
    
    // Create or update customer
    const customerItem = {
      email: email,
      customerId: order.customerId || crypto.randomUUID(),
      name: customerName,
      updatedAt: new Date().toISOString(),
    };

    // Only set createdAt if new customer
    if (!order.customerId) {
      customerItem.createdAt = new Date().toISOString();
    }

    await docClient.send(new PutCommand({
      TableName: CUSTOMERS_TABLE,
      Item: customerItem,
    }));

    // Store order
    const orderItem = {
      email: email,
      orderId: order.token,
      invoiceNumber: order.invoiceNumber,
      total: order.total,
      items: order.items.map(item => ({
        name: item.name,
        quantity: item.quantity,
        price: item.price,
        customFields: item.customFields || [],
      })),
      status: order.status,
      createdAt: order.creationDate || new Date().toISOString(),
      shippingAddress: order.shippingAddress,
      billingAddress: order.billingAddress,
    };

    await docClient.send(new PutCommand({
      TableName: ORDERS_TABLE,
      Item: orderItem,
    }));

    console.log('Order saved:', order.token);

    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: JSON.stringify({ success: true, orderId: order.token }),
    };

  } catch (error) {
    console.error('Error processing webhook:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal server error', message: error.message }),
    };
  }
};
