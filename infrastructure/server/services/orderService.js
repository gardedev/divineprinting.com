'use strict';

const crypto = require('crypto');
const defaultOrderRepository = require('../repositories/orderRepository').createOrderRepository();
const defaultCustomerRepository = require('../repositories/customerRepository');
const defaultCartService = require('../carts/cartService').createCartService();
const defaultProductService = require('../products/productService');

const ORDER_TRANSITIONS = Object.freeze({
  checkout_pending: Object.freeze(['submitted', 'canceled']),
  submitted: Object.freeze(['in_production', 'canceled']),
  in_production: Object.freeze(['ready_for_pickup_or_ship']),
  ready_for_pickup_or_ship: Object.freeze(['fulfilled']),
  fulfilled: Object.freeze([]),
  canceled: Object.freeze([]),
});

const PAYMENT_TRANSITIONS = Object.freeze({
  not_started: Object.freeze(['checkout_session_created']),
  checkout_session_created: Object.freeze(['processing', 'paid', 'failed', 'canceled']),
  processing: Object.freeze(['paid', 'failed']),
  failed: Object.freeze(['checkout_session_created']),
  paid: Object.freeze(['partially_refunded', 'refunded', 'disputed']),
  partially_refunded: Object.freeze(['refunded', 'disputed']),
  disputed: Object.freeze(['paid', 'partially_refunded', 'refunded']),
  refunded: Object.freeze([]),
  canceled: Object.freeze([]),
});

const AUTHORITY_FIELDS = new Set([
  'customerId', 'cognitoSub', 'email', 'emailNormalized', 'emailVerified', 'groups',
  'orderState', 'paymentState', 'stripeCheckoutSessionId', 'stripePaymentIntentId',
  'subtotalCents', 'discountTotalCents', 'shippingCents', 'taxCents', 'totalCents',
  'unitPriceCents', 'lineTotalCents', 'pricingSnapshot',
]);

const SECRET_FIELDS = new Set([
  'accessToken', 'idToken', 'refreshToken', 'password', 'passwordHash', 'cardNumber',
  'cvv', 'cvc', 'stripeSecret', 'stripeToken', 'clientSecret', 'anonymousSessionHash',
  'anonymousCartToken', 'cartToken', 'guestToken', 'authorization',
]);

class OrderServiceError extends Error {
  constructor(code, message = code, options = {}) {
    super(message);
    this.name = 'OrderServiceError';
    this.code = code;
    this.isDomainError = true;
    if (options.cause) this.cause = options.cause;
  }
}

function fail(code, message, cause) {
  throw new OrderServiceError(code, message, { cause });
}

function requiredString(value, code, message) {
  if (typeof value !== 'string' || !value.trim()) fail(code, message);
  return value.trim();
}

function positiveInteger(value, code, message) {
  if (!Number.isInteger(value) || value < 1) fail(code, message);
  return value;
}

function nonNegativeMoney(value, code = 'ORDER_PRICE_INVALID') {
  if (!Number.isSafeInteger(value) || value < 0) fail(code, 'Monetary amounts must be non-negative integer cents.');
  return value;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function hasSelection(value) {
  return value !== undefined && value !== null &&
    (typeof value !== 'object' || Object.keys(value).length > 0);
}

function selectionSupported(requested, supported) {
  if (!hasSelection(requested)) return true;
  if (!supported) return false;
  if (Array.isArray(supported)) {
    const needle = JSON.stringify(canonical(requested));
    return supported.some((entry) => entry === requested || JSON.stringify(canonical(entry)) === needle);
  }
  if (requested && typeof requested === 'object' && supported && typeof supported === 'object') {
    return Object.entries(requested).every(([key, value]) => {
      const allowed = supported[key];
      return Array.isArray(allowed) ? allowed.includes(value) : allowed === value;
    });
  }
  return requested === supported;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function inspectFields(value, forbidden, code, path = 'input', seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectFields(entry, forbidden, code, `${path}[${index}]`, seen));
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (forbidden.has(key)) fail(code, `Field "${key}" is not accepted at ${path}.`);
    inspectFields(entry, forbidden, code, `${path}.${key}`, seen);
  }
}

