'use strict';

/**
 * Regression tests for church-t-shirt.html cart behaviour and header badge.
 *
 * Root causes addressed:
 *   1. standard-product-cart.js was NOT loaded → updateCartBadge() never called,
 *      badge stayed at 0, no redirect to /cart.html after add.
 *   2. Cart badge element had class "snipcart-items-count" instead of
 *      id="cart-count" — the element updateCartBadge() targets.
 *   3. addToCart() in the page inline script showed a success message but
 *      did not call updateCartBadge() or redirect.
 */

const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// ---------------------------------------------------------------------------
// 1.  Static HTML / script-load contract
// ---------------------------------------------------------------------------
describe('church-t-shirt.html — static page contract', () => {
  let html;
  beforeAll(() => { html = read('products/church-t-shirt.html'); });

  test('loads cart-api.js before standard-product-cart.js', () => {
    const cartApiPos = html.indexOf('/js/cart-api.js');
    const stdCartPos = html.indexOf('/js/standard-product-cart.js');
    expect(cartApiPos).toBeGreaterThan(-1);
    expect(stdCartPos).toBeGreaterThan(-1);
    // standard-product-cart must appear AFTER cart-api
    expect(stdCartPos).toBeGreaterThan(cartApiPos);
  });

  test('cart badge uses id="cart-count" so updateCartBadge() can find it', () => {
    // updateCartBadge() targets document.getElementById('cart-count')
    expect(html).toContain('id="cart-count"');
  });

  test('cart badge does NOT use the legacy snipcart-items-count selector', () => {
    expect(html).not.toContain('snipcart-items-count');
  });

  test('cart icon link points to /cart.html', () => {
    expect(html).toContain('href="/cart.html" class="header-icon cart-icon"');
  });

  test('addToCart() calls updateCartBadge() after a successful add', () => {
    expect(html).toContain('updateCartBadge()');
  });

  test('addToCart() redirects to /cart.html after a successful add', () => {
    // Redirect must be inside the addToCart function — after the DivineCart call
    const addToCartFn = html.match(/async function addToCart\(\)[^]*?(?=\n\s*\/\/|\n\s*document\.)/);
    expect(addToCartFn).not.toBeNull();
    const body = addToCartFn[0];
    expect(body).toContain("location.href = '/cart.html'");
  });

  test('addToCart() does not display a success message before redirecting', () => {
    // After the fix the success path calls updateCartBadge + redirect, not a static message
    const addToCartFn = html.match(/async function addToCart\(\)[^]*?(?=\n\s*\/\/|\n\s*document\.)/);
    expect(addToCartFn).not.toBeNull();
    // The old false-success message must be gone from the success branch
    expect(addToCartFn[0]).not.toContain('Added with authoritative pricing');
  });

  test('page does not import any Snipcart runtime or use data-item-price attributes', () => {
    expect(html).not.toMatch(/cdn\.snipcart|data-item-price|Snipcart\.api|snipcart-checkout|snipcart-add-item/i);
  });

  test('server-authoritative pricing is preserved — no client-side price literals in addToCart', () => {
    // The inline addToCart() must not inject pricing into the job payload
    const addToCartFn = html.match(/async function addToCart\(\)[^]*?(?=\n\s*\/\/|\n\s*document\.)/);
    expect(addToCartFn).not.toBeNull();
    expect(addToCartFn[0]).not.toMatch(/price\s*:|unitPriceCents\s*:|lineTotalCents\s*:/);
  });
});

// ---------------------------------------------------------------------------
// 2.  standard-product-cart.js — updateCartBadge semantics
// ---------------------------------------------------------------------------
describe('standard-product-cart.js — updateCartBadge reads from loadCurrentCart', () => {
  let source;
  beforeAll(() => { source = read('js/standard-product-cart.js'); });

  test('updateCartBadge targets #cart-count, not a Snipcart selector', () => {
    expect(source).toContain("getElementById('cart-count')");
    expect(source).not.toContain('snipcart-items-count');
  });

  test('updateCartBadge reads cart via DivineCart.loadCurrentCart, not a client price', () => {
    expect(source).toContain('DivineCart.loadCurrentCart');
    expect(source).not.toMatch(/price(?:Cents)?\s*:/);
  });

  test('updateCartBadge counts totalQuantity from configured-job items', () => {
    // The sum must reference totalQuantity so configured-job multi-size allocations count
    expect(source).toContain('totalQuantity');
  });

  test('DOMContentLoaded wiring calls updateCartBadge so existing cart state shows on load', () => {
    // On DOMContentLoaded the badge should be refreshed, preventing badge=0 for returning visitors
    const domReady = source.match(/DOMContentLoaded[^]*?(?=\}\);)/);
    expect(domReady).not.toBeNull();
    expect(domReady[0]).toContain('updateCartBadge');
  });
});

