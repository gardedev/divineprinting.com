// Divine Printing API Server - Runs on Lightsail
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const app = express();
const PORT = process.env.PORT || 3000;

// AWS config - uses IAM role on Lightsail, or env vars locally
const client = new DynamoDBClient({ 
  region: process.env.AWS_REGION || 'us-east-1'
});
const docClient = DynamoDBDocumentClient.from(client);

const CUSTOMERS_TABLE = process.env.CUSTOMERS_TABLE || 'divine-printing-customers';
const ORDERS_TABLE = process.env.ORDERS_TABLE || 'divine-printing-orders';
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-key';

app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'divine-printing-api' });
});

// Simple hash function
function hashPassword(password) {
  return crypto.createHmac('sha256', JWT_SECRET).update(password).digest('hex');
}

function generateToken(email) {
  const payload = { email, exp: Date.now() + (7 * 24 * 60 * 60 * 1000) };
  return Buffer.from(JSON.stringify(payload)).toString('base64');
}

function verifyToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token, 'base64').toString());
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

// Register
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const existing = await docClient.send(new GetCommand({
      TableName: CUSTOMERS_TABLE,
      Key: { email: email.toLowerCase() },
    }));

    if (existing.Item && existing.Item.passwordHash) {
      return res.status(409).json({ error: 'Account already exists' });
    }

    const customer = {
      email: email.toLowerCase(),
      customerId: crypto.randomUUID(),
      name: name || 'Customer',
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await docClient.send(new PutCommand({
      TableName: CUSTOMERS_TABLE,
      Item: customer,
    }));

    res.status(201).json({ success: true, token: generateToken(email) });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    const result = await docClient.send(new GetCommand({
      TableName: CUSTOMERS_TABLE,
      Key: { email: email.toLowerCase() },
    }));

    const customer = result.Item;

    if (!customer || customer.passwordHash !== hashPassword(password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    res.json({ 
      success: true, 
      token: generateToken(email),
      customer: {
        email: customer.email,
        name: customer.name,
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Verify token
app.post('/api/auth/verify', async (req, res) => {
  try {
    const { token } = req.body;
    const payload = verifyToken(token);
    
    if (!payload) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    const result = await docClient.send(new GetCommand({
      TableName: CUSTOMERS_TABLE,
      Key: { email: payload.email },
    }));

    if (!result.Item) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json({ 
      valid: true,
      customer: {
        email: result.Item.email,
        name: result.Item.name,
      }
    });
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get orders
app.get('/api/orders', async (req, res) => {
  try {
    const email = req.query.email?.toLowerCase();
    
    if (!email) {
      return res.status(400).json({ error: 'Email required' });
    }

    const result = await docClient.send(new QueryCommand({
      TableName: ORDERS_TABLE,
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': email,
      },
      ScanIndexForward: false,
    }));

    res.json({ 
      orders: result.Items || [],
      count: result.Count || 0,
    });
  } catch (error) {
    console.error('Orders error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Snipcart webhook
app.post('/api/webhook/snipcart', async (req, res) => {
  try {
    const { eventName, content } = req.body;

    if (eventName !== 'order.completed') {
      return res.json({ message: 'Event ignored' });
    }

    const order = content;
    const email = order.email?.toLowerCase();
    
    if (!email) {
      return res.status(400).json({ error: 'No email in order' });
    }

    const customerName = order.billingAddress?.name || order.shippingAddress?.name || 'Customer';
    
    // Create/update customer
    const customerItem = {
      email: email,
      customerId: order.customerId || crypto.randomUUID(),
      name: customerName,
      updatedAt: new Date().toISOString(),
    };

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
    res.json({ success: true, orderId: order.token });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(PORT, () => {
  console.log(`Divine Printing API running on port ${PORT}`);
});
