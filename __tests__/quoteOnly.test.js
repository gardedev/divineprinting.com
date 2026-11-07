'use strict';
const fs = require('node:fs'), path = require('node:path');
const { buildStatic } = require('../scripts/build-static');
const { projectHtml, products, deniedAssets } = require('../scripts/quote-only');
const { storefrontMode, assertBuildMode } = require('../scripts/storefront-policy');
const root = path.resolve(__dirname, '..');
let files;
beforeAll(() => { files = buildStatic(root, { mode: 'quote_only' }); });
test('quote-only is fail closed and commerce is a trusted explicit deployment choice', () => {
  expect(storefrontMode({})).toBe('quote_only'); expect(storefrontMode({ PUBLIC_STOREFRONT_MODE: 'bad' })).toBe('quote_only'); expect(storefrontMode({ PUBLIC_STOREFRONT_MODE: 'commerce' })).toBe('commerce'); expect(() => assertBuildMode({ PUBLIC_STOREFRONT_MODE: 'bad' })).toThrow();
});
test('all43 product outputs contain quote workflows and exclude executable purchase paths', () => {
  expect(Object.keys(products)).toHaveLength(43);
  expect(Object.values(products).filter(p => p.newForm)).toHaveLength(6);
  for (const slug of Object.keys(products)) {
    const html = fs.readFileSync(path.join(root, 'dist/products', slug + '.html'), 'utf8');
    expect(html.match(/<form\b[^>]*id="quoteForm"/g)).toHaveLength(1);
    expect(html).toContain('action="https://formspree.io/f/xqeydkya"'); expect(html).toContain('name="product_id"');
    expect(html).toContain('Get Quote'); expect(html).toContain('/js/product-quote.js'); expect(html).not.toMatch(/onsubmit="submitQuote|onclick="addToCart|src="[^\"]*(?:cart-api|cart-page|standard-product-cart|snipcart)\.js/);
  }
});
test('each product has one primary quote action and distinct navigation keeps its label', () => {
  for (const slug of Object.keys(products)) {
    const html = fs.readFileSync(path.join(root, 'dist/products', slug + '.html'), 'utf8');
    const actions = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    const primary = actions.filter(([, attributes]) => /\bhref="#quote"/.test(attributes) && attributes.match(/\bclass="([^"]*)"/)?.[1].split(/\s+/).includes('btn-quote'));
    expect(primary).toHaveLength(1);
    expect(primary[0][2]).toBe('Get Quote');
    for (const [, attributes, label] of actions.filter(([, attributes]) => /\bclass="btn-quote-outline"/.test(attributes))) {
      expect(attributes).not.toContain('href="#quote"');
      const source = fs.readFileSync(path.join(root, 'products', slug + '.html'), 'utf8');
      expect(source).toContain('<a' + attributes + '>' + label + '</a>');
      expect(label).not.toBe('Get Quote');
    }
  }
  const shirt = fs.readFileSync(path.join(root, 'dist/products/church-t-shirt.html'), 'utf8');
  expect(shirt).toMatch(/<a href="#designer" class="btn-quote">[\s\S]*?Design Your Shirt<\/a>/);
  expect(shirt.indexOf('<a href="#quote" class="btn-quote">Get Quote</a>')).toBeGreaterThan(shirt.indexOf('id="customerInstructions"'));
  expect(shirt).not.toContain('id="quickAddToCartBtn"');
});
test('all product outputs omit the legacy back button while keeping distinct navigation', () => {
  let removed = 0;
  for (const slug of Object.keys(products)) {
    const source = fs.readFileSync(path.join(root, 'products', slug + '.html'), 'utf8');
    const html = fs.readFileSync(path.join(root, 'dist/products', slug + '.html'), 'utf8');
    expect(html).not.toContain('Back to All Products');
    if (source.includes('Back to All Products')) {
      removed++;
      const actions = html.match(/<div class="pi-actions">([\s\S]*?)<\/div>/)?.[1];
      expect(actions?.match(/<a\b[^>]*class="btn-quote"/g)).toHaveLength(1);
      expect(actions).toContain('href="#quote"');
      expect(actions).not.toMatch(/<a\b[^>]*>\s*<\/a>|<div/);
    }
    if (source.includes('Custom Quote Products</a>')) expect(html).toContain('Custom Quote Products</a>');
  }
  expect(removed).toBe(19);
});
test('back button removal is limited to the exact product navigation control', () => {
  const unwanted = '<a href="../index.html#products" class="extra btn-quote-outline">&larr; Back to All Products</a>';
  const kept = [
    '<a href="../index.html#products" class="breadcrumb">Back to All Products</a>',
    '<a href="../other.html" class="btn-quote-outline">Back to All Products</a>',
    '<a href="../index.html#products" class="btn-quote-outline-other">Back to All Products</a>',
    '<a href="../index.html#products" class="btn-quote-outline">Custom Quote Products</a>',
    '<a href="#designer" class="btn-quote">Design Your Shirt</a>'
  ];
  const document = '<html><head></head><body>' + unwanted + kept.join('') + '</body></html>';
  const product = projectHtml('products/church-vinyl-banner.html', document);
  expect(product).not.toContain(unwanted);
  for (const anchor of kept) expect(product).toContain(anchor);
  expect(projectHtml('about.html', document)).toContain(unwanted);
  for (const arrow of ['', '← ', '<span>&larr;</span> ']) {
    const anchor = '<a href="../index.html#products" class="btn-quote-outline">' + arrow + 'Back to All Products</a>';
    expect(projectHtml('products/church-vinyl-banner.html', '<html><head></head><body>' + anchor + '</body></html>')).not.toContain(anchor);
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
test('homepage has one43-card collection and source cart/configurator are preserved', () => {
  const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
  expect(html.match(/class="product-card\b/g)).toHaveLength(43); expect(require('../scripts/storefront-catalog').extractCards(fs.readFileSync(path.join(root, 'dist/custom-quote-products.html'), 'utf8'))).toHaveLength(43); expect(html.match(/data-product-collection/g)).toHaveLength(1); expect(html).not.toContain('Order Instantly');
  expect(require('node:crypto').createHash('sha256').update(fs.readFileSync(path.join(root, 'cart.js'))).digest('hex')).toBe('b36ecc69a737585457e91c317511cf59321d1b2eadee65e89bbf41c50a2bcc1d');
  expect(fs.readFileSync(path.join(root, 'products/tshirt-configurator.js'), 'utf8')).toContain('buildConfiguredJobRequest');
});

test('public CLI cannot accidentally publish a commerce preview', () => {
  expect(() => require('node:child_process').execFileSync(process.execPath, [path.join(root, 'scripts/build-static.js')], { env: { ...process.env, PUBLIC_STOREFRONT_MODE: 'commerce' }, stdio: 'pipe' })).toThrow();
});

test('retired standard flyer preserves source but publishes a noindex notice without a quote workflow', () => {
  const source = fs.readFileSync(path.join(root, 'products/church-flyers-standard.html'), 'utf8');
  const html = fs.readFileSync(path.join(root, 'dist/products/church-flyers-standard.html'), 'utf8');
  expect(source).toContain('Church Flyers');
  expect(products).not.toHaveProperty('church-flyers-standard');
  expect(html).toContain('name="robots" content="noindex,follow"');
  expect(html).toContain('This product is no longer listed');
  expect(html).toContain('href="/index.html#print"');
  expect(html).not.toMatch(/id="quoteForm"|id="quoteProduct"|#quote|Add to Cart|data-standard-product/);
  for (const file of ['index.html', 'custom-quote-products.html', 'sitemap.xml']) expect(fs.readFileSync(path.join(root, 'dist', file), 'utf8')).not.toContain('church-flyers-standard');
  expect(products).toHaveProperty('church-flyer-bulletin');
});
