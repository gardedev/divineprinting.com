// Simple password-based auth for Divine Printing
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const crypto = require('crypto');

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' });
const docClient = DynamoDBDocumentClient.from(client);

const CUSTOMERS_TABLE = process.env.CUSTOMERS_TABLE || 'divine-printing-customers';
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-this';

// Simple hash function (in production, use bcrypt)
function hashPassword(password) {
  return crypto.createHmac('sha256', JWT_SECRET).update(password).digest('hex');
}

function generateToken(email) {
  const payload = { email, exp: Date.now() + (7 * 24 * 60 * 60 * 1000) }; // 7 days
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

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const path = event.path || event.routeKey;
  const body = JSON.parse(event.body || '{}');

  try {
    // Register
    if (path.includes('/register')) {
      const { email, password, name } = body;
      
      if (!email || !password) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email and password required' }) };
      }

      const existing = await docClient.send(new GetCommand({
        TableName: CUSTOMERS_TABLE,
        Key: { email: email.toLowerCase() },
      }));

      if (existing.Item && existing.Item.passwordHash) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'Account already exists' }) };
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

      return {
        statusCode: 201,
        headers,
        body: JSON.stringify({ success: true, token: generateToken(email) }),
      };
    }

    // Login
    if (path.includes('/login')) {
      const { email, password } = body;

      const result = await docClient.send(new GetCommand({
        TableName: CUSTOMERS_TABLE,
        Key: { email: email.toLowerCase() },
      }));

      const customer = result.Item;

      if (!customer || customer.passwordHash !== hashPassword(password)) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid credentials' }) };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          success: true, 
          token: generateToken(email),
          customer: {
            email: customer.email,
            name: customer.name,
          }
        }),
      };
    }

    // Verify token
    if (path.includes('/verify')) {
      const { token } = body;
      const payload = verifyToken(token);
      
      if (!payload) {
        return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid token' }) };
      }

      const result = await docClient.send(new GetCommand({
        TableName: CUSTOMERS_TABLE,
        Key: { email: payload.email },
      }));

      if (!result.Item) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Customer not found' }) };
      }

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({ 
          valid: true,
          customer: {
            email: result.Item.email,
            name: result.Item.name,
          }
        }),
      };
    }

    return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };

  } catch (error) {
    console.error('Auth error:', error);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Server error' }) };
  }
};