function trustedIdentity(auth) {
  if (!auth || typeof auth !== 'object') fail('ORDER_AUTH_REQUIRED', 'Authentication is required.');
  return requiredString(auth.sub, 'ORDER_AUTH_REQUIRED', 'A verified customer identity is required.');
}

function validateCustomer(customer, customerId) {
  if (!customer || customer.customerId !== customerId || customer.cognitoSub !== customerId) fail('ORDER_ACCOUNT_INELIGIBLE', 'The customer account is not eligible for checkout.');
  if (customer.emailVerified !== true) fail('ORDER_EMAIL_UNVERIFIED', 'A verified email is required.');
  if (customer.accountStatus === 'pending_profile') fail('ORDER_PROFILE_INCOMPLETE', 'The customer profile is incomplete.');
  if (customer.accountStatus !== 'active') fail('ORDER_ACCOUNT_INELIGIBLE', 'The customer account is not eligible for checkout.');
  const email = typeof customer.emailDisplay === 'string' && customer.emailDisplay.trim()
    ? customer.emailDisplay.trim()
    : customer.emailNormalized;
  if (typeof email !== 'string' || !email.trim()) fail('ORDER_PROFILE_INCOMPLETE', 'Trusted contact information is incomplete.');
  return { email: email.trim(), emailNormalized: email.trim().toLowerCase() };
}

function normalizeIdempotencyKey(value) {
  const key = requiredString(value, 'ORDER_IDEMPOTENCY_INVALID', 'A valid idempotency key is required.');
  if (key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    fail('ORDER_IDEMPOTENCY_INVALID', 'The idempotency key format is invalid.');
  }
  return key;
}

function validateOrderStateTransition(fromState, toState, expectedVersion) {
  positiveInteger(expectedVersion, 'ORDER_VERSION_INVALID', 'A positive expected order version is required.');
  if (!ORDER_TRANSITIONS[fromState] || !ORDER_TRANSITIONS[fromState].includes(toState)) {
    fail('ORDER_STATE_TRANSITION_INVALID', 'The requested order state transition is not allowed.');
  }
  return Object.freeze({ expectedState: fromState, nextState: toState, expectedVersion });
}

function validatePaymentStateTransition({ actor, fromState, toState, expectedVersion }) {
  if (!actor || actor.trustedSystem !== true) fail('ORDER_PAYMENT_AUTHORITY_REQUIRED', 'Trusted system authority is required.');
  positiveInteger(expectedVersion, 'ORDER_VERSION_INVALID', 'A positive expected order version is required.');
  if (!PAYMENT_TRANSITIONS[fromState] || !PAYMENT_TRANSITIONS[fromState].includes(toState)) {
    fail('ORDER_PAYMENT_TRANSITION_INVALID', 'The requested payment state transition is not allowed.');
  }
  return Object.freeze({ expectedState: fromState, nextState: toState, expectedVersion });
}

function mapError(error, fallbackCode = 'ORDER_SERVICE_UNAVAILABLE') {
  if (error instanceof OrderServiceError) return error;
  const mappings = {
    CART_NOT_FOUND: 'ORDER_CART_NOT_FOUND',
    CART_ACCESS_DENIED: 'ORDER_CART_NOT_FOUND',
    CART_EXPIRED: 'ORDER_CART_EXPIRED',
    CART_ABANDONED: 'ORDER_CART_INELIGIBLE',
    CART_ALREADY_CONVERTED: 'ORDER_CART_INELIGIBLE',
    CART_CHECKOUT_IN_PROGRESS: 'ORDER_CART_INELIGIBLE',
    CART_PENDING_CHECKOUT_LOCKED: 'ORDER_CART_INELIGIBLE',
    CART_PRODUCT_UNAVAILABLE: 'ORDER_PRODUCT_UNAVAILABLE',
    CART_INVALID_VARIATION: 'ORDER_CONFIGURATION_INVALID',
    CART_INVALID_PERSONALIZATION: 'ORDER_CONFIGURATION_INVALID',
    CART_QUANTITY_INVALID: 'ORDER_CONFIGURATION_INVALID',
    CART_PRICE_CHANGED: 'ORDER_PRICE_CHANGED',
    CART_CURRENCY_MISMATCH: 'ORDER_CURRENCY_INVALID',
    ORDER_NOT_FOUND: 'ORDER_NOT_FOUND',
  };
  const code = mappings[error && error.code] || fallbackCode;
  const messages = {
    ORDER_CART_NOT_FOUND: 'Cart not found.', ORDER_CART_EXPIRED: 'The cart has expired.',
    ORDER_CART_INELIGIBLE: 'The cart is not eligible for checkout.',
    ORDER_PRODUCT_UNAVAILABLE: 'A product is unavailable.',
    ORDER_CONFIGURATION_INVALID: 'A product configuration is invalid.',
    ORDER_PRICE_CHANGED: 'Product pricing changed during validation.',
    ORDER_CURRENCY_INVALID: 'The cart currency is invalid.', ORDER_NOT_FOUND: 'Order not found.',
  };
  return new OrderServiceError(code, messages[code] || 'The order operation could not be completed.', { cause: error });
}

