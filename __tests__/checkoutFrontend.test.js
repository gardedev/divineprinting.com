'use strict';

const fs = require('fs');
const path = require('path');

const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function loadCartApi({ response, authenticated = true } = {}) {
  jest.resetModules();
  global.sessionStorage = { getItem: jest.fn(), setItem: jest.fn(), removeItem: jest.fn() };
  global.getAccessToken = jest.fn(() => authenticated ? 'access-token' : null);
  global.authenticatedCartFetch = jest.fn();
  global.authenticatedCheckoutFetch = jest.fn(async () => ({
    ok: true,
    status: 201,
    json: async () => response || {
      orderId: 'order-1',
      checkoutUrl: 'https://checkout.stripe.com/c/pay/test',
      expiresAt: 1770000000,
    },
  }));
  return require('../js/cart-api');
}

describe('checkout redirect experience', () => {
  test('sends the authenticated cart id, version, and idempotency key', async () => {
    const api = loadCartApi();
    await api.startCheckout({ cartId: 'cart-1', version: 7 }, 'checkout-key-1');
    expect(global.authenticatedCheckoutFetch).toHaveBeenCalledWith('/api/checkout/session', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        'Idempotency-Key': 'checkout-key-1',
        'If-Match': '7',
      }),
      body: JSON.stringify({ checkoutInput: { cartId: 'cart-1' } }),
    }));
  });

  test('rejects anonymous, invalid-cart, and non-Stripe checkout responses', async () => {
    await expect(loadCartApi({ authenticated: false }).startCheckout({ cartId: 'cart-1', version: 1 })).rejects.toMatchObject({ code: 'CHECKOUT_AUTH_REQUIRED' });
    await expect(loadCartApi().startCheckout({ cartId: 'cart-1', version: 0 })).rejects.toMatchObject({ code: 'CHECKOUT_CART_INVALID' });
    await expect(loadCartApi({ response: { orderId: 'order-1', checkoutUrl: 'https://evil.example/pay' } }).startCheckout({ cartId: 'cart-1', version: 1 })).rejects.toMatchObject({ code: 'CHECKOUT_RESPONSE_INVALID' });
  });

  test('cart and result pages preserve payment authority and safe rendering', () => {
    const cartPage = read('js/cart-page.js');
    const successPage = read('checkout/success.html');
    const cancelPage = read('checkout/cancel.html');
    expect(cartPage).toContain('Continue to secure checkout');
    expect(cartPage).toContain('dp_checkout_pending_v1');
    expect(successPage).toContain('getOrders(undefined, cursor)');
    expect(successPage).toContain('textContent');
    expect(successPage).not.toContain('session_id');
    expect(successPage).not.toMatch(/paymentState\s*=\s*['"]paid/);
    expect(cancelPage).toContain('No payment status was changed by this page.');
  });
});