// ---------------------------------------------------------------------------
// 3.  cart-api.js — anonymous / authenticated cart selection unchanged
// ---------------------------------------------------------------------------
describe('cart-api.js — cart-selection consistency preserved', () => {
  let source;
  beforeAll(() => { source = read('js/cart-api.js'); });

  test('loadCurrentCart uses authenticated route when getAccessToken returns a value', () => {
    expect(source).toContain('authenticatedMode()');
    expect(source).toContain('loadCustomerCart()');
    expect(source).toContain('loadAnonymousCart(createIfMissing)');
  });

  test('addConfiguredJob is a POST mutation that returns the authoritative cart', () => {
    expect(source).toContain("mutate('POST'");
    expect(source).toContain('items: body.items || []');
  });

  test('server-authoritative pricing fields are never written by the client', () => {
    // cart-api must not set client-side prices on outgoing payloads
    expect(source).not.toMatch(/unitPriceCents\s*:/);
    expect(source).not.toMatch(/lineTotalCents\s*:/);
    expect(source).not.toMatch(/pricingSnapshot\s*:/);
  });
});

// ---------------------------------------------------------------------------
// 4.  tshirt-configurator.js — buildConfiguredJobRequest preserves semantics
// ---------------------------------------------------------------------------
describe('tshirt-configurator.js — buildConfiguredJobRequest contract', () => {
  let source;
  beforeAll(() => { source = read('products/tshirt-configurator.js'); });

  test('variantAllocations uses data-size inputs, not a client price', () => {
    expect(source).toContain('variantAllocations: allocations');
    expect(source).not.toMatch(/price\s*:|unitPriceCents\s*:/);
  });

  test('designSource is always TEMPLATE — no FileReader or arbitrary blob upload', () => {
    expect(source).toContain("designSource: 'TEMPLATE'");
    expect(source).not.toMatch(/new FileReader|readAsDataURL/);
  });

  test('productId is the canonical t-shirt UUID', () => {
    expect(source).toContain("productId: 'd204cea4-ce22-4bc5-ad04-530f19fb3878'");
  });
});

// ---------------------------------------------------------------------------
// 5.  Size quantity inputs — UI / accessibility contract
// ---------------------------------------------------------------------------
describe('church-t-shirt.html — size quantity input UI', () => {
  let html;
  beforeAll(() => { html = read('products/church-t-shirt.html'); });

  test('has exactly 8 size inputs (S through 5XL)', () => {
    const matches = html.match(/data-size=/g);
    expect(matches).toHaveLength(8);
  });

  test('each size input is wrapped in a <label> for keyboard accessibility', () => {
    // Verify label wrapping present for all 8 sizes
    const sizes = ['S', 'M', 'L', 'XL', '2XL', '3XL', '4XL', '5XL'];
    for (const size of sizes) {
      expect(html).toMatch(new RegExp(`<label[^>]*>\\s*${size}\\s*<input`));
    }
  });

  test('#variantAllocations uses a CSS grid layout', () => {
    expect(html).toMatch(/id="variantAllocations"[^>]*display\s*:\s*grid/);
  });

  test('size quantity inputs have styled width so they do not render as raw browser defaults', () => {
    // The fix adds a CSS rule targeting #variantAllocations input[type="number"]
    expect(html).toMatch(/#variantAllocations\s+(?:label\s+)?input\[type="number"\]/);
  });

  test('mobile responsive layout does not overflow at 320px — max-width constraint present', () => {
    // Must have a media-query that constrains variantAllocations at narrow widths
    expect(html).toMatch(/@media[^{]*max-width[^{]*\{[^}]*#variantAllocations|#variantAllocations[^}]*@media/s);
  });
});
