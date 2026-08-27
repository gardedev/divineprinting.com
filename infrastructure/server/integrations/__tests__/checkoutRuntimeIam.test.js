'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '../../..');
const policy = JSON.parse(fs.readFileSync(path.join(root, 'iam/checkout-v2-runtime-policy.json'), 'utf8'));
const template = fs.readFileSync(path.join(root, 'cloudformation/checkout-v2-review.yaml'), 'utf8');

function statement(sid) { return policy.Statement.find((entry) => entry.Sid === sid); }

describe('Task 6.3 review-only IAM and authorization', () => {
  test('authorizes exact constituent transaction actions and no fictitious TransactWriteItems action', () => {
    expect(statement('CheckoutCartTransaction')).toMatchObject({
      Action: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:ConditionCheckItem'],
      Resource: 'arn:aws:dynamodb:us-east-1:911762440868:table/divine-printing-carts',
    });
    expect(statement('CheckoutCartQueries').Resource).toEqual([
      'arn:aws:dynamodb:us-east-1:911762440868:table/divine-printing-carts/index/CustomerActiveCartIndex',
      'arn:aws:dynamodb:us-east-1:911762440868:table/divine-printing-cart-items',
    ]);
    expect(JSON.stringify(policy)).not.toContain('TransactWriteItems');
  });
  test('keeps table operations and secret access narrowly scoped', () => {
    expect(statement('CheckoutOrderTransaction').Resource).toBe('arn:aws:dynamodb:us-east-1:911762440868:table/divine-printing-orders-v2');
    expect(statement('CheckoutOrderItems').Resource).toBe('arn:aws:dynamodb:us-east-1:911762440868:table/divine-printing-order-items-v2');
    expect(statement('StripeTestSecretRead')).toEqual(expect.objectContaining({ Action: ['secretsmanager:GetSecretValue'], Resource: 'PENDING_EXACT_STRIPE_TEST_SECRET_ARN' }));
    expect(policy.Statement.flatMap((entry) => Array.isArray(entry.Resource) ? entry.Resource : [entry.Resource])).not.toContain('*');
  });
  test('template passes only the secret ARN and enforces JWT at API Gateway', () => {
    expect(template).toContain('STRIPE_SECRET_ARN: !Ref StripeSecretArn');
    expect(template).not.toContain('STRIPE_SECRET_KEY:');
    expect(template).toContain('AuthorizationType: JWT');
    expect(template).toContain('AuthorizerId: !Ref CheckoutJwtAuthorizer');
    expect(template).toContain('Audience: [!Ref CognitoClientId]');
    expect(template).toContain('Issuer: !Sub https://cognito-idp.${AWS::Region}.amazonaws.com/${CognitoUserPoolId}');
  });
  test('checkout Lambda initializes with the cart-proven CommonJS JWT dependency graph', () => {
    const serverRoot = path.join(root, 'server');
    const result = spawnSync(process.execPath, [
      '--no-experimental-require-module',
      '-e',
      "require('./checkoutLambda'); require('jwks-rsa'); require('jose');",
    ], {
      cwd: serverRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        AWS_REGION: 'us-east-1',
        COGNITO_USER_POOL_ID: 'us-east-1_hs1jWXB87',
        COGNITO_CLIENT_ID: 'pf2ioscnn7vf7c4if5mjemos',
        STRIPE_SECRET_ARN: 'arn:aws:secretsmanager:us-east-1:911762440868:secret:divine-printing/stripe/checkout/test-zRRvD9',
        CHECKOUT_SUCCESS_URL: 'https://divineprinting.com/checkout/success.html',
        CHECKOUT_CANCEL_URL: 'https://divineprinting.com/checkout/cancel.html',
        STRIPE_TAX_ENABLED: 'false',
      },
    });

    expect(result.status).toBe(0);
    expect(`${result.stderr}${result.stdout}`).not.toContain('ERR_REQUIRE_ESM');
  });
});
