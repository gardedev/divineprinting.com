'use strict';

const crypto = require('crypto');
const {
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  TransactWriteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../utils/dynamoDbClient');

const CARTS_TABLE = process.env.CARTS_TABLE || 'divine-printing-carts';
const CART_ITEMS_TABLE = process.env.CART_ITEMS_TABLE || 'divine-printing-cart-items';
const CUSTOMER_INDEX = 'CustomerActiveCartIndex';
const ANONYMOUS_INDEX = 'AnonymousSessionIndex';
const EXPIRY_INDEX = 'CartStatusExpiryIndex';
const PRODUCT_INDEX = 'ProductCartItemIndex';
const ANONYMOUS_TTL_SECONDS = 14 * 24 * 60 * 60;
const CUSTOMER_TTL_SECONDS = 90 * 24 * 60 * 60;
const MAX_IDEMPOTENCY_RECORDS = 20;
const MUTABLE_STATUSES = ['draft', 'active'];
const CART_STATUSES = ['draft', 'active', 'pending_checkout', 'abandoned', 'expired', 'converted'];
const CART_ITEM_FIELDS = [
  'sku', 'productVersion', 'pricingVersion', 'variation', 'options', 'personalization', 'fulfillment',
  'uploadId', 'designId', 'dedupeKey', 'validationStatus', 'validationErrors',
  'inventoryStatus',
];

class CartRepositoryError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = 'CartRepositoryError';
    this.code = code;
  }
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function integer(value, field, { min = 0 } = {}) {
  if (!Number.isInteger(value) || value < min) {
    throw new TypeError(`${field} must be an integer greater than or equal to ${min}`);
  }
  return value;
}

function assertNoRawIdentity(input) {
  const forbidden = ['anonymousToken', 'cartToken', 'accessToken', 'idToken', 'refreshToken', 'role', 'roles', 'groups', 'isAdmin'];
  if (forbidden.some((field) => Object.prototype.hasOwnProperty.call(input || {}, field))) {
    throw new TypeError('Raw authentication and anonymous cart tokens must not be persisted');
  }
}

function ownerCondition(owner, names, values) {
  if (!owner || typeof owner !== 'object') throw new TypeError('owner is required');
  if (owner.type === 'customer') {
    values[':ownerCustomerId'] = requiredString(owner.customerId, 'owner.customerId');
    return '#customerId = :ownerCustomerId AND attribute_not_exists(#anonymousSessionHash)';
  }
  if (owner.type === 'anonymous') {
    values[':ownerAnonymousHash'] = requiredString(owner.anonymousSessionHash, 'owner.anonymousSessionHash');
    return '#anonymousSessionHash = :ownerAnonymousHash AND attribute_not_exists(#customerId)';
  }
  throw new TypeError('owner.type must be customer or anonymous');
}

function assertOwnerMatches(cart, owner) {
  if (owner?.type === 'customer' && cart.customerId === requiredString(owner.customerId, 'owner.customerId') && !cart.anonymousSessionHash) return;
  if (owner?.type === 'anonymous' && cart.anonymousSessionHash === requiredString(owner.anonymousSessionHash, 'owner.anonymousSessionHash') && !cart.customerId) return;
  throw new CartRepositoryError('CART_ACCESS_DENIED');
}

function conditionNames() {
  return {
    '#cartId': 'cartId',
    '#customerId': 'customerId',
    '#anonymousSessionHash': 'anonymousSessionHash',
    '#status': 'status',
    '#version': 'version',
  };
}

