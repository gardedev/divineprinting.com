'use strict';
const fs = require('fs');
const path = require('path');

const template = fs.readFileSync(path.join(__dirname, '..', 'infrastructure', 'cart-runtime.yaml'), 'utf8');
const seedPolicy = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'infrastructure', 'policies', 'product-seed-operator.json'), 'utf8'));
const productRepository = fs.readFileSync(path.join(__dirname, '..', 'infrastructure', 'server', 'products', 'productRepository.js'), 'utf8');
const serverPackage = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'infrastructure', 'server', 'package.json'), 'utf8'));
const packageScript = fs.readFileSync(path.join(__dirname, '..', 'infrastructure', 'package-cart-lambda.sh'), 'utf8');

describe('isolated Task 5.4 infrastructure package', () => {
  test('defines exactly the three retained tables and approved indexes/TTL', () => {
    expect(template.match(/Type: AWS::DynamoDB::Table/g)).toHaveLength(3);
    expect(template.match(/DeletionPolicy: Retain/g)).toHaveLength(4); // three tables plus log group
    expect(template.match(/UpdateReplacePolicy: Retain/g)).toHaveLength(4);
    for (const value of ['divine-printing-products', 'divine-printing-carts', 'divine-printing-cart-items', 'slug-index', 'CustomerActiveCartIndex', 'AnonymousSessionIndex', 'CartStatusExpiryIndex', 'ProductCartItemIndex', 'TimeToLiveSpecification']) expect(template).toContain(value);
  });

  test('does not reference existing unrelated production resources', () => {
    expect(template).not.toMatch(/divine-printing-(orders|customers|designs|webhook)/);
    expect(template).not.toMatch(/AWS::Cognito|AWS::SES/);
  });

  test('runtime and seed IAM are bounded', () => {
    expect(template).not.toContain('dynamodb:*');
    expect(template).not.toContain('Resource: "*"');
    expect(template.match(/dynamodb:DeleteItem/g)).toHaveLength(1);
    expect(template).toMatch(/Sid: DeleteOwnedCartItems[\s\S]*?Action: dynamodb:DeleteItem\s+Resource: !GetAtt CartItemsTable\.Arn/);
    expect(seedPolicy.Statement[0].Action.sort()).toEqual(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query'].sort());
    expect(seedPolicy.Statement[0].Resource).toHaveLength(2);
  });

  test('dedicated API has exact cart routes and exact-origin CORS', () => {
    expect(template).toContain('ANY /api/carts/{proxy+}');
    expect(template).toContain('ANY /api/carts');
    expect(template).toContain('GET /api/cart-health');
    expect(template).toContain('https://divineprinting.com');
    expect(template).not.toMatch(/AllowOrigins:\s*\n\s*- ['"]?\*/);
  });

  test('packaged CommonJS runtime uses built-in UUID generation and has an initialization gate', () => {
    expect(productRepository).toContain("require('crypto')");
    expect(productRepository).not.toMatch(/require\(['"]uuid['"]\)/);
    expect(serverPackage.dependencies).not.toHaveProperty('uuid');
    expect(packageScript).toContain('node -e "require(process.argv[1])"');
  });
});
