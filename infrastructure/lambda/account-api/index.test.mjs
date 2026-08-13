import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHandler, getTrustedIdentity } from './index.js';

const NOW = 2_000_000_000;
const ENV = {
  COGNITO_ISSUER: 'https://cognito-idp.us-east-1.amazonaws.com/pool-id',
  COGNITO_CLIENT_ID: 'client-id',
  ORDERS_TABLE: 'orders-table',
  CUSTOMERS_TABLE: 'customers-table',
};

function eventFor(path, claimOverrides = {}, clientInput = {}) {
  return {
    routeKey: `GET ${path}`,
    headers: clientInput.headers || {},
    queryStringParameters: clientInput.query || null,
    body: clientInput.body ? JSON.stringify(clientInput.body) : null,
    requestContext: {
      http: { method: 'GET', path },
      authorizer: {
        jwt: {
          claims: {
            iss: ENV.COGNITO_ISSUER,
            client_id: ENV.COGNITO_CLIENT_ID,
            token_use: 'access',
            exp: String(NOW + 3600),
            sub: 'trusted-sub',
            email: 'Trusted@Example.com',
            ...claimOverrides,
          },
        },
      },
    },
  };
}

function parseBody(response) {
  return JSON.parse(response.body);
}

test('accepts API Gateway-verified Cognito access-token claims', () => {
  const result = getTrustedIdentity(eventFor('/account/profile'), ENV, NOW);
  assert.equal(result.ok, true);
  assert.deepEqual(result.identity, { sub: 'trusted-sub', email: 'trusted@example.com' });
});

test('rejects missing access token context', async () => {
  const handler = createHandler({ ddb: { send: async () => ({}) }, env: ENV, now: () => NOW });
  const response = await handler({ requestContext: { http: { method: 'GET' } } });
  assert.equal(response.statusCode, 401);
  assert.equal(parseBody(response).code, 'MISSING_TOKEN');
});

test('rejects an invalid token that has no verified authorizer context', async () => {
  const handler = createHandler({ ddb: { send: async () => ({}) }, env: ENV, now: () => NOW });
  const response = await handler({
    headers: { authorization: 'Bearer invalid.jwt.value' },
    requestContext: { http: { method: 'GET', path: '/account/profile' } },
  });
  assert.equal(response.statusCode, 401);
});

test('rejects expired, wrong issuer, wrong client, and ID-token claims', () => {
  const cases = [
    [{ exp: String(NOW - 1) }, 401, 'TOKEN_EXPIRED'],
    [{ iss: 'https://attacker.example' }, 403, 'INVALID_ISSUER'],
    [{ client_id: 'wrong-client' }, 403, 'INVALID_CLIENT_ID'],
    [{ token_use: 'id' }, 403, 'INVALID_TOKEN_USE'],
  ];
  for (const [overrides, statusCode, code] of cases) {
    const result = getTrustedIdentity(eventFor('/account/profile', overrides), ENV, NOW);
    assert.equal(result.ok, false);
    assert.equal(result.response.statusCode, statusCode);
    assert.equal(parseBody(result.response).code, code);
  }
});

test('orders use trusted JWT email and preserve response behavior', async () => {
  const sent = [];
  const ddb = {
    send: async command => {
      sent.push(command);
      return { Items: [{ orderId: 'o-1', total: 12.345, items: [] }] };
    },
  };
  const handler = createHandler({ ddb, env: ENV, now: () => NOW });
  const response = await handler(eventFor('/account/orders', {}, {
    query: { email: 'attacker@example.com', customerId: 'attacker' },
    body: { email: 'body-attacker@example.com', customerId: 'attacker' },
  }));

  assert.equal(response.statusCode, 200);
  assert.equal(sent[0].input.ExpressionAttributeValues[':email'], 'trusted@example.com');
  assert.deepEqual(parseBody(response), {
    orders: [{
      orderId: 'o-1', items: [], total: 12.345, shippingAddress: {},
    }],
    summary: { totalOrders: 1, totalSpent: 12.35 },
  });
});

test('profile uses trusted JWT email and preserves response behavior', async () => {
  const sent = [];
  const ddb = {
    send: async command => {
      sent.push(command);
      return { Item: { email: 'trusted@example.com', name: 'Trusted User', orderCount: 3 } };
    },
  };
  const handler = createHandler({ ddb, env: ENV, now: () => NOW });
  const response = await handler(eventFor('/account/profile', {}, {
    query: { email: 'attacker@example.com' },
    body: { customerId: 'attacker' },
  }));

  assert.equal(response.statusCode, 200);
  assert.deepEqual(sent[0].input.Key, { email: 'trusted@example.com' });
  assert.deepEqual(parseBody(response), {
    customer: {
      email: 'trusted@example.com',
      name: 'Trusted User',
      orderCount: 3,
      createdAt: '',
      lastOrderAt: '',
    },
  });
});

test('legacy HMAC-shaped bearer token is rejected and never parsed', async () => {
  const payload = Buffer.from(JSON.stringify({ email: 'legacy@example.com', exp: NOW + 3600 }))
    .toString('base64url');
  const handler = createHandler({ ddb: { send: async () => assert.fail('DynamoDB must not be called') }, env: ENV, now: () => NOW });
  const response = await handler({
    headers: { Authorization: `Bearer ${payload}.legacy-hmac-signature` },
    requestContext: { http: { method: 'GET', path: '/account/orders' } },
  });
  assert.equal(response.statusCode, 401);
  assert.equal(parseBody(response).code, 'MISSING_TOKEN');
});

test('legacy HMAC implementation and credential logging are absent', async () => {
  const source = await readFile(new URL('./index.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /createHmac|MAGIC_LINK|verifySession|sessionToken/);
  assert.doesNotMatch(source, /console\.(?:log|info|warn|error|debug)/);
  assert.doesNotMatch(source, /event\.headers.*authorization/i);
});

test('Terraform protects both shared account routes with the Cognito JWT authorizer', async () => {
  const terraform = await readFile(new URL('../../terraform/main.tf', import.meta.url), 'utf8');
  assert.match(terraform, /resource "aws_apigatewayv2_authorizer" "customer_cognito"/);
  for (const route of ['account_orders', 'account_profile']) {
    const block = terraform.match(new RegExp(
      `resource "aws_apigatewayv2_route" "${route}" \\{([\\s\\S]*?)\\n\\}`
    ));
    assert.ok(block, `missing ${route} route`);
    assert.match(block[1], /authorization_type\s*=\s*"JWT"/);
    assert.match(block[1], /authorizer_id\s*=\s*aws_apigatewayv2_authorizer\.customer_cognito\.id/);
  }
  assert.doesNotMatch(terraform, /MAGIC_LINK_SECRET|magic_link_secret|auth_tokens/);
});
