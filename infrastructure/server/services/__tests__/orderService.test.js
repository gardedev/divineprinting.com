'use strict';

jest.mock('../../repositories/orderRepository', () => ({ createOrderRepository: jest.fn(() => ({})) }));
jest.mock('../../repositories/customerRepository', () => ({}));
jest.mock('../../carts/cartService', () => ({ createCartService: jest.fn(() => ({})) }));
jest.mock('../../products/productService', () => ({}));

const {
  createOrderService,
  ORDER_TRANSITIONS,
  PAYMENT_TRANSITIONS,
  normalizeIdempotencyKey,
  fingerprint,
} = require('../orderService');

const auth = { sub: 'customer-sub-1', email: 'claim@example.com', emailVerified: true, groups: ['customer'] };
const customer = {
  customerId: 'customer-sub-1', cognitoSub: 'customer-sub-1', accountStatus: 'active', emailVerified: true,
  emailDisplay: 'Trusted@Example.com', emailNormalized: 'trusted@example.com', version: 3,
};
const cart = { cartId: 'cart-1', customerId: 'customer-sub-1', status: 'active', version: 7, expiresAt: 1999999999 };
const simpleItem = {
  cartItemId: 'item-1', productId: 'product-1', quantity: 2, unitPriceCents: 1,
  lineTotalCents: 2, variation: { color: 'Blue' }, personalization: { text: 'Church' },
};
const product = {
  productId: 'product-1', name: 'Custom Shirt', slug: 'custom-shirt', status: 'active',
  availableForSale: true, basePrice: 1200, currency: 'USD', version: 5, pricingVersion: 9,
  variations: [{ color: 'Blue' }], personalization: [{ text: 'Church' }],
};

function setup(overrides = {}) {
  const orderRepository = {
    getOrderWithItems: jest.fn(), listOrdersByCustomer: jest.fn(), ...overrides.orderRepository,
  };
  const customerRepository = {
    getCustomerById: jest.fn().mockResolvedValue(customer), ...overrides.customerRepository,
  };
  const cartService = {
    getCurrentCart: jest.fn().mockResolvedValue({ cart, items: [simpleItem] }), ...overrides.cartService,
  };
  const productService = {
    getProduct: jest.fn().mockResolvedValue(product),
    evaluateCartConfiguration: jest.fn(), ...overrides.productService,
  };
  const dependencies = {
    orderRepository, customerRepository, cartService, productService,
    now: () => new Date('2026-08-25T12:00:00.000Z'),
    ...overrides.dependencies,
  };
  return { orderRepository, customerRepository, cartService, productService, service: createOrderService(dependencies) };
}

function completeAuthorities() {
  return {
    addressResolver: jest.fn().mockResolvedValue({ shipping: { countryCode: 'US', postalCode: '21201' } }),
    discountService: { calculate: jest.fn().mockResolvedValue(100) },
    shippingService: { calculate: jest.fn().mockResolvedValue(500) },
    taxService: { calculate: jest.fn().mockResolvedValue(200) },
  };
}

async function prepare(service, changes = {}) {
  return service.prepareOrder({
    auth, checkoutInput: { shippingAddressId: 'address-1' }, idempotencyKey: 'checkout-key-0001',
    expectedCartVersion: 7, ...changes,
  });
}

