'use strict';

const fs = require('fs');
const path = require('path');

const infrastructureRoot = path.resolve(__dirname, '../../..');
const template = fs.readFileSync(path.join(infrastructureRoot, 'cloudformation/checkout-v2-review.yaml'), 'utf8');
const buildScript = fs.readFileSync(path.join(infrastructureRoot, 'scripts/build-checkout-lambda.sh'), 'utf8');

describe('Task 6.4 deployment readiness', () => {
  test('defines retained event storage with TTL and runtime references', () => {
    expect(template).toContain('TableName: divine-printing-stripe-events');
    expect(template).toContain('BillingMode: PAY_PER_REQUEST');
    expect(template).toContain('AttributeName: stripeEventId');
    expect(template).toContain('AttributeName: ttl');
    expect(template).toContain('Enabled: true');
    expect(template).toContain('STRIPE_EVENTS_TABLE: !Ref StripeEventsTable');
    expect(template).toContain('STRIPE_WEBHOOK_SECRET_ARN: !Ref StripeWebhookSecretArn');
  });
  test('keeps checkout JWT protection and gives only the webhook an unauthenticated route', () => {
    expect(template).toMatch(/RouteKey: POST \/api\/checkout\/session[\s\S]*?AuthorizationType: JWT[\s\S]*?AuthorizerId:/);
    expect(template).toMatch(/RouteKey: POST \/api\/checkout\/webhook\n\s+AuthorizationType: NONE/);
    expect(template).toContain('${CheckoutApi}/*/POST/api/checkout/webhook');
  });
  test('scopes webhook persistence, order lookup, and secret permissions without wildcards', () => {
    expect(template).toContain('table/divine-printing-orders-v2/index/StripeCheckoutSessionIndex');
    expect(template).toContain('Resource: !GetAtt StripeEventsTable.Arn');
    expect(template).toContain('Resource: !Ref StripeWebhookSecretArn');
    expect(template).not.toMatch(/Resource:\s*["']?\*["']?/);
  });
  test('build procedure is content-addressable and excludes tests and secrets', () => {
    expect(buildScript).toContain('npm ci --omit=dev');
    expect(buildScript).toContain('sha256sum');
    expect(buildScript).toContain('sha256-');
    expect(buildScript).toContain("! -path '*/__tests__/*'");
    expect(buildScript).toContain("-name '*.test.js'");
    expect(buildScript).not.toContain('STRIPE_SECRET');
  });
});

describe('Task 6.5 order-confirmation source readiness', () => {
  test('defines retained encrypted PAY_PER_REQUEST outbox storage with a stream', () => {
    expect(template).toContain('TableName: divine-printing-order-notifications');
    expect(template).toMatch(/OrderNotificationsTable:[\s\S]*?BillingMode: PAY_PER_REQUEST[\s\S]*?StreamViewType: NEW_IMAGE/);
    expect(template).toMatch(/OrderNotificationsTable:[\s\S]*?PointInTimeRecoveryEnabled: true[\s\S]*?SSEEnabled: true/);
  });
  test('defines worker, partial batch handling, bounded retries, and encrypted dead letter destination', () => {
    expect(template).toContain('Handler: orderConfirmationLambda.handler');
    expect(template).toContain('FunctionResponseTypes: [ReportBatchItemFailures]');
    expect(template).toContain('MaximumRetryAttempts: 3');
    expect(template).toContain('BisectBatchOnFunctionError: true');
    expect(template).toContain('Destination: !GetAtt OrderConfirmationDeadLetterQueue.Arn');
    expect(template).toContain('SqsManagedSseEnabled: true');
  });
  test('passes only non-secret sender and table configuration', () => {
    expect(template).toContain('SES_SENDER_EMAIL: !Ref SesSenderEmail');
    expect(template).toContain('ORDER_NOTIFICATIONS_TABLE: !Ref OrderNotificationsTable');
    expect(template).not.toContain('SES_SECRET');
    expect(template).not.toContain('SES_API_KEY');
  });
});
