'use strict';

/**
 * RUNTIME regression tests for church-t-shirt.html cart flow.
 *
 * These tests EXECUTE the actual scripts (cart-api.js, standard-product-cart.js)
 * AND the actual inline addToCart() function extracted from church-t-shirt.html
 * in a simulated browser scope using Node's vm module.
 *
 * Static source-inspection is intentionally avoided for items 2–6.
 * The vm context uses `window` as the global so `window.updateCartBadge()` and
 * `window.location.href` resolve exactly as they would in a browser.
 *
 * Validated:
 *   1. window.updateCartBadge exists after standard-product-cart.js executes.
 *   2. Successful DivineCart.addConfiguredJob resolves.
 *   3. Actual T-shirt addToCart() success path calls window.updateCartBadge.
 *   4. Actual T-shirt addToCart() success path reaches window.location.href="/cart.html"
 *      without ReferenceError.
 *   5. Failed add does NOT redirect.
 *   6. Failed add displays the error message.
 *   7. Cart badge initialization loads current cart on DOMContentLoaded.
 *   8. Configured-job totalQuantity contributes to the badge count.
 */

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

const root = path.join(__dirname, '..');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Extract the first inline <script> block from church-t-shirt.html that
 * contains "addToCart" (the page's own inline functions).
 */
function extractPageInlineScript() {
  const html = fs.readFileSync(path.join(root, 'products/church-t-shirt.html'), 'utf8');
  // Match every <script> block that has no src attribute
  const re = /<script(?!\s+src)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1].includes('addToCart')) return m[1];
  }
  throw new Error('Could not find addToCart inline script block in church-t-shirt.html');
}

/**
 * Build a minimal fake browser window scope, load cart-api.js and
 * standard-product-cart.js into it, then optionally load the page's own
 * inline script (which defines addToCart, toggleMobileMenu, etc.).
 *
 * @param {object} opts
 * @param {object|null}  opts.sessionCart     pre-seeded anonymous session
 * @param {function}     opts.fetchImpl       stub for global.fetch
 * @param {function}     opts.getAccessToken  stub for global.getAccessToken
 * @param {function}     opts.buildJobStub    stub for buildConfiguredJobRequest
 * @param {boolean}      opts.loadPageScript  if true, also execute addToCart etc.
 */