describe('OrderService Option A preparation', () => {
  test('prepares a verified customer order without writing through OrderRepository', async () => {
    const authorities = completeAuthorities();
    const { service, orderRepository, customerRepository, cartService, productService } = setup({ dependencies: authorities });
    const result = await prepare(service);
    expect(customerRepository.getCustomerById).toHaveBeenCalledWith('customer-sub-1');
    expect(cartService.getCurrentCart).toHaveBeenCalledWith({ type: 'customer', sub: 'customer-sub-1' });
    expect(productService.getProduct).toHaveBeenCalledWith('product-1');
    expect(result).toMatchObject({
      readyForDurableCreation: true, requirements: [],
      proposedOrder: {
        customerId: 'customer-sub-1', cartId: 'cart-1', cartVersion: 7, currency: 'USD',
        contactSnapshot: { email: 'Trusted@Example.com', emailNormalized: 'trusted@example.com' },
        subtotalCents: 2400, discountTotalCents: 100, shippingCents: 500, taxCents: 200, totalCents: 3000,
      },
      proposedItems: [{ unitPriceCents: 1200, lineTotalCents: 2400 }],
    });
    expect(orderRepository.createOrderWithItems).toBeUndefined();
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.proposedItems[0])).toBe(true);
  });

  test('accepts an access-token identity without email_verified when the authoritative customer is verified', async () => {
    const { service, customerRepository } = setup({ dependencies: completeAuthorities() });
    const result = await prepare(service, { auth: { sub: 'customer-sub-1', groups: ['customer'] } });
    expect(customerRepository.getCustomerById).toHaveBeenCalledWith('customer-sub-1');
    expect(result.proposedOrder.customerId).toBe('customer-sub-1');
  });

  test('rejects authoritative unverified email even when request authentication claims verification', async () => {
    const { service } = setup({ customerRepository: { getCustomerById: jest.fn().mockResolvedValue({ ...customer, emailVerified: false }) } });
    await expect(prepare(service, { auth: { sub: 'customer-sub-1', emailVerified: true, groups: ['customer'] } })).rejects.toMatchObject({ code: 'ORDER_EMAIL_UNVERIFIED' });
  });

  test('rejects browser-provided email verification authority before customer lookup', async () => {
    const { service, customerRepository } = setup({ customerRepository: { getCustomerById: jest.fn().mockResolvedValue({ ...customer, emailVerified: false }) } });
    await expect(prepare(service, { auth: { sub: 'customer-sub-1', groups: ['customer'] }, checkoutInput: { emailVerified: true } })).rejects.toMatchObject({ code: 'ORDER_CLIENT_AUTHORITY_REJECTED' });
    expect(customerRepository.getCustomerById).not.toHaveBeenCalled();
  });

  test('represents disabled tax as nullable and never as calculated zero', async () => {
    const { service } = setup({ dependencies: {
      addressResolver: jest.fn().mockResolvedValue({ collectionAuthority: 'stripe_checkout' }),
      discountService: { calculate: jest.fn().mockResolvedValue(0) },
      shippingService: { calculate: jest.fn().mockResolvedValue(795) },
      taxPolicy: { status: 'disabled' },
    } });
    const result = await prepare(service, { checkoutInput: {} });
    expect(result.readyForDurableCreation).toBe(true);
    expect(result.proposedOrder).toMatchObject({ merchandiseSubtotalCents: 2400, shippingCents: 795, discountCents: 0, preTaxTotalCents: 3195, taxStatus: 'disabled', taxCents: null, totalCents: 3195 });
  });

  test('derives identity only from auth.sub and rejects client ownership authority', async () => {
    const { service, customerRepository } = setup();
    await expect(prepare(service, { checkoutInput: { customerId: 'attacker' } })).rejects.toMatchObject({ code: 'ORDER_CLIENT_AUTHORITY_REJECTED' });
    await expect(prepare(service, { checkoutInput: { nested: { email: 'attacker@example.com' } } })).rejects.toMatchObject({ code: 'ORDER_CLIENT_AUTHORITY_REJECTED' });
    expect(customerRepository.getCustomerById).not.toHaveBeenCalled();
  });

  test.each([
    [undefined, 'ORDER_AUTH_REQUIRED'],
    [{ emailVerified: true }, 'ORDER_AUTH_REQUIRED'],
  ])('rejects invalid trusted authentication %p', async (badAuth, code) => {
    const { service } = setup();
    await expect(prepare(service, { auth: badAuth })).rejects.toMatchObject({ code });
  });

  test.each([
    ['pending_profile', 'ORDER_PROFILE_INCOMPLETE'], ['disabled', 'ORDER_ACCOUNT_INELIGIBLE'],
    ['deletion_requested', 'ORDER_ACCOUNT_INELIGIBLE'], ['deleted', 'ORDER_ACCOUNT_INELIGIBLE'],
    ['merged', 'ORDER_ACCOUNT_INELIGIBLE'],
  ])('rejects %s customer lifecycle', async (accountStatus, code) => {
    const { service } = setup({ customerRepository: { getCustomerById: jest.fn().mockResolvedValue({ ...customer, accountStatus }) } });
    await expect(prepare(service)).rejects.toMatchObject({ code });
  });

  test('rejects missing authoritative customer and mismatched customer identity', async () => {
    let service = setup({ customerRepository: { getCustomerById: jest.fn().mockResolvedValue(null) } }).service;
    await expect(prepare(service)).rejects.toMatchObject({ code: 'ORDER_ACCOUNT_INELIGIBLE' });
    service = setup({ customerRepository: { getCustomerById: jest.fn().mockResolvedValue({ ...customer, customerId: 'other' }) } }).service;
    await expect(prepare(service)).rejects.toMatchObject({ code: 'ORDER_ACCOUNT_INELIGIBLE' });
    service = setup({ customerRepository: { getCustomerById: jest.fn().mockResolvedValue({ ...customer, cognitoSub: 'other' }) } }).service;
    await expect(prepare(service)).rejects.toMatchObject({ code: 'ORDER_ACCOUNT_INELIGIBLE' });
  });

  test.each([
    [{ ...cart, customerId: 'other' }, 'ORDER_CART_NOT_FOUND'],
    [{ ...cart, status: 'pending_checkout' }, 'ORDER_CART_INELIGIBLE'],
    [{ ...cart, status: 'expired' }, 'ORDER_CART_INELIGIBLE'],
    [{ ...cart, status: 'converted' }, 'ORDER_CART_INELIGIBLE'],
    [{ ...cart, convertedToOrderId: 'order-1' }, 'ORDER_CART_INELIGIBLE'],
    [{ ...cart, expiresAt: 1 }, 'ORDER_CART_EXPIRED'],
  ])('rejects an ineligible cart %#', async (badCart, code) => {
    const { service } = setup({ cartService: { getCurrentCart: jest.fn().mockResolvedValue({ cart: badCart, items: [simpleItem] }) } });
    await expect(prepare(service)).rejects.toMatchObject({ code });
  });

  test('requires exact expected cart version and eligible nonempty items', async () => {
    let service = setup().service;
    await expect(prepare(service, { expectedCartVersion: 6 })).rejects.toMatchObject({ code: 'ORDER_CART_VERSION_CONFLICT' });
    await expect(prepare(service, { expectedCartVersion: 0 })).rejects.toMatchObject({ code: 'ORDER_CART_VERSION_INVALID' });
    service = setup({ cartService: { getCurrentCart: jest.fn().mockResolvedValue({ cart, items: [] }) } }).service;
    await expect(prepare(service)).rejects.toMatchObject({ code: 'ORDER_CART_INELIGIBLE' });
  });

  test('reprices SIMPLE items authoritatively and preserves supported immutable selections', async () => {
    const { service } = setup({ dependencies: completeAuthorities() });
    const result = await prepare(service);
    expect(result.proposedItems[0]).toMatchObject({
      productId: 'product-1', productName: 'Custom Shirt', productVersion: 5, pricingVersion: 9,
      quantity: 2, unitPriceCents: 1200, lineSubtotalCents: 2400,
      variation: { color: 'Blue' }, personalization: { text: 'Church' },
    });
    expect(result.proposedItems[0].unitPriceCents).not.toBe(simpleItem.unitPriceCents);
  });

  test.each([
    [null, 'ORDER_PRODUCT_UNAVAILABLE'],
    [{ ...product, status: 'draft' }, 'ORDER_PRODUCT_UNAVAILABLE'],
    [{ ...product, availableForSale: false }, 'ORDER_PRODUCT_UNAVAILABLE'],
    [{ ...product, currency: 'EUR' }, 'ORDER_CURRENCY_INVALID'],
    [{ ...product, basePrice: 1.5 }, 'ORDER_PRICE_INVALID'],
  ])('rejects invalid authoritative product %#', async (trustedProduct, code) => {
    const { service } = setup({ productService: { getProduct: jest.fn().mockResolvedValue(trustedProduct) } });
    await expect(prepare(service)).rejects.toMatchObject({ code });
  });

  test('revalidates SIMPLE variation and personalization against the current product', async () => {
    const stale = { ...simpleItem, variation: { color: 'Retired color' } };
    const { service } = setup({ cartService: { getCurrentCart: jest.fn().mockResolvedValue({ cart, items: [stale] }) } });
    await expect(prepare(service)).rejects.toMatchObject({ code: 'ORDER_CONFIGURATION_INVALID' });
  });

  test('builds configured-job and grouped-allocation snapshots from authoritative evaluation', async () => {
    const configured = {
      cartItemId: 'configured-1', cartItemType: 'CONFIGURED_JOB', productId: 'shirt',
      customerConfiguration: { design: 'template-1' },
      variantAllocations: [{ selections: { size: 'M' }, quantity: 10 }], customerInstructions: 'Front only',
    };
    const evaluateCartConfiguration = jest.fn().mockResolvedValue({
      baseSku: 'SHIRT', customerConfiguration: configured.customerConfiguration,
      variantAllocations: [
        { selections: { size: 'M' }, quantity: 10, variantSurchargeCents: 0 },
        { selections: { size: '2XL' }, quantity: 5, variantSurchargeCents: 200 },
      ],
      customerInstructions: 'Front only', totalQuantity: 15, lineTotalCents: 28000,
      pricingSnapshot: { currency: 'USD', productVersion: 4, pricingVersion: 8, tier: { baseUnitPriceCents: 1800 } },
    });
    const { service } = setup({
      cartService: { getCurrentCart: jest.fn().mockResolvedValue({ cart, items: [configured] }) },
      productService: { evaluateCartConfiguration }, dependencies: completeAuthorities(),
    });
    const result = await prepare(service);
    expect(evaluateCartConfiguration).toHaveBeenCalledWith('shirt', expect.objectContaining({ variantAllocations: configured.variantAllocations }), expect.any(Object));
    expect(result.proposedItems[0]).toMatchObject({
      cartItemType: 'CONFIGURED_JOB', baseSku: 'SHIRT', quantity: 15, lineTotalCents: 28000,
      variantAllocations: expect.arrayContaining([expect.objectContaining({ selections: { size: '2XL' }, quantity: 5 })]),
    });
  });

  test('fails closed when configured validation is unavailable', async () => {
    const configured = { cartItemType: 'CONFIGURED_JOB', productId: 'shirt', customerConfiguration: {}, variantAllocations: [] };
    const { service } = setup({ cartService: { getCurrentCart: jest.fn().mockResolvedValue({ cart, items: [configured] }) }, productService: { evaluateCartConfiguration: undefined } });
    await expect(prepare(service)).rejects.toMatchObject({ code: 'ORDER_CHECKOUT_VALIDATION_INCOMPLETE' });
  });

  test('reports missing future checkout authorities without inventing totals', async () => {
    const { service } = setup();
    const result = await prepare(service);
    expect(result.readyForDurableCreation).toBe(false);
    expect(result.requirements).toEqual(['address_resolution', 'discount_calculation', 'shipping_calculation', 'tax_calculation']);
    expect(result.proposedOrder).toMatchObject({ subtotalCents: 2400 });
    expect(result.proposedOrder).not.toHaveProperty('discountTotalCents');
    expect(result.proposedOrder).not.toHaveProperty('shippingCents');
    expect(result.proposedOrder).not.toHaveProperty('taxCents');
    expect(result.proposedOrder).not.toHaveProperty('totalCents');
  });

  test('rejects sensitive fields recursively before calling collaborators', async () => {
    const { service, cartService } = setup();
    await expect(prepare(service, { checkoutInput: { nested: { cardNumber: '4111111111111111' } } })).rejects.toMatchObject({ code: 'ORDER_SENSITIVE_INPUT_REJECTED' });
    expect(cartService.getCurrentCart).not.toHaveBeenCalled();
  });

  test('rejects sensitive fields returned from the cart boundary', async () => {
    const unsafe = { ...simpleItem, personalization: { accessToken: 'secret' } };
    const { service } = setup({ cartService: { getCurrentCart: jest.fn().mockResolvedValue({ cart, items: [unsafe] }) } });
    await expect(prepare(service)).rejects.toMatchObject({ code: 'ORDER_SENSITIVE_INPUT_REJECTED' });
  });

  test('prepares stable canonical idempotency scope and fingerprint', async () => {
    const dependencies = completeAuthorities();
    const first = await prepare(setup({ dependencies }).service, { checkoutInput: { b: 2, a: 1 } });
    const second = await prepare(setup({ dependencies: completeAuthorities() }).service, { checkoutInput: { a: 1, b: 2 } });
    expect(first.idempotency.scope).toBe('customer-sub-1:cart-1:7');
    expect(first.idempotency.key).toBe('checkout-key-0001');
    expect(first.idempotency.fingerprint).toBe(second.idempotency.fingerprint);
    expect(first.idempotency.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  test('does not include observational preparation time in the idempotency fingerprint', async () => {
    let tick = 0;
    const authorities = completeAuthorities();
    const { service } = setup({ dependencies: {
      ...authorities,
      now: () => new Date(Date.parse('2026-08-25T12:00:00.000Z') + (tick++ * 60000)),
    } });
    const first = await prepare(service);
    const second = await prepare(service);
    expect(first.proposedOrder.preparedAt).not.toBe(second.proposedOrder.preparedAt);
    expect(first.idempotency.fingerprint).toBe(second.idempotency.fingerprint);
    expect(first.idempotency.payload.proposedOrder).not.toHaveProperty('preparedAt');
  });

  test.each(['short', 'contains spaces', 'x'.repeat(129)])('rejects invalid idempotency key %p', async (idempotencyKey) => {
    await expect(prepare(setup().service, { idempotencyKey })).rejects.toMatchObject({ code: 'ORDER_IDEMPOTENCY_INVALID' });
  });

  test('canonical fingerprint is key-order independent', () => {
    expect(fingerprint({ b: [2, { y: 1, x: 0 }], a: 1 })).toBe(fingerprint({ a: 1, b: [2, { x: 0, y: 1 }] }));
    expect(normalizeIdempotencyKey(' key-0001 ')).toBe('key-0001');
  });

  test('translates cart/provider errors without exposing provider messages', async () => {
    const raw = Object.assign(new Error('secret provider detail'), { code: 'CART_PRICE_CHANGED' });
    const { service } = setup({ cartService: { getCurrentCart: jest.fn().mockRejectedValue(raw) } });
    await expect(prepare(service)).rejects.toMatchObject({ code: 'ORDER_PRICE_CHANGED', message: 'Product pricing changed during validation.' });
  });
});

describe('OrderService ownership-safe reads', () => {
  test('returns an owned order and its items', async () => {
    const result = { order: { orderId: 'order-1', customerId: 'customer-sub-1' }, items: [{ orderItemId: 'item' }] };
    const { service } = setup({ orderRepository: { getOrderWithItems: jest.fn().mockResolvedValue(result) } });
    await expect(service.getOwnOrder({ auth, orderId: 'order-1' })).resolves.toBe(result);
  });

  test('makes absent and foreign orders indistinguishable', async () => {
    let service = setup({ orderRepository: { getOrderWithItems: jest.fn().mockResolvedValue({ order: { customerId: 'other' }, items: [] }) } }).service;
    await expect(service.getOwnOrder({ auth, orderId: 'order-1' })).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND', message: 'Order not found.' });
    const missing = Object.assign(new Error('database says missing'), { code: 'ORDER_NOT_FOUND' });
    service = setup({ orderRepository: { getOrderWithItems: jest.fn().mockRejectedValue(missing) } }).service;
    await expect(service.getOwnOrder({ auth, orderId: 'order-1' })).rejects.toMatchObject({ code: 'ORDER_NOT_FOUND', message: 'Order not found.' });
  });

  test('lists only by trusted sub and bounds pagination', async () => {
    const listOrdersByCustomer = jest.fn().mockResolvedValue({ orders: [], lastEvaluatedKey: undefined });
    const { service } = setup({ orderRepository: { listOrdersByCustomer } });
    await service.listOwnOrders({ auth, pagination: { limit: 25, customerId: 'attacker' } });
    expect(listOrdersByCustomer).toHaveBeenCalledWith('customer-sub-1', { limit: 25 });
    await expect(service.listOwnOrders({ auth, pagination: { limit: 101 } })).rejects.toMatchObject({ code: 'ORDER_PAGINATION_INVALID' });
  });

  test('maps repository read failures to safe errors', async () => {
    const getOrderWithItems = jest.fn().mockRejectedValue(new Error('AWS request secret'));
    const { service } = setup({ orderRepository: { getOrderWithItems } });
    await expect(service.getOwnOrder({ auth, orderId: 'order-1' })).rejects.toMatchObject({ code: 'ORDER_READ_FAILED', message: 'The order operation could not be completed.' });
  });
});

describe('ADR 0005 transition policies', () => {
  test.each(Object.entries(ORDER_TRANSITIONS).flatMap(([from, targets]) => targets.map((to) => [from, to])))('allows order %s -> %s', (fromState, toState) => {
    expect(setup().service.validateOrderStateTransition(fromState, toState, 2)).toEqual({ expectedState: fromState, nextState: toState, expectedVersion: 2 });
  });

  test.each([
    ['checkout_pending', 'fulfilled'], ['submitted', 'paid'], ['fulfilled', 'submitted'], ['canceled', 'checkout_pending'],
  ])('rejects order %s -> %s', (fromState, toState) => {
    expect(() => setup().service.validateOrderStateTransition(fromState, toState, 1)).toThrow(expect.objectContaining({ code: 'ORDER_STATE_TRANSITION_INVALID' }));
  });

  test.each(Object.entries(PAYMENT_TRANSITIONS).flatMap(([from, targets]) => targets.map((to) => [from, to])))('allows trusted payment %s -> %s', (fromState, toState) => {
    expect(setup().service.validatePaymentStateTransition({ actor: { trustedSystem: true }, fromState, toState, expectedVersion: 3 })).toEqual({ expectedState: fromState, nextState: toState, expectedVersion: 3 });
  });

  test('rejects browser payment authority, invalid transitions, and invalid versions', () => {
    const { service } = setup();
    expect(() => service.validatePaymentStateTransition({ actor: { groups: ['customer'] }, fromState: 'not_started', toState: 'checkout_session_created', expectedVersion: 1 })).toThrow(expect.objectContaining({ code: 'ORDER_PAYMENT_AUTHORITY_REQUIRED' }));
    expect(() => service.validatePaymentStateTransition({ actor: { trustedSystem: true }, fromState: 'paid', toState: 'failed', expectedVersion: 1 })).toThrow(expect.objectContaining({ code: 'ORDER_PAYMENT_TRANSITION_INVALID' }));
    expect(() => service.validateOrderStateTransition('submitted', 'in_production', 0)).toThrow(expect.objectContaining({ code: 'ORDER_VERSION_INVALID' }));
  });
});

describe('Option A boundary', () => {
  test('does not expose durable creation or persistence operations', () => {
    const service = setup().service;
    expect(service.createPendingOrder).toBeUndefined();
    expect(service.createOrder).toBeUndefined();
    expect(Object.keys(service).sort()).toEqual([
      'getOwnOrder', 'listOwnOrders', 'prepareOrder', 'validateOrderStateTransition', 'validatePaymentStateTransition',
    ].sort());
  });
});
