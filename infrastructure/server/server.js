// Divine Printing API Server - Runs on Lightsail
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { GetCommand, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const logger = require('./utils/logger');

// Shared DynamoDB client (initialized once, reused across all modules)
const { docClient } = require('./utils/dynamoDbClient');

// Route modules
const productRoutes = require('./products/index');
const publicProductRoutes = require('./products/publicProductRoutes');

// Customer registration (Task 4.3)
const { createCustomerRegistrationRouter } = require('./api/customerRegistrationApi');
const { jwtAuth } = require('./middleware/jwtAuth');

const app = express();
const PORT = process.env.PORT || 3000;

const ORDERS_TABLE = process.env.ORDERS_TABLE || 'divine-printing-orders';

app.use(cors());
app.use(express.json());

// Product admin routes
app.use('/api/admin/products', productRoutes);

// Public product routes (unauthenticated)
app.use('/api/products', publicProductRoutes);

// Customer bootstrap route (JWT-protected via Cognito)
// IMPORTANT: This replaces the legacy /api/auth/register which has been removed.
// Identity is derived exclusively from the verified Cognito JWT; no passwords are
// accepted or stored.
app.use('/api/customers', createCustomerRegistrationRouter(jwtAuth));

// Legacy /api/auth/register endpoint has been permanently disabled.
// It previously accepted plaintext passwords and generated random UUIDs — both
// security anti-patterns. All customer creation now flows through
// POST /api/customers/bootstrap (Cognito-backed, JWT-authenticated).
app.post('/api/auth/register', (req, res) => {
  return res.status(404).json({
    error: 'This endpoint has been removed. Customer registration is now handled by Cognito.',
    code: 'ENDPOINT_REMOVED',
  });
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'divine-printing-api' });
});

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
    logger.error('Login error', error, { route: 'POST /api/auth/login' });
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
    logger.error('Verify error', error, { route: 'POST /api/auth/verify' });
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
    logger.error('Orders error', error, { route: 'GET /api/orders' });
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

    logger.info('Order saved', { orderId: order.token });
    res.json({ success: true, orderId: order.token });

  } catch (error) {
    logger.error('Webhook error', error, { route: 'POST /api/webhook/snipcart' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.listen(PORT, () => {
  logger.info('Divine Printing API running', { port: PORT });
});
