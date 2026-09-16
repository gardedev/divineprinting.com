'use strict';

const fs = require('fs');
const path = require('path');

describe('Task 5.6 cart claim runtime IAM', () => {
  test('grants ConditionCheckItem only on the carts table', () => {
    const template = fs.readFileSync(path.resolve(__dirname, '../../../cart-runtime.yaml'), 'utf8');
    const actionMatches = template.match(/Action: dynamodb:ConditionCheckItem/g) || [];
    expect(actionMatches).toHaveLength(1);
    expect(template).toMatch(/Sid: ConditionCheckCustomerCartPointer\n\s+Effect: Allow\n\s+Action: dynamodb:ConditionCheckItem\n\s+Resource: !GetAtt CartsTable\.Arn/);
    expect(template).not.toMatch(/Action:\s*\n(?:\s+- dynamodb:[^\n]+\n)*\s+- dynamodb:ConditionCheckItem/);
  });
});
