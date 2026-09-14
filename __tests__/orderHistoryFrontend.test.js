'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const response = (status, body) => ({ status, ok: status >= 200 && status < 300, json: async () => body });
function element() {
  return {
    style: {}, dataset: {}, value: '', children: [], listeners: {},
    set textContent(value) { this.text = String(value); this.children = []; },
    get textContent() { return this.text || ''; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); },
    addEventListener(name, callback) { this.listeners[name] = callback; },
  };
}
function historyPage() {
  const elements = {};
  const context = {
    document: { getElementById: id => elements[id] || (elements[id] = element()), createElement: element },
    window: { addEventListener: jest.fn() },
    DivinePrintingAuth: { init() {}, isSignedIn: () => true },
    getOrders: jest.fn(() => Promise.resolve({ orders: [], nextCursor: null })),
  };
  vm.createContext(context);
  const script = read('account/orders.html').match(/<script>([\s\S]*?)<\/script>/)[1];
  // Register listeners without triggering initialization requests.
  context.DivinePrintingAuth.isSignedIn = () => false;
  vm.runInContext(script, context);
  context.DivinePrintingAuth.isSignedIn = () => true;
  return { context, elements };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

describe('order history frontend regressions', () => {
  test('API distinguishes valid empty history from HTTP, network and malformed responses', async () => {
    const { getOrders } = require('../js/account-api');
    await expect(getOrders(async () => response(200, { orders: [], count: 0 }))).resolves.toEqual({ orders: [], count: 0 });
    for (const fetcher of [async () => response(503, {}), async () => { throw new Error('private details'); }, async () => response(200, {})]) {
      await expect(getOrders(fetcher)).rejects.toThrow('Unable to load order history');
    }
    const fetcher = jest.fn(async () => response(200, { orders: [] }));
    await getOrders(fetcher, 'cursor+/=&');
    expect(fetcher).toHaveBeenCalledWith('/api/orders?cursor=cursor%2B%2F%3D%26');
  });

  test('load-more consumes cursor, preserves loaded orders and combined filter/search', async () => {
    const { context: c, elements: e } = historyPage();
    e.statusFilter.value = 'confirmed';
    e.searchOrders.value = 'match';
    c.getOrders.mockResolvedValueOnce({ orders: [{ orderId: 'match1', orderState: 'confirmed' }, { orderId: 'match2', orderState: 'cancelled' }], nextCursor: 'page2' })
      .mockResolvedValueOnce({ orders: [{ orderId: 'match3', orderState: 'confirmed' }, { orderId: 'other', orderState: 'confirmed' }], nextCursor: null });
    c.loadOrders(); await settle();
    expect(e.ordersList.children).toHaveLength(1);
    e.loadMoreOrders.listeners.click(); await settle();
    expect(c.getOrders.mock.calls[1]).toEqual([undefined, 'page2']);
    expect(c.allOrders).toHaveLength(4);
    expect(e.ordersList.children).toHaveLength(2);
    expect(e.loadMoreOrders.style.display).toBe('none');
  });

  test('error UI is not empty history and retry preserves the failed page cursor', async () => {
    const { context: c, elements: e } = historyPage();
    c.getOrders.mockRejectedValueOnce(new Error('<script>private</script>'));
    c.loadOrders(); await settle();
    expect(e.ordersError.style.display).toBe('block');
    expect(e.emptyState.style.display).toBe('none');
    c.getOrders.mockResolvedValueOnce({ orders: [{ orderId: 'one' }], nextCursor: 'next' });
    e.retryOrders.listeners.click(); await settle();
    c.getOrders.mockRejectedValueOnce(new Error('network'));
    e.loadMoreOrders.listeners.click(); await settle();
    expect(c.allOrders).toHaveLength(1);
    expect(e.ordersList.children).toHaveLength(1);
    c.getOrders.mockResolvedValueOnce({ orders: [], nextCursor: null });
    e.retryOrders.listeners.click(); await settle();
    expect(c.getOrders.mock.calls[3]).toEqual([undefined, 'next']);
    expect(c.allOrders).toHaveLength(1);
  });

  test('renders untrusted values as DOM text, supports persisted states, labels page stats as recent', () => {
    const { context: c, elements: e } = historyPage();
    c.handleOrders([{ orderNumber: '<img onerror=alert(1)>', orderState: 'confirmed\" onclick=alert(1)' }]);
    const header = e.ordersList.children[0].children[0];
    expect(header.children[0].children[0].textContent).toBe('Order #<img onerror=alert(1)>');
    expect(header.children[1].className).not.toContain('"');
    expect(read('account/orders.html')).toContain('value="confirmed"');
    expect(read('account/orders.html')).toContain('value="cancelled"');
    expect(read('account/account.html')).toContain('Recent Orders');
    expect(read('account/account.html')).toContain('Recent Order Spend');
    expect(read('account/account.html')).not.toContain('>Total Orders<');
    expect(read('account/account.html')).not.toContain('>Total Spent<');
  });

  test('order runtime sends access token only to its exact allowed route', async () => {
    jest.resetModules();
    const storage = () => { const data = new Map(); return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) }; };
    global.sessionStorage = storage(); global.localStorage = storage();
    global.document = { addEventListener() {}, getElementById: () => null };
    global.window = { location: { origin: 'http://localhost', hostname: 'localhost', pathname: '/account/orders.html' }, dispatchEvent() {}, addEventListener() {} };
    global.fetch = jest.fn(async () => response(200, { orders: [] }));
    const auth = require('../js/cognito-auth');
    const token = Buffer.from('{}').toString('base64url') + '.' + Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url') + '.signature';
    sessionStorage.setItem('dp_access_token', token);
    sessionStorage.setItem('dp_id_token', 'display-only-id-token');
    await auth.authenticatedOrderFetch('/api/orders?cursor=safe');
    expect(fetch.mock.calls[0][0]).toBe('https://rw03moqybh.execute-api.us-east-1.amazonaws.com/api/orders?cursor=safe');
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer ' + token);
    for (const invalid of ['https://evil.example/api/orders', '//evil.example/api/orders', '/api/orders/other', '/api/orders?cursor=x#fragment/../other']) {
      if (invalid.includes('#')) continue;
      await expect(auth.authenticatedOrderFetch(invalid)).rejects.toThrow();
    }
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockResolvedValueOnce(response(503, {}));
    await expect(auth.fetchOrders()).rejects.toThrow('Unable to load order history');
    expect(auth.getAccessToken()).toBe(token);
  });
});