function buildScope(opts = {}) {
  const {
    sessionCart    = null,
    fetchImpl      = null,
    getAccessToken = null,
    buildJobStub   = null,
    loadPageScript = false,
  } = opts;

  // ── sessionStorage shim ──────────────────────────────────────────────────
  const _store = {};
  const sessionStorage = {
    getItem:    (k) => Object.prototype.hasOwnProperty.call(_store, k) ? _store[k] : null,
    setItem:    (k, v) => { _store[k] = v; },
    removeItem: (k) => { delete _store[k]; },
  };
  if (sessionCart) {
    sessionStorage.setItem(
      'dp_anonymous_cart_v1',
      JSON.stringify({ cartId: sessionCart.cartId, cartToken: sessionCart.cartToken })
    );
  }

  // ── DOM shims ────────────────────────────────────────────────────────────
  const _domListeners = {};
  const _cartBadge    = { textContent: '0', style: { display: 'flex' }, _id: 'cart-count' };
  const _cartMessage  = { textContent: '' };

  const document = {
    getElementById:   (id) => {
      if (id === 'cart-count')  return _cartBadge;
      if (id === 'cartMessage') return _cartMessage;
      if (id === 'mobile-menu') return { classList: { toggle: () => {}, contains: () => false }, dataset: {} };
      return null;
    },
    querySelector:    ()  => null,
    querySelectorAll: ()  => [],
    body: { style: {} },
    addEventListener: (ev, fn) => {
      if (!_domListeners[ev]) _domListeners[ev] = [];
      _domListeners[ev].push(fn);
    },
  };

  // ── location shim ────────────────────────────────────────────────────────
  const location = { href: '', search: '' };

  // ── window / global scope ────────────────────────────────────────────────
  // The scope object IS `window`.  cart-api.js and standard-product-cart.js
  // both do  `(function(global){...}(window))` so `window` must be the ctx.
  const scope = {
    document,
    sessionStorage,
    location,
    fetch:          fetchImpl      || (() => Promise.reject(new Error('fetch not configured'))),
    getAccessToken: getAccessToken || (() => null),
    crypto:         { randomUUID: () => `${Date.now()}-${Math.random().toString(36).slice(2)}` },
    CustomEvent:    class CustomEvent { constructor(t, d) { this.type = t; this.detail = d && d.detail; } },
    addEventListener: () => {},
    dispatchEvent:    () => {},
    // Test-internal helpers (not visible to executed scripts via `window`)
    _cartBadge,
    _cartMessage,
    _domListeners,
    _fireDOMContentLoaded: () => {
      (_domListeners['DOMContentLoaded'] || []).forEach((fn) => fn());
    },
  };

  // `window` must self-reference so `window.updateCartBadge()` resolves.
  scope.window = scope;

  const ctx = vm.createContext(scope);

  // Execute cart-api.js → attaches scope.DivineCart
  vm.runInContext(
    fs.readFileSync(path.join(root, 'js/cart-api.js'), 'utf8'),
    ctx, { filename: 'cart-api.js' }
  );

  // Execute standard-product-cart.js → attaches scope.updateCartBadge,
  // scope.toggleMobileMenu, and wires the DOMContentLoaded handler.
  vm.runInContext(
    fs.readFileSync(path.join(root, 'js/standard-product-cart.js'), 'utf8'),
    ctx, { filename: 'standard-product-cart.js' }
  );

  if (loadPageScript) {
    // Provide the buildConfiguredJobRequest stub BEFORE the inline script runs
    // so the page's addToCart() can call it.
    if (buildJobStub) {
      scope.buildConfiguredJobRequest = buildJobStub;
    }
    // Execute the page's own inline script (defines addToCart, toggleMobileMenu, etc.)
    vm.runInContext(extractPageInlineScript(), ctx, { filename: 'church-t-shirt.html:inline' });
  }

  return scope;
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function mockJob() {
  return {
    productId: 'd204cea4-ce22-4bc5-ad04-530f19fb3878',
    customerConfiguration: {
      schemaVersion: 'custom-design-v1',
      options: { color: 'White', placement: 'center-chest', designSource: 'TEMPLATE' },
    },
    variantAllocations: [
      { selections: { size: 'L' }, quantity: 25 },
    ],
  };
}

function successFetch(items) {
  return () => Promise.resolve({
    ok: true, status: 200,
    json: () => Promise.resolve({
      cart: { cartId: 'cart-abc', version: 1 },
      items: items || [],
      cartToken: 'tok-xyz',
    }),
  });
}

function failFetch(errorMsg, code) {
  return () => Promise.resolve({
    ok: false, status: 422,
    json: () => Promise.resolve({ error: errorMsg || 'Item unavailable', code: code || 'PRODUCT_UNAVAILABLE' }),
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('church-t-shirt.html — runtime cross-script cart scope', () => {

  // ── 1. window.updateCartBadge is exposed after standard-product-cart.js executes ──

  test('1. window.updateCartBadge is exposed on the global scope by standard-product-cart.js', () => {
    const scope = buildScope();
    expect(typeof scope.window.updateCartBadge).toBe('function');
    // Must be the same reference — not a copy — so window.updateCartBadge() resolves
    expect(scope.updateCartBadge).toBe(scope.window.updateCartBadge);
  });

  // ── 2. Successful DivineCart.addConfiguredJob resolves ────────────────────

  test('2. DivineCart.addConfiguredJob resolves with a valid cart state', async () => {
    const mockItems = [{ totalQuantity: 25 }];
    const scope = buildScope({ fetchImpl: successFetch(mockItems) });

    const result = await scope.DivineCart.addConfiguredJob(mockJob());

    expect(result).toBeDefined();
    expect(result.cart).toBeDefined();
    expect(result.cart.cartId).toBe('cart-abc');
    expect(result.items).toHaveLength(1);
  });

  // ── 3. Actual addToCart() success path calls window.updateCartBadge ───────

  test('3. Actual addToCart() success path calls window.updateCartBadge', async () => {
    let badgeCalled = false;
    const scope = buildScope({
      fetchImpl:      successFetch([{ totalQuantity: 25 }]),
      buildJobStub:   () => mockJob(),
      loadPageScript: true,
    });

    // Spy: replace window.updateCartBadge AFTER scripts load, but ensure
    // addToCart (which runs after) sees the spy via the window reference.
    const original = scope.updateCartBadge;
    scope.updateCartBadge = function () { badgeCalled = true; original.call(this); };
    scope.window.updateCartBadge = scope.updateCartBadge;

    // Execute the ACTUAL addToCart function from the page
    await scope.addToCart();

    expect(badgeCalled).toBe(true);
  });

  // ── 4. Actual addToCart() success path sets window.location.href="/cart.html"
  //       without ReferenceError ──────────────────────────────────────────────

  test('4. Actual addToCart() success path reaches window.location.href="/cart.html" without ReferenceError', async () => {
    const scope = buildScope({
      fetchImpl:      successFetch([{ totalQuantity: 25 }]),
      buildJobStub:   () => mockJob(),
      loadPageScript: true,
    });

    let threw = false;
    let thrownError = null;
    try {
      await scope.addToCart();
    } catch (e) {
      threw = true;
      thrownError = e;
    }

    expect(threw).toBe(false);
    // ReferenceError: global is not defined would have been caught and rethrown
    if (thrownError) throw thrownError;
    // Must redirect to cart.html via window.location.href
    expect(scope.window.location.href).toBe('/cart.html');
    // Error message element must be empty (success path)
    expect(scope._cartMessage.textContent).toBe('');
  });

  // ── 5. Failed add does NOT redirect ───────────────────────────────────────

  test('5. Failed addConfiguredJob does NOT redirect to /cart.html', async () => {
    const scope = buildScope({
      fetchImpl:      failFetch('Product not available', 'PRODUCT_UNAVAILABLE'),
      buildJobStub:   () => mockJob(),
      loadPageScript: true,
    });

    await scope.addToCart();

    expect(scope.window.location.href).not.toBe('/cart.html');
    expect(scope.window.location.href).toBe('');  // unchanged from initial value
  });

  // ── 6. Failed add displays the error message ──────────────────────────────

  test('6. Failed addConfiguredJob displays server error message', async () => {
    const scope = buildScope({
      fetchImpl:      failFetch('Product not available', 'PRODUCT_UNAVAILABLE'),
      buildJobStub:   () => mockJob(),
      loadPageScript: true,
    });

    await scope.addToCart();

    // cartMessage element must carry the error text
    expect(scope._cartMessage.textContent).toMatch(/Product not available|could not be added/);
  });

  // ── 7. Cart badge initialization loads current cart on DOMContentLoaded ───

  test('7. Cart badge initialises from DivineCart.loadCurrentCart on DOMContentLoaded', async () => {
    const sessionCart = { cartId: 'cart-xyz', cartToken: 'tok-xyz' };
    const mockItems   = [{ totalQuantity: 10 }, { totalQuantity: 15 }];

    const scope = buildScope({
      sessionCart,
      fetchImpl: successFetch(mockItems),
    });

    // standard-product-cart.js registers a DOMContentLoaded handler that calls
    // updateCartBadge() → DivineCart.loadCurrentCart(false) → badge update.
    scope._fireDOMContentLoaded();
    await new Promise((r) => setTimeout(r, 60));

    // 10 + 15 = 25
    expect(Number(scope._cartBadge.textContent)).toBe(25);
    expect(scope._cartBadge.style.display).toBe('flex');
  });

  // ── 8. Configured-job totalQuantity contributes to badge count ────────────

  test('8. Configured-job totalQuantity (not just quantity) contributes to badge count', async () => {
    const sessionCart = { cartId: 'cart-q', cartToken: 'tok-q' };
    // One configured-job item (has totalQuantity) + one simple item (only quantity)
    const mockItems = [
      { totalQuantity: 30 },   // configured-job with multi-size allocations
      { quantity: 5 },         // simple item, no totalQuantity
    ];

    const scope = buildScope({
      sessionCart,
      fetchImpl: successFetch(mockItems),
    });

    scope._fireDOMContentLoaded();
    await new Promise((r) => setTimeout(r, 60));

    // 30 (totalQuantity) + 5 (quantity fallback) = 35
    expect(Number(scope._cartBadge.textContent)).toBe(35);
  });

  // ── Defensive: updateCartBadge is safe when badge element is absent ───────

  test('updateCartBadge does not throw when #cart-count element is absent', () => {
    const scope = buildScope();
    scope.document.getElementById = () => null;
    expect(() => scope.updateCartBadge()).not.toThrow();
  });

  // ── Defensive: updateCartBadge is safe when DivineCart is absent ──────────

  test('updateCartBadge does not throw when DivineCart is not yet defined', () => {
    const scope = buildScope();
    delete scope.DivineCart;
    expect(() => scope.updateCartBadge()).not.toThrow();
  });
});