const vm = require('vm');
function element() {
  return { children: [], listeners: {}, style: {}, classList: { toggle() {}, add() {}, remove() {} },
    set textContent(value) { this.text = String(value); this.children = []; },
    get textContent() { return this.text || ''; },
    append(...nodes) { this.children.push(...nodes); }, appendChild(node) { this.children.push(node); },
    replaceChildren(...nodes) { this.children = nodes; },
    addEventListener(name, callback) { this.listeners[name] = callback; }, setAttribute() {},
  };
}
function browser(file, values = {}) {
  const elements = {};
  const store = new Map();
  const c = { URL, URLSearchParams, Set, Intl, console, setTimeout: () => {},
    sessionStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    document: { getElementById: id => elements[id] || (elements[id] = element()), createElement: element, addEventListener() {} },
    location: { href: '', hostname: 'localhost', pathname: '/cart.html', origin: 'http://localhost' },
    addEventListener() {}, getAccessToken: () => 'access', crypto: { randomUUID: () => 'attempt-key' },
    ...values };
  c.window = c;
  vm.createContext(c);
  if (file) vm.runInContext(file.endsWith('.html') ? read(file).match(/<script>([\s\S]*?)<\/script>/)[1] : read(file), c);
  return { c, elements, store };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('checkout behavioral recovery regressions', () => {
  test('informational toast cannot block checkout before any message is shown', () => {
    const { elements } = browser('js/cart-page.js');
    expect(elements.toast.textContent).toBe('');
    expect(elements.toast.style.pointerEvents).toBe('none');
  });

  test('real auth helper sends POST and access token to fixed checkout endpoint', async () => {
    const { c, store } = browser();
    const token = Buffer.from('{}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.signature';
    c.atob = value => Buffer.from(value, 'base64').toString();
    c.fetch = jest.fn(async () => ({ ok: true, status: 201, json: async () => ({ orderId: 'one', checkoutUrl: 'https://checkout.stripe.com/c/pay/test' }) }));
    store.set('dp_access_token', token); store.set('dp_id_token', 'never-send-id-token');
    vm.runInContext(read('js/cognito-auth.js'), c);
    vm.runInContext(read('js/cart-api.js'), c);
    await c.DivineCart.startCheckout({ cartId: 'cart', version: 4 }, 'key');
    expect(c.fetch).toHaveBeenCalledWith('https://rw03moqybh.execute-api.us-east-1.amazonaws.com/api/checkout/session', expect.objectContaining({ method: 'POST', body: JSON.stringify({ checkoutInput: { cartId: 'cart' } }), headers: expect.objectContaining({ Authorization: 'Bearer ' + token, 'If-Match': '4', 'Idempotency-Key': 'key' }) }));
    await expect(c.authenticatedCheckoutFetch('https://evil.example')).rejects.toThrow();
    expect(c.fetch).toHaveBeenCalledTimes(1);
  });

  test('automatic retries keep identical checkout identity', async () => {
    const api = loadCartApi();
    global.authenticatedCheckoutFetch.mockRejectedValueOnce(new Error('connection lost'));
    await api.startCheckout({ cartId: 'cart', version: 2 }, 'same-key');
    expect(global.authenticatedCheckoutFetch).toHaveBeenCalledTimes(2);
    expect(global.authenticatedCheckoutFetch.mock.calls[0]).toEqual(global.authenticatedCheckoutFetch.mock.calls[1]);
  });

  test.each(['https://checkout.stripe.com.evil.example/pay', 'https://checkout.stripe.com@evil.example/pay', 'javascript:alert(1)', 'https://checkout.stripe.com:444/pay', 'https://user@checkout.stripe.com/pay'])('rejects unsafe backend URL %s', async checkoutUrl => {
    await expect(loadCartApi({ response: { orderId: 'order', checkoutUrl } }).startCheckout({ cartId: 'cart', version: 1 })).rejects.toMatchObject({ code: 'CHECKOUT_RESPONSE_INVALID' });
  });

  test('cart prevents duplicate submits, survives storage failure and redirects only to result', async () => {
    let finish;
    const checkout = jest.fn(() => new Promise(resolve => { finish = resolve; }));
    const { c } = browser('js/cart-page.js', { DivineCart: { startCheckout: checkout } });
    c.sessionStorage.setItem = () => { throw new Error('blocked'); };
    const first = c.DivineCartPage.startCheckout({ cartId: 'cart', version: 1 });
    await c.DivineCartPage.startCheckout({ cartId: 'cart', version: 1 });
    expect(checkout).toHaveBeenCalledTimes(1);
    finish({ orderId: 'one', checkoutUrl: 'https://checkout.stripe.com/c/pay/test' });
    await first;
    expect(c.location.href).toBe('https://checkout.stripe.com/c/pay/test');
  });

  test('cancel return resumes original key and version after backend locks cart', async () => {
    const checkout = jest.fn(async () => ({ orderId: 'one', checkoutUrl: 'https://checkout.stripe.com/c/pay/test' }));
    const { c, store } = browser('js/cart-page.js', { DivineCart: { startCheckout: checkout } });
    store.set('dp_checkout_attempt_v1', JSON.stringify({ cartId: 'cart', version: 3, key: 'original' }));
    await c.DivineCartPage.startCheckout({ cartId: 'cart', version: 4, status: 'pending_checkout' });
    expect(checkout).toHaveBeenCalledWith({ cartId: 'cart', version: 3 }, 'original');
  });

  test('success uses paginated authenticated records and renders hostile strings as text', async () => {
    const getOrders = jest.fn().mockResolvedValueOnce({ orders: [], nextCursor: 'page2' }).mockResolvedValueOnce({ orders: [{ orderId: 'one', orderNumber: '<img onerror=alert(1)>', orderState: 'checkout_pending', paymentState: 'checkout_session_created' }] });
    const { c, store, elements: e } = browser(null, { getOrders });
    store.set('dp_checkout_pending_v1', JSON.stringify({ orderId: 'one', paymentState: 'paid' }));
    c.location.search = '?paymentState=paid&session_id=fake';
    vm.runInContext(read('checkout/success.html').match(/<script>([\s\S]*?)<\/script>/)[1], c);
    await settle();
    expect(getOrders.mock.calls).toEqual([[undefined, undefined], [undefined, 'page2']]);
    expect(e.orderStatus.children[0].textContent).toBe('Order <img onerror=alert(1)>');
    expect(e.orderStatus.children[2].textContent).toBe('Payment status: checkout session created');
    expect(e.statusMessage.textContent).toContain('not payment confirmation');
  });

  test('success handles missing context, sign-in, errors and manual refresh', async () => {
    const getOrders = jest.fn().mockRejectedValueOnce(new Error('private failure')).mockResolvedValueOnce({ orders: [{ orderId: 'one' }] });
    const { c, store, elements: e } = browser('checkout/success.html', { getOrders, getAccessToken: () => null });
    expect(e.statusMessage.textContent).toContain('Sign in'); expect(getOrders).not.toHaveBeenCalled();
    c.getAccessToken = () => 'access'; await e.refreshStatus.listeners.click();
    expect(e.statusMessage.textContent).toContain('No local order context');
    store.set('dp_checkout_pending_v1', JSON.stringify({ orderId: 'one' }));
    await e.refreshStatus.listeners.click();
    expect(e.statusMessage.textContent).toContain('Refresh to try again');
    await e.refreshStatus.listeners.click();
    expect(e.orderStatus.children[2].textContent).toBe('Payment status: unavailable');
    expect(e.refreshStatus.disabled).toBe(false);
  });
});
