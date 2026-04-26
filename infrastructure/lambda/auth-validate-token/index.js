/**
 * Divine Printing — Validate Magic Link Token
 *
 * Accepts { token } in the POST body, validates signature + TTL,
 * marks the token as used, and returns a session token (JWT-like HMAC token)
 * for the frontend to store in localStorage.
 *
 * AWS SDK v3 — Node.js 20.x
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { createHmac } from 'node:crypto';

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));

const CUSTOMERS_TABLE   = process.env.CUSTOMERS_TABLE   || 'divine-printing-customers';
const TOKENS_TABLE      = process.env.TOKENS_TABLE       || 'divine-printing-auth-tokens';
const MAGIC_LINK_SECRET = process.env.MAGIC_LINK_SECRET  || '';

// Session tokens last 30 days
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

const CORS_HEADERS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function respond(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

/**
 * Create a simple session token: base64({ email, exp }) + HMAC signature.
 * This avoids needing a separate sessions table — the token is self-contained
 * and verified with the server secret.
 */
function createSessionToken(email) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = Buffer.from(JSON.stringify({ email, exp })).toString('base64url');
  const sig = createHmac('sha256', MAGIC_LINK_SECRET).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

/**
 * Verify a session token's signature and expiry.
 * Returns the decoded payload { email, exp } or null.
 */
export function verifySessionToken(token) {
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

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return respond(400, { error: 'Invalid JSON' });
  }

  const fullToken = (body.token || '').trim();
  if (!fullToken) {
    return respond(400, { error: 'Token is required' });
  }

  // Split token into rawToken and signature
  const dotIndex = fullToken.lastIndexOf('.');
  if (dotIndex === -1) {
    return respond(401, { error: 'Invalid token format' });
  }

  const rawToken  = fullToken.substring(0, dotIndex);
  const signature = fullToken.substring(dotIndex + 1);

  // Verify HMAC signature
  const expectedSig = createHmac('sha256', MAGIC_LINK_SECRET)
    .update(rawToken)
    .digest('hex');

  if (signature !== expectedSig) {
    console.warn('Token signature mismatch');
    return respond(401, { error: 'Invalid or expired link' });
  }

  // Look up token in DynamoDB
  const tokenResult = await ddb.send(new GetCommand({
    TableName: TOKENS_TABLE,
    Key: { token: rawToken },
  }));

  if (!tokenResult.Item) {
    return respond(401, { error: 'Invalid or expired link' });
  }

  const tokenRecord = tokenResult.Item;

  // Check if already used
  if (tokenRecord.used) {
    return respond(401, { error: 'This link has already been used. Please request a new one.' });
  }

  // Check expiry (belt-and-suspenders — DynamoDB TTL handles cleanup, but check anyway)
  const now = Math.floor(Date.now() / 1000);
  if (tokenRecord.expiresAt && tokenRecord.expiresAt < now) {
    return respond(401, { error: 'This link has expired. Please request a new one.' });
  }

  // Mark token as used (one-time use)
  await ddb.send(new UpdateCommand({
    TableName: TOKENS_TABLE,
    Key: { token: rawToken },
    UpdateExpression: 'SET used = :true',
    ExpressionAttributeValues: { ':true': true },
  }));

  // Fetch customer profile
  const customerResult = await ddb.send(new GetCommand({
    TableName: CUSTOMERS_TABLE,
    Key: { email: tokenRecord.email },
  }));

  const customer = customerResult.Item || { email: tokenRecord.email, name: '' };

  // Create session token
  const sessionToken = createSessionToken(tokenRecord.email);

  console.log(`Token validated for ${tokenRecord.email}`);

  return respond(200, {
    sessionToken,
    customer: {
      email:      customer.email,
      name:       customer.name || '',
      orderCount: customer.orderCount || 0,
      createdAt:  customer.createdAt || '',
    },
  });
}
