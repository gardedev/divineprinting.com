// Divine Printing API Server - Runs on Lightsail
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { PutCommand } = require('@aws-sdk/lib-dynamodb');

const logger = require('./utils/logger');

// Shared DynamoDB client (initialized once, reused across all modules)
const { docClient } = require('./utils/dynamoDbClient');

// Route modules
const productRoutes = require('./products/index');
const publicProductRoutes = require('./products/publicProductRoutes');

// Customer registration (Task 4.3)
const { createCustomerRegistrationRouter } = require('./api/customerRegistrationApi');
const { createCustomerOrdersRouter } = require('./api/customerOrdersApi');
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
app.use('/api/orders', createCustomerOrdersRouter(jwtAuth, docClient, ORDERS_TABLE));

// ---------------------------------------------------------------------------
// Legacy auth endpoints — PERMANENTLY DISABLED (Task 4.4)
//
// POST /api/auth/register — removed in Task 4.3/4.4.
//   Previously accepted plaintext passwords and generated random UUIDs.
//   All customer creation now flows through POST /api/customers/bootstrap
//   (Cognito-backed, JWT-authenticated, no passwords accepted or stored).
//
// POST /api/auth/login — removed in Task 4.4.
//   Previously accepted email + password and returned a homegrown session token.
//   Authentication is now exclusively via Cognito Hosted UI + PKCE.
//   The backend is stateless; no session tokens are issued or stored.
//
// Both endpoints return 404 ENDPOINT_REMOVED. The backend MUST NOT expose
// any password-based login or registration endpoint.
// ---------------------------------------------------------------------------

app.post('/api/auth/register', (req, res) => {
  return res.status(404).json({
    error: 'This endpoint has been removed. Customer registration is now handled by Cognito.',
    code: 'ENDPOINT_REMOVED',
  });
});

app.post('/api/auth/login', (req, res) => {
  return res.status(404).json({
    error: 'This endpoint has been removed. Authentication is now handled exclusively by Cognito Hosted UI.',
    code: 'ENDPOINT_REMOVED',
  });
});

app.post('/api/auth/verify', (req, res) => {
  return res.status(404).json({
    error: 'This endpoint has been removed. Token verification is performed by the jwtAuth middleware.',
    code: 'ENDPOINT_REMOVED',
  });
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'divine-printing-api' });
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
