'use strict';

const fs = require('fs');
const path = require('path');

const template = fs.readFileSync(
  path.resolve(__dirname, '../../../cloudformation/checkout-v2-review.yaml'),
  'utf8',
);

describe('Task 6.6 order-history infrastructure', () => {
  test('adds an authenticated GET route on the existing checkout API', () => {
    expect(template).toMatch(/OrderHistoryRoute:[\s\S]*RouteKey: GET \/api\/orders[\s\S]*AuthorizationType: JWT[\s\S]*AuthorizerId: !Ref CheckoutJwtAuthorizer/);
    expect(template).toMatch(/OrderHistoryInvokePermission:[\s\S]*Action: lambda:InvokeFunction[\s\S]*SourceArn: !Sub arn:aws:execute-api:\$\{AWS::Region\}:\$\{AWS::AccountId\}:\$\{CheckoutApi\}\/\*\/GET\/api\/orders/);
    expect(template).toContain('AllowMethods: [GET, POST, OPTIONS]');
  });

  test('grants only Query against the customer-order GSI for history reads', () => {
    expect(template).toMatch(/Sid: CustomerOrderHistory\s+Effect: Allow\s+Action: dynamodb:Query\s+Resource: arn:aws:dynamodb:us-east-1:911762440868:table\/divine-printing-orders-v2\/index\/CustomerOrdersIndex/);
    expect(template).not.toMatch(/Sid: CustomerOrderHistory[\s\S]{0,200}Action: \[[^\]]*(?:PutItem|UpdateItem|DeleteItem)/);
  });
});