function mutableCondition(owner, expectedVersion, names, values) {
  values[':expectedVersion'] = integer(expectedVersion, 'expectedVersion', { min: 1 });
  values[':draft'] = 'draft';
  values[':active'] = 'active';
  return [
    'attribute_exists(#cartId)',
    ownerCondition(owner, names, values),
    '#version = :expectedVersion',
    '(#status = :draft OR #status = :active)',
  ].join(' AND ');
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function translate(error, fallback = 'CART_VERSION_CONFLICT') {
  if (error instanceof CartRepositoryError || error instanceof TypeError) return error;
  if (error && (error.name === 'ConditionalCheckFailedException' || error.name === 'TransactionCanceledException')) {
    return new CartRepositoryError(fallback);
  }
  return error;
}

function createCartRepository({ client = docClient, now = () => new Date(), generateId = () => crypto.randomUUID() } = {}) {
  async function createCart(input) {
    assertNoRawIdentity(input);
    const cartType = requiredString(input.cartType, 'cartType');
    if (!['anonymous', 'customer'].includes(cartType)) throw new TypeError('cartType must be anonymous or customer');
    const customerId = cartType === 'customer' ? requiredString(input.customerId, 'customerId') : undefined;
    const anonymousSessionHash = cartType === 'anonymous'
      ? requiredString(input.anonymousSessionHash, 'anonymousSessionHash')
      : undefined;
    if (cartType === 'customer' && input.anonymousSessionHash !== undefined) throw new TypeError('customer carts cannot have anonymous ownership');
    if (cartType === 'anonymous' && input.customerId !== undefined) throw new TypeError('anonymous carts cannot have customer ownership');

    const at = now();
    const epoch = Math.floor(at.getTime() / 1000);
    const item = {
      cartId: input.cartId ? requiredString(input.cartId, 'cartId') : generateId(),
      cartType,
      ...(customerId ? { customerId } : {}),
      ...(anonymousSessionHash ? { anonymousSessionHash } : {}),
      status: input.status || (cartType === 'anonymous' ? 'draft' : 'active'),
      currency: input.currency || 'USD',
      subtotalCents: integer(input.subtotalCents ?? 0, 'subtotalCents'),
      discountCents: integer(input.discountCents ?? 0, 'discountCents'),
      totalCents: integer(input.totalCents ?? 0, 'totalCents'),
      validationStatus: input.validationStatus || 'not_validated',
      idempotencyRecords: [],
      createdAt: at.toISOString(),
      updatedAt: at.toISOString(),
      expiresAt: epoch + (cartType === 'anonymous' ? ANONYMOUS_TTL_SECONDS : CUSTOMER_TTL_SECONDS),
      version: 1,
    };
    if (!CART_STATUSES.includes(item.status)) throw new TypeError('status is not a recognized cart lifecycle state');
    try {
      await client.send(new PutCommand({
        TableName: CARTS_TABLE,
        Item: item,
        ConditionExpression: 'attribute_not_exists(cartId)',
      }));
      return item;
    } catch (error) {
      throw translate(error, 'CART_ID_CONFLICT');
    }
  }

  async function getCart(cartId, { consistentRead = true } = {}) {
    const response = await client.send(new GetCommand({
      TableName: CARTS_TABLE,
      Key: { cartId: requiredString(cartId, 'cartId') },
      ConsistentRead: consistentRead,
    }));
    return response.Item || null;
  }

  async function findActiveCustomerCart(customerId) {
    const response = await client.send(new QueryCommand({
      TableName: CARTS_TABLE,
      IndexName: CUSTOMER_INDEX,
      KeyConditionExpression: '#customerId = :customerId',
      FilterExpression: '#status = :active OR #status = :pending',
      ExpressionAttributeNames: { '#customerId': 'customerId', '#status': 'status' },
      ExpressionAttributeValues: { ':customerId': requiredString(customerId, 'customerId'), ':active': 'active', ':pending': 'pending_checkout' },
      ScanIndexForward: false,
    }));
    return (response.Items || [])[0] || null;
  }

  async function findAnonymousCartByHash(anonymousSessionHash) {
    const response = await client.send(new QueryCommand({
      TableName: CARTS_TABLE,
      IndexName: ANONYMOUS_INDEX,
      KeyConditionExpression: '#hash = :hash',
      ExpressionAttributeNames: { '#hash': 'anonymousSessionHash' },
      ExpressionAttributeValues: { ':hash': requiredString(anonymousSessionHash, 'anonymousSessionHash') },
      ScanIndexForward: false,
      Limit: 1,
    }));
    return (response.Items || [])[0] || null;
  }

  async function queryExpiringCarts(status, expiresAt, { limit = 100 } = {}) {
    integer(expiresAt, 'expiresAt', { min: 1 });
    integer(limit, 'limit', { min: 1 });
    const response = await client.send(new QueryCommand({
      TableName: CARTS_TABLE,
      IndexName: EXPIRY_INDEX,
      KeyConditionExpression: '#status = :status AND #expiresAt <= :expiresAt',
      ExpressionAttributeNames: { '#status': 'status', '#expiresAt': 'expiresAt' },
      ExpressionAttributeValues: { ':status': requiredString(status, 'status'), ':expiresAt': expiresAt },
      Limit: limit,
    }));
    return response.Items || [];
  }

  async function mutateCart({ cartId, owner, expectedVersion, mutationId, updates = {} }) {
    assertNoRawIdentity(updates);
    const id = requiredString(mutationId, 'mutationId');
    const requestFingerprint = fingerprint({ operation: 'mutateCart', updates });
    integer(expectedVersion, 'expectedVersion', { min: 1 });
    const existing = await getCart(cartId);
    if (!existing) throw new CartRepositoryError('CART_NOT_FOUND');
    assertOwnerMatches(existing, owner);
    const prior = (existing.idempotencyRecords || []).find((record) => record.mutationId === id);
    if (prior) {
      if (prior.fingerprint !== requestFingerprint) throw new CartRepositoryError('CART_IDEMPOTENCY_CONFLICT');
      return { cart: existing, idempotentReplay: true };
    }
    if (!MUTABLE_STATUSES.includes(existing.status)) {
      const lifecycleErrors = { pending_checkout: 'CART_PENDING_CHECKOUT_LOCKED', expired: 'CART_EXPIRED', abandoned: 'CART_ABANDONED', converted: 'CART_ALREADY_CONVERTED' };
      throw new CartRepositoryError(lifecycleErrors[existing.status] || 'CART_VERSION_CONFLICT');
    }

    const allowed = new Set([
      'status', 'currency', 'subtotalCents', 'discountCents', 'totalCents',
      'validationStatus', 'validationSummary', 'migrationId', 'mergedFromCartId', 'convertedToOrderId',
    ]);
    const names = conditionNames();
    const values = {};
    const sets = [];
    for (const [key, value] of Object.entries(updates)) {
      if (!allowed.has(key)) throw new TypeError(`${key} is not mutable through mutateCart`);
      if (key.endsWith('Cents')) integer(value, key);
      if (key === 'status' && !CART_STATUSES.includes(value)) throw new TypeError('status is not a recognized cart lifecycle state');
      names[`#u_${key}`] = key;
      values[`:u_${key}`] = value;
      sets.push(`#u_${key} = :u_${key}`);
    }
    const at = now();
    const epoch = Math.floor(at.getTime() / 1000);
    const ttl = existing.cartType === 'anonymous' ? ANONYMOUS_TTL_SECONDS : CUSTOMER_TTL_SECONDS;
    const records = [...(existing.idempotencyRecords || []), { mutationId: id, fingerprint: requestFingerprint, appliedVersion: expectedVersion + 1 }]
      .slice(-MAX_IDEMPOTENCY_RECORDS);
    Object.assign(names, { '#updatedAt': 'updatedAt', '#expiresAt': 'expiresAt', '#records': 'idempotencyRecords' });
    Object.assign(values, { ':updatedAt': at.toISOString(), ':expiresAt': epoch + ttl, ':records': records, ':nextVersion': expectedVersion + 1 });
    sets.push('#updatedAt = :updatedAt', '#expiresAt = :expiresAt', '#records = :records', '#version = :nextVersion');
    try {
      const response = await client.send(new UpdateCommand({
        TableName: CARTS_TABLE,
        Key: { cartId: requiredString(cartId, 'cartId') },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: mutableCondition(owner, expectedVersion, names, values),
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: 'ALL_NEW',
      }));
      return { cart: response.Attributes, idempotentReplay: false };
    } catch (error) {
      throw translate(error);
    }
  }

  async function transitionExpiredCart({ cartId, owner, expectedVersion, fromStatuses = MUTABLE_STATUSES }) {
    if (!Array.isArray(fromStatuses) || fromStatuses.length === 0 || fromStatuses.some((status) => !CART_STATUSES.includes(status))) {
      throw new TypeError('fromStatuses must contain recognized cart lifecycle states');
    }
    const names = conditionNames();
    const values = { ':expectedVersion': integer(expectedVersion, 'expectedVersion', { min: 1 }), ':nowEpoch': Math.floor(now().getTime() / 1000), ':expired': 'expired', ':nextVersion': expectedVersion + 1, ':updatedAt': now().toISOString() };
    const statusParts = fromStatuses.map((status, index) => {
      values[`:from${index}`] = status;
      return `#status = :from${index}`;
    });
    const condition = ['attribute_exists(#cartId)', ownerCondition(owner, names, values), '#version = :expectedVersion', '#expiresAt <= :nowEpoch', `(${statusParts.join(' OR ')})`].join(' AND ');
    names['#expiresAt'] = 'expiresAt';
    names['#updatedAt'] = 'updatedAt';
    try {
      const response = await client.send(new UpdateCommand({ TableName: CARTS_TABLE, Key: { cartId: requiredString(cartId, 'cartId') }, UpdateExpression: 'SET #status = :expired, #version = :nextVersion, #updatedAt = :updatedAt', ConditionExpression: condition, ExpressionAttributeNames: names, ExpressionAttributeValues: values, ReturnValues: 'ALL_NEW' }));
      return response.Attributes;
    } catch (error) { throw translate(error); }
  }

  async function listCartItems(cartId) {
    const response = await client.send(new QueryCommand({ TableName: CART_ITEMS_TABLE, KeyConditionExpression: '#cartId = :cartId', ExpressionAttributeNames: { '#cartId': 'cartId' }, ExpressionAttributeValues: { ':cartId': requiredString(cartId, 'cartId') } }));
    return response.Items || [];
  }

  async function getCartItem(cartId, cartItemId) {
    const response = await client.send(new GetCommand({ TableName: CART_ITEMS_TABLE, Key: { cartId: requiredString(cartId, 'cartId'), cartItemId: requiredString(cartItemId, 'cartItemId') }, ConsistentRead: true }));
    return response.Item || null;
  }

  async function findCartItemsByProduct(productId) {
    const response = await client.send(new QueryCommand({ TableName: CART_ITEMS_TABLE, IndexName: PRODUCT_INDEX, KeyConditionExpression: '#productId = :productId', ExpressionAttributeNames: { '#productId': 'productId' }, ExpressionAttributeValues: { ':productId': requiredString(productId, 'productId') } }));
    return response.Items || [];
  }

  function itemMutationCartUpdate({ cartId, owner, expectedCartVersion, at, idempotencyRecords, cartUpdates = {} }) {
    const names = conditionNames();
    names['#updatedAt'] = 'updatedAt';
    names['#expiresAt'] = 'expiresAt';
    names['#records'] = 'idempotencyRecords';
    const values = {};
    const condition = mutableCondition(owner, expectedCartVersion, names, values);
    const ttl = owner.type === 'anonymous' ? ANONYMOUS_TTL_SECONDS : CUSTOMER_TTL_SECONDS;
    Object.assign(values, { ':nextCartVersion': expectedCartVersion + 1, ':updatedAt': at.toISOString(), ':expiresAt': Math.floor(at.getTime() / 1000) + ttl, ':records': idempotencyRecords });
    const sets = ['#version = :nextCartVersion', '#updatedAt = :updatedAt', '#expiresAt = :expiresAt', '#records = :records'];
    const allowed = new Set(['status', 'subtotalCents', 'discountCents', 'taxCents', 'shippingCents', 'totalCents', 'validationStatus']);
    for (const [key, value] of Object.entries(cartUpdates)) {
      if (!allowed.has(key)) throw new TypeError(`${key} is not mutable through an item transaction`);
      if (key.endsWith('Cents')) integer(value, key);
      if (key === 'status' && !CART_STATUSES.includes(value)) throw new TypeError('status is not a recognized cart lifecycle state');
      names[`#cart_${key}`] = key;
      values[`:cart_${key}`] = value;
      sets.push(`#cart_${key} = :cart_${key}`);
    }
    return { Update: { TableName: CARTS_TABLE, Key: { cartId }, UpdateExpression: `SET ${sets.join(', ')}`, ConditionExpression: condition, ExpressionAttributeNames: names, ExpressionAttributeValues: values } };
  }

  async function prepareItemMutation({ cartId, owner, expectedCartVersion, mutationId, mutationFingerprint, result }) {
    integer(expectedCartVersion, 'expectedCartVersion', { min: 1 });
    const id = requiredString(mutationId, 'mutationId');
    const existing = await getCart(cartId);
    if (!existing) throw new CartRepositoryError('CART_NOT_FOUND');
    assertOwnerMatches(existing, owner);
    const prior = (existing.idempotencyRecords || []).find((record) => record.mutationId === id);
    if (prior) {
      if (prior.fingerprint !== mutationFingerprint) throw new CartRepositoryError('CART_IDEMPOTENCY_CONFLICT');
      return { replay: true, record: prior };
    }
    if (!MUTABLE_STATUSES.includes(existing.status)) {
      const lifecycleErrors = { pending_checkout: 'CART_PENDING_CHECKOUT_LOCKED', expired: 'CART_EXPIRED', abandoned: 'CART_ABANDONED', converted: 'CART_ALREADY_CONVERTED' };
      throw new CartRepositoryError(lifecycleErrors[existing.status] || 'CART_VERSION_CONFLICT');
    }
    const record = { mutationId: id, fingerprint: mutationFingerprint, appliedVersion: expectedCartVersion + 1, ...(result ? { result } : {}) };
    return { replay: false, records: [...(existing.idempotencyRecords || []), record].slice(-MAX_IDEMPOTENCY_RECORDS), record };
  }

  async function getMutationReplay({ cartId, owner, mutationId, idempotencyInput }) {
    const id = requiredString(mutationId, 'mutationId');
    const existing = await getCart(cartId);
    if (!existing) throw new CartRepositoryError('CART_NOT_FOUND');
    assertOwnerMatches(existing, owner);
    const prior = (existing.idempotencyRecords || []).find((record) => record.mutationId === id);
    if (!prior) return null;
    if (prior.fingerprint !== fingerprint(idempotencyInput)) throw new CartRepositoryError('CART_IDEMPOTENCY_CONFLICT');
    return prior;
  }

  async function createCartItem({ cartId, owner, expectedCartVersion, mutationId, item, cartUpdates = {}, idempotencyInput }) {
    assertNoRawIdentity(item);
    const at = now();
    const validatedProductId = requiredString(item.productId, 'productId');
    const validatedQuantity = integer(item.quantity, 'quantity', { min: 1 });
    const validatedUnitPrice = integer(item.unitPriceCents, 'unitPriceCents');
    const validatedLineTotal = integer(item.lineTotalCents, 'lineTotalCents');
    const semanticItem = { productId: validatedProductId, quantity: validatedQuantity, currency: item.currency || 'USD', unitPriceCents: validatedUnitPrice, lineTotalCents: validatedLineTotal, ...Object.fromEntries(CART_ITEM_FIELDS.filter((field) => item[field] !== undefined).map((field) => [field, item[field]])) };
    const mutationFingerprint = fingerprint(idempotencyInput || { operation: 'createCartItem', item: semanticItem });
    const prepared = await prepareItemMutation({ cartId, owner, expectedCartVersion, mutationId, mutationFingerprint });
    if (prepared.replay) return getCartItem(cartId, prepared.record.result.cartItemId);
    const cartItemId = item.cartItemId ? requiredString(item.cartItemId, 'cartItemId') : generateId();
    prepared.record.result = { cartItemId };
    const snapshots = Object.fromEntries(CART_ITEM_FIELDS.filter((field) => item[field] !== undefined).map((field) => [field, item[field]]));
    const persisted = { ...snapshots, cartId: requiredString(cartId, 'cartId'), cartItemId, ...semanticItem, createdAt: at.toISOString(), updatedAt: at.toISOString(), version: 1 };
    try {
      await client.send(new TransactWriteCommand({ TransactItems: [itemMutationCartUpdate({ cartId, owner, expectedCartVersion, at, idempotencyRecords: prepared.records, cartUpdates }), { Put: { TableName: CART_ITEMS_TABLE, Item: persisted, ConditionExpression: 'attribute_not_exists(cartId) AND attribute_not_exists(cartItemId)' } }] }));
      return persisted;
    } catch (error) { throw translate(error); }
  }

  async function updateCartItem({ cartId, cartItemId, owner, expectedCartVersion, expectedItemVersion, mutationId, updates, cartUpdates = {}, idempotencyInput }) {
    assertNoRawIdentity(updates);
    const allowed = new Set(['quantity', 'unitPriceCents', 'lineTotalCents', 'currency', 'productVersion', 'pricingVersion', 'variation', 'options', 'personalization', 'fulfillment', 'uploadId', 'designId', 'dedupeKey', 'validationStatus', 'inventoryStatus']);
    const names = { '#cartId': 'cartId', '#cartItemId': 'cartItemId', '#version': 'version', '#updatedAt': 'updatedAt' };
    const values = { ':expectedItemVersion': integer(expectedItemVersion, 'expectedItemVersion', { min: 1 }), ':nextItemVersion': expectedItemVersion + 1, ':updatedAt': now().toISOString() };
    const sets = ['#version = :nextItemVersion', '#updatedAt = :updatedAt'];
    for (const [key, value] of Object.entries(updates || {})) {
      if (!allowed.has(key)) throw new TypeError(`${key} is not mutable through updateCartItem`);
      if (key === 'quantity') integer(value, key, { min: 1 });
      if (key.endsWith('Cents')) integer(value, key);
      names[`#u_${key}`] = key; values[`:u_${key}`] = value; sets.push(`#u_${key} = :u_${key}`);
    }
    const mutationFingerprint = fingerprint(idempotencyInput || { operation: 'updateCartItem', cartItemId, updates });
    const prepared = await prepareItemMutation({ cartId, owner, expectedCartVersion, mutationId, mutationFingerprint, result: { cartItemId } });
    if (prepared.replay) return getCartItem(cartId, cartItemId);
    const at = now();
    try {
      await client.send(new TransactWriteCommand({ TransactItems: [itemMutationCartUpdate({ cartId: requiredString(cartId, 'cartId'), owner, expectedCartVersion, at, idempotencyRecords: prepared.records, cartUpdates }), { Update: { TableName: CART_ITEMS_TABLE, Key: { cartId, cartItemId: requiredString(cartItemId, 'cartItemId') }, UpdateExpression: `SET ${sets.join(', ')}`, ConditionExpression: 'attribute_exists(#cartId) AND attribute_exists(#cartItemId) AND #version = :expectedItemVersion', ExpressionAttributeNames: names, ExpressionAttributeValues: values } }] }));
      return { cartId, cartItemId, ...updates, version: expectedItemVersion + 1, updatedAt: at.toISOString() };
    } catch (error) { throw translate(error); }
  }

  async function deleteCartItem({ cartId, cartItemId, owner, expectedCartVersion, expectedItemVersion, mutationId, cartUpdates = {}, idempotencyInput }) {
    const at = now();
    const mutationFingerprint = fingerprint(idempotencyInput || { operation: 'deleteCartItem', cartItemId });
    const prepared = await prepareItemMutation({ cartId, owner, expectedCartVersion, mutationId, mutationFingerprint, result: { cartItemId, deleted: true } });
    if (prepared.replay) return true;
    try {
      await client.send(new TransactWriteCommand({ TransactItems: [itemMutationCartUpdate({ cartId: requiredString(cartId, 'cartId'), owner, expectedCartVersion, at, idempotencyRecords: prepared.records, cartUpdates }), { Delete: { TableName: CART_ITEMS_TABLE, Key: { cartId, cartItemId: requiredString(cartItemId, 'cartItemId') }, ConditionExpression: 'attribute_exists(#cartId) AND attribute_exists(#cartItemId) AND #version = :expectedItemVersion', ExpressionAttributeNames: { '#cartId': 'cartId', '#cartItemId': 'cartItemId', '#version': 'version' }, ExpressionAttributeValues: { ':expectedItemVersion': integer(expectedItemVersion, 'expectedItemVersion', { min: 1 }) } } }] }));
      return true;
    } catch (error) { throw translate(error); }
  }

  async function executeTransaction(transactItems, { clientRequestToken } = {}) {
    if (!Array.isArray(transactItems) || transactItems.length < 1 || transactItems.length > 100) throw new TypeError('transactItems must contain between 1 and 100 operations');
    try {
      return await client.send(new TransactWriteCommand({ TransactItems: transactItems, ...(clientRequestToken ? { ClientRequestToken: requiredString(clientRequestToken, 'clientRequestToken') } : {}) }));
    } catch (error) { throw translate(error); }
  }

  return { createCart, getCart, findActiveCustomerCart, findAnonymousCartByHash, queryExpiringCarts, mutateCart, transitionExpiredCart, listCartItems, getCartItem, findCartItemsByProduct, getMutationReplay, createCartItem, updateCartItem, deleteCartItem, executeTransaction };
}

module.exports = { createCartRepository, CartRepositoryError, constants: { CARTS_TABLE, CART_ITEMS_TABLE, CUSTOMER_INDEX, ANONYMOUS_INDEX, EXPIRY_INDEX, PRODUCT_INDEX, ANONYMOUS_TTL_SECONDS, CUSTOMER_TTL_SECONDS, MAX_IDEMPOTENCY_RECORDS }, fingerprint };
