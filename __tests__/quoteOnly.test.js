'use strict';
const fs = require('node:fs'), path = require('node:path');
const { buildStatic } = require('../scripts/build-static');
const { products, deniedAssets } = require('../scripts/quote-only');
const { storefrontMode, assertBuildMode } = require('../scripts/storefront-policy');
const root = path.resolve(__dirname, '..');
let files;
beforeAll(() => { files = buildStatic(root, { mode: 'quote_only' }); });
test('quote-only is fail closed and commerce is a trusted explicit deployment choice', () => {
  expect(storefrontMode({})).toBe('quote_only'); expect(storefrontMode({ PUBLIC_STOREFRONT_MODE: 'bad' })).toBe('quote_only'); expect(storefrontMode({ PUBLIC_STOREFRONT_MODE: 'commerce' })).toBe('commerce'); expect(() => assertBuildMode({ PUBLIC_STOREFRONT_MODE: 'bad' })).toThrow();
});
test('all37 product outputs contain quote workflows and exclude executable purchase paths', () => {
  expect(Object.keys(products)).toHaveLength(37);
  expect(Object.values(products).filter(p => p.newForm)).toHaveLength(7);
  for (const slug of Object.keys(products)) {
    const html = fs.readFileSync(path.join(root, 'dist/products', slug + '.html'), 'utf8');
    expect(html.match(/<form\b[^>]*id="quoteForm"/g)).toHaveLength(1);
    expect(html).toContain('action="https://formspree.io/f/xqeydkya"'); expect(html).toContain('name="product_id"');
    expect(html).toContain('Get Quote'); expect(html).toContain('/js/product-quote.js'); expect(html).not.toMatch(/onsubmit="submitQuote|onclick="addToCart|src="[^\"]*(?:cart-api|cart-page|standard-product-cart|snipcart)\.js/);
  }
});
test('public artifact excludes cart execution assets and direct checkout routes are safe', () => {
  for (const name of deniedAssets) expect(files).not.toContain(name);
  for (const name of ['cart.html','checkout/success.html','checkout/cancel.html']) {
    const html = fs.readFileSync(path.join(root, 'dist', name), 'utf8'); expect(html).toContain('Online checkout is temporarily unavailable'); expect(html).not.toMatch(/DivineCart|snipcart|checkout-btn/);
  }
});
test('every rendered public page excludes cart navigation and preserves GTM admin boundary', () => {
  for (const name of files.filter(p=>p.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root, 'dist', name), 'utf8');
    expect(html).not.toMatch(/href="[^\"]*cart\.html|src="[^\"]*cdn\.snipcart/);
    expect(html.match(/GTM-MZXJHMD5/g) || []).toHaveLength(name.startsWith('admin/') ? 0 : 2);
  }
});
test('homepage has one37-card collection and source cart/configurator are preserved', () => {
  const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  expect(html.match(/class="product-card\b/g)).toHaveLength(37); expect(require('../scripts/storefront-catalog').extractCards(fs.readFileSync(path.join(root, 'dist/custom-quote-products.html'), 'utf8'))).toHaveLength(37); expect(html.match(/data-product-collection/g)).toHaveLength(1); expect(html).not.toContain('Order Instantly');
  expect(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root, 'cart.js'))).digest('hex')).toBe('b36ecc69a737585457e91c317511cf59321d1b2eadee65e89bbf41c50a2bcc1d');
  expect(fs.readFileSync(path.join(root, 'products/tshirt-configurator.js'), 'utf8')).toContain('buildConfiguredJobRequest');
});

test('public CLI cannot accidentally publish a commerce preview', () => {
  expect(() => require('node:child_process').execFileSync(process.execPath, [path.join(root, 'scripts/build-static.js')], { env: { ...process.env, PUBLIC_STOREFRONT_MODE: 'commerce' }, stdio: 'pipe' })).toThrow();
});