function createOrderService({
  orderRepository = defaultOrderRepository,
  customerRepository = defaultCustomerRepository,
  cartService = defaultCartService,
  productService = defaultProductService,
  addressResolver,
  discountService,
  shippingService,
  taxService,
  taxPolicy,
  assetVerifier,
  now = () => new Date(),
} = {}) {
  async function validateSimpleItem(item) {
    const product = await productService.getProduct(requiredString(item.productId, 'ORDER_CONFIGURATION_INVALID', 'A product ID is required.'));
    if (!product || product.status !== 'active' || product.deletedAt || product.availableForSale === false) {
      fail('ORDER_PRODUCT_UNAVAILABLE', 'A product is unavailable.');
    }
    const quantity = positiveInteger(item.quantity, 'ORDER_CONFIGURATION_INVALID', 'A valid quantity is required.');
    const currency = product.currency || 'USD';
    if (currency !== 'USD') fail('ORDER_CURRENCY_INVALID', 'The cart currency is invalid.');
    if (!selectionSupported(item.sku, product.supportedSkus || product.skus || product.sku) ||
        !selectionSupported(item.variation, product.variations || product.variation) ||
        !selectionSupported(item.options, product.options) ||
        !selectionSupported(item.personalization, product.personalizationSchema || product.personalization)) {
      fail('ORDER_CONFIGURATION_INVALID', 'A product configuration is invalid.');
    }
    const unitPriceCents = nonNegativeMoney(product.basePrice);
    const lineTotalCents = nonNegativeMoney(unitPriceCents * quantity);
    return {
      cartItemId: item.cartItemId, cartItemType: 'SIMPLE', productId: product.productId || item.productId,
      productName: product.name, productSlug: product.slug, productVersion: product.version,
      pricingVersion: product.pricingVersion, sku: item.sku, variation: canonical(item.variation),
      options: canonical(item.options), personalization: canonical(item.personalization),
      designId: item.designId, uploadId: item.uploadId, quantity, currency, unitPriceCents,
      lineSubtotalCents: lineTotalCents, lineDiscountCents: 0, lineTotalCents,
    };
  }

  async function validateConfiguredItem(item) {
    if (typeof productService.evaluateCartConfiguration !== 'function') {
      fail('ORDER_CHECKOUT_VALIDATION_INCOMPLETE', 'Configured-product validation is unavailable.');
    }
    const evaluated = await productService.evaluateCartConfiguration(item.productId, {
      customerConfiguration: item.customerConfiguration,
      variantAllocations: item.variantAllocations,
      customerInstructions: item.customerInstructions,
    }, { assetVerifier });
    const quantity = positiveInteger(evaluated.totalQuantity, 'ORDER_CONFIGURATION_INVALID', 'A valid configured quantity is required.');
    const pricing = evaluated.pricingSnapshot || {};
    const currency = pricing.currency || evaluated.currency;
    if (currency !== 'USD') fail('ORDER_CURRENCY_INVALID', 'The cart currency is invalid.');
    const lineTotalCents = nonNegativeMoney(evaluated.lineTotalCents);
    return {
      cartItemId: item.cartItemId, cartItemType: 'CONFIGURED_JOB', productId: item.productId,
      baseSku: evaluated.baseSku, customerConfiguration: canonical(evaluated.customerConfiguration),
      variantAllocations: canonical(evaluated.variantAllocations), customerInstructions: evaluated.customerInstructions,
      quantity, totalQuantity: quantity, currency, lineSubtotalCents: lineTotalCents,
      lineDiscountCents: 0, lineTotalCents, pricingSnapshot: canonical(pricing),
      productVersion: pricing.productVersion, pricingVersion: pricing.pricingVersion,
    };
  }

  async function prepareOrder({ auth, checkoutInput = {}, idempotencyKey, expectedCartVersion } = {}) {
    try {
      inspectFields(checkoutInput, SECRET_FIELDS, 'ORDER_SENSITIVE_INPUT_REJECTED');
      inspectFields(checkoutInput, AUTHORITY_FIELDS, 'ORDER_CLIENT_AUTHORITY_REJECTED');
      const customerId = trustedIdentity(auth);
      const cartVersion = positiveInteger(expectedCartVersion, 'ORDER_CART_VERSION_INVALID', 'A positive expected cart version is required.');
      const key = normalizeIdempotencyKey(idempotencyKey);
      const customer = await customerRepository.getCustomerById(customerId);
      const contactSnapshot = validateCustomer(customer, customerId);
      const state = await cartService.getCurrentCart({ type: 'customer', sub: customerId });
      const cart = state && state.cart;
      const items = state && state.items;
      if (!cart || cart.customerId !== customerId) fail('ORDER_CART_NOT_FOUND', 'Cart not found.');
      if (cart.status !== 'active') fail('ORDER_CART_INELIGIBLE', 'The cart is not eligible for checkout.');
      if (cart.version !== cartVersion) fail('ORDER_CART_VERSION_CONFLICT', 'The cart changed; reload before checkout.');
      if (Number.isInteger(cart.expiresAt) && cart.expiresAt <= Math.floor(now().getTime() / 1000)) fail('ORDER_CART_EXPIRED', 'The cart has expired.');
      if (cart.convertedToOrderId) fail('ORDER_CART_INELIGIBLE', 'The cart is not eligible for checkout.');
      if (!Array.isArray(items) || items.length === 0) fail('ORDER_CART_INELIGIBLE', 'The cart has no eligible items.');
      if (items.length > 98) fail('ORDER_CHECKOUT_VALIDATION_INCOMPLETE', 'The cart exceeds the supported atomic order size.');
      inspectFields(items, SECRET_FIELDS, 'ORDER_SENSITIVE_INPUT_REJECTED');

      const itemSnapshots = [];
      for (const item of items) {
        itemSnapshots.push(item.cartItemType === 'CONFIGURED_JOB'
          ? await validateConfiguredItem(item)
          : await validateSimpleItem(item));
      }
      const subtotalCents = nonNegativeMoney(itemSnapshots.reduce((sum, item) => sum + item.lineSubtotalCents, 0));
      const requirements = [];
      let addressSnapshot;
      let discountTotalCents;
      let shippingCents;
      let taxCents;
      let taxStatus;
      if (typeof addressResolver === 'function') addressSnapshot = await addressResolver({ customerId, checkoutInput: canonical(checkoutInput) });
      else requirements.push('address_resolution');
      if (discountService && typeof discountService.calculate === 'function') discountTotalCents = nonNegativeMoney(await discountService.calculate({ customerId, cart, items: itemSnapshots, checkoutInput: canonical(checkoutInput) }));
      else requirements.push('discount_calculation');
      if (shippingService && typeof shippingService.calculate === 'function') shippingCents = nonNegativeMoney(await shippingService.calculate({ customerId, cart, items: itemSnapshots, checkoutInput: canonical(checkoutInput), addressSnapshot }));
      else requirements.push('shipping_calculation');
      if (taxPolicy?.status === 'disabled') {
        taxStatus = 'disabled';
        taxCents = null;
      } else if (taxService && typeof taxService.calculate === 'function') {
        taxStatus = 'calculated';
        taxCents = nonNegativeMoney(await taxService.calculate({ customerId, cart, items: itemSnapshots, checkoutInput: canonical(checkoutInput), addressSnapshot, subtotalCents, discountTotalCents, shippingCents }));
      } else requirements.push('tax_calculation');
      let totalCents;
      let preTaxTotalCents;
      if (requirements.length === 0) {
        if (discountTotalCents > subtotalCents) fail('ORDER_PRICE_INVALID', 'Discount exceeds subtotal.');
        preTaxTotalCents = nonNegativeMoney(subtotalCents - discountTotalCents + shippingCents);
        totalCents = nonNegativeMoney(preTaxTotalCents + (taxCents ?? 0));
      }
      const preparedAt = now().toISOString();
      const proposedOrder = {
        customerId, cartId: cart.cartId, cartVersion, currency: 'USD', contactSnapshot,
        ...(addressSnapshot !== undefined ? { addressSnapshot: canonical(addressSnapshot) } : {}),
        subtotalCents, merchandiseSubtotalCents: subtotalCents,
        ...(discountTotalCents !== undefined ? { discountCents: discountTotalCents } : {}),
        ...(discountTotalCents !== undefined ? { discountTotalCents } : {}),
        ...(shippingCents !== undefined ? { shippingCents } : {}),
        ...(preTaxTotalCents !== undefined ? { preTaxTotalCents } : {}),
        ...(taxStatus !== undefined ? { taxStatus } : {}),
        ...(taxCents !== undefined ? { taxCents } : {}),
        ...(totalCents !== undefined ? { totalCents } : {}),
        itemCount: itemSnapshots.length, preparedAt,
      };
      // Preparation time is observational metadata, not semantic checkout input.
      // Excluding it keeps retries deterministic while retaining every trusted
      // ownership, cart, price, configuration, address, and total field.
      const { preparedAt: ignoredPreparedAt, ...fingerprintOrder } = proposedOrder;
      const fingerprintInput = canonical({ customerId, cartId: cart.cartId, cartVersion, proposedOrder: fingerprintOrder, items: itemSnapshots });
      return deepFreeze({
        readyForDurableCreation: requirements.length === 0,
        requirements: Object.freeze(requirements),
        proposedOrder,
        proposedItems: itemSnapshots,
        idempotency: { key, scope: `${customerId}:${cart.cartId}:${cartVersion}`, fingerprint: fingerprint(fingerprintInput), payload: fingerprintInput },
      });
    } catch (error) {
      throw mapError(error);
    }
  }

  async function getOwnOrder({ auth, orderId } = {}) {
    try {
      const customerId = trustedIdentity(auth);
      const id = requiredString(orderId, 'ORDER_NOT_FOUND', 'Order not found.');
      const result = await orderRepository.getOrderWithItems(id);
      if (!result || !result.order || result.order.customerId !== customerId) fail('ORDER_NOT_FOUND', 'Order not found.');
      return result;
    } catch (error) {
      throw mapError(error, 'ORDER_READ_FAILED');
    }
  }

  async function listOwnOrders({ auth, pagination = {} } = {}) {
    try {
      const customerId = trustedIdentity(auth);
      if (!pagination || typeof pagination !== 'object' || Array.isArray(pagination)) fail('ORDER_PAGINATION_INVALID', 'Pagination is invalid.');
      const allowed = {};
      if (pagination.limit !== undefined) {
        if (!Number.isInteger(pagination.limit) || pagination.limit < 1 || pagination.limit > 100) fail('ORDER_PAGINATION_INVALID', 'Pagination is invalid.');
        allowed.limit = pagination.limit;
      }
      if (pagination.exclusiveStartKey !== undefined) allowed.exclusiveStartKey = pagination.exclusiveStartKey;
      return await orderRepository.listOrdersByCustomer(customerId, allowed);
    } catch (error) {
      throw mapError(error, 'ORDER_READ_FAILED');
    }
  }

  return { prepareOrder, getOwnOrder, listOwnOrders, validateOrderStateTransition, validatePaymentStateTransition };
}

module.exports = {
  createOrderService, OrderServiceError, ORDER_TRANSITIONS, PAYMENT_TRANSITIONS,
  normalizeIdempotencyKey, fingerprint, validateOrderStateTransition, validatePaymentStateTransition,
};
