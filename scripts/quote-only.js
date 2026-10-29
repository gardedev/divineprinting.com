'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { extractCards } = require('./storefront-catalog');
const products = require('./quote-products.json');
const quoteConfig = require('../js/quote-config');
const deniedAssets = new Set(['cart.js', 'snipcart-custom.js', 'snipcart-close-fix.js', 'js/cart-api.js', 'js/cart-page.js', 'js/standard-product-cart.js']);
function escape(value) { return String(value).replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character])); }
function replaceElement(html, start, tag, replacement) {
  const index = html.search(start); if (index < 0) throw new Error('Missing public projection boundary: ' + start);
  const opening = html.indexOf('>', index) + 1; const tags = new RegExp('</?' + tag + '\\b[^>]*>', 'gi'); tags.lastIndex = opening;
  let depth = 1, match;
  while (depth && (match = tags.exec(html))) depth += match[0].startsWith('</') ? -1 : 1;
  if (depth) throw new Error('Unbalanced projection boundary');
  return html.slice(0, index) + replacement + html.slice(tags.lastIndex);
}
function quoteCards(cards) { return cards.map(card => card.replace(/>\s*(?:More Info|Design Yours|Request a Quote|Order Now)\s*<\/a>/g, '>Get Quote</a>')); }
function unified(html) {
  const cards = extractCards(html); if (cards.length !== 37) throw new Error('Expected all 37 unique product cards');
  const slugs = cards.map(card => card.match(/href="\/?products\/([^"#]+)\.html/)[1]);
  if (new Set(slugs).size !== 37) throw new Error('Duplicate product card');
  const categories = [['all','All Products'],['banners','Banners &amp; Flags'],['events','Event Displays'],['signs','Signs'],['stickers','Stickers &amp; Magnets'],['print','Print &amp; Paper'],['apparel','Apparel and Vestments']];
  return `<section id="products"><div class="section-inner"><span id="order-instantly"></span><span id="custom-quote-products"></span>${['banners','events','signage','promo','print','apparel'].map(id=>`<span id="${id}" data-category-anchor></span>`).join('')}<section class="product-collection" data-product-collection><div class="section-header"><h2 tabindex="-1">Shop Church Printing, Apparel &amp; Accessories</h2><p>Explore our church printing, apparel and accessories. Select a product to request a personalized quote.</p><div class="divider"></div></div><div class="cat-tabs" aria-label="Product categories">${categories.map(([key,label])=>`<button type="button" class="cat-tab${key==='all'?' active':''}" data-filter="${key}" aria-pressed="${key==='all'}">${label}</button>`).join('')}</div><div class="product-grid">${quoteCards(cards).map(card=>card.replace(/\s+id="(?:banners|events|signage|promo|print|apparel)"/g,'')).join('\n')}</div><p class="collection-empty" hidden>No products match that category.</p></section></div></section>`;
}
function newForm(product, slug) {
  return `<section class="quote-section" id="quote"><div class="quote-inner"><div class="quote-header"><h2 id="quoteHeading" tabindex="-1">Request a Free Quote</h2><p>Your selections will be included. This is an inquiry, not an order or payment.</p></div><div class="quote-form" id="quoteFormWrap"><form id="quoteForm" action="${quoteConfig.endpoint}" method="POST"><input type="hidden" name="product" value="${escape(product.name)}"><input type="hidden" name="product_id" value="${slug}"><input type="hidden" name="product_page_url" value="https://www.divineprinting.com/products/${slug}.html"><div class="form-row"><div class="form-group"><label for="q-name">Full Name *</label><input id="q-name" name="name" required maxlength="100"></div><div class="form-group"><label for="q-email">Email Address *</label><input id="q-email" type="email" name="email" required maxlength="254"></div></div><div class="form-row"><div class="form-group"><label for="q-phone">Phone Number</label><input id="q-phone" name="phone" type="tel" maxlength="50"></div><div class="form-group"><label for="q-church">Church / Organization</label><input id="q-church" name="church" maxlength="100"></div></div><div class="form-group"><label for="q-message">Additional requirements</label><textarea id="q-message" name="message" maxlength="4000"></textarea></div><div class="form-check"><input id="fconsent" type="checkbox" name="consent" value="agreed" required><label for="fconsent">I agree to be contacted about this quote request.</label></div><div class="h-captcha" data-sitekey="${quoteConfig.sitekey}" data-callback="divineQuoteCaptchaReady" data-expired-callback="divineQuoteCaptchaExpired" data-error-callback="divineQuoteCaptchaError"></div><p id="quoteStatus" role="status" aria-live="polite"></p><button type="submit" id="submitBtn" class="btn-submit">Send My Quote Request</button></form></div></div></section>`;
}
function noCheckout(html) {
  let head = html.match(/<head\b[^>]*>[\s\S]*?<\/head>/i)?.[0] || '<head><title>Request a quote</title></head>';
  head = head.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '').replace(/<title>[\s\S]*?<\/title>/i, '<title>Request a Quote | Divine Printing</title>');
  return `<!doctype html><html lang="en">${head}<body><main style="max-width:48rem;margin:4rem auto;padding:1rem"><h1>Request a personalized quote</h1><p>Online checkout is temporarily unavailable. No order or payment is created here.</p><a href="/index.html#products">Browse products and get a quote</a><p><a href="/account/orders.html">View existing orders</a></p></main></body></html>`;
}
function projectHtml(relative, html, sourceDirectory = path.resolve(__dirname, '..')) {
  if (!/<head\b/i.test(html) || !/<body\b/i.test(html) || relative.startsWith('admin/')) return html;
  if (relative === 'cart.html' || relative.startsWith('checkout/')) html = noCheckout(html);
  // Remove executable purchase paths, not merely their visibility.
  html = html.replace(/<script\b[^>]*src="([^"]+)"[^>]*>[\s\S]*?<\/script>/gi, (tag, src) => /(?:^|\/)(?:cart|cart-api|cart-page|standard-product-cart|snipcart[^/]*)\.js(?:[?#]|$)|cdn\.snipcart\.com/i.test(src) ? '' : tag);
  html = html.replace(/<link\b[^>]*href="[^"]*cdn\.snipcart\.com[^"]*"[^>]*>/gi, '');
  html = html.replace(/<div\b[^>]*id="snipcart"[^>]*>[\s\S]*?<\/div>/gi, '');
  html = html.replace(/<a\b[^>]*href="[^"]*(?:cart\.html|#snipcart)[^"]*"[^>]*>[\s\S]*?<\/a>/gi, '');
  html = html.replace(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi, (tag, source) => /async function submitQuote\(|(?:window\.)?DivineCart\b|Snipcart|snipcart\.(?:ready|checkout)|function updateCartBadge|class\*="cart"/i.test(source) ? '' : tag);
  html = html.replace(/<button\b[^>]*(?:class="[^"]*add-to-cart-btn|data-add-standard-product|id="configuredAddButton")[^>]*>[\s\S]*?<\/button>/gi, '<a href="#quote" class="btn-quote">Get Quote</a>');
  html = html.replace(/<a\b([^>]*class="[^"]*btn-quote[^"]*"[^>]*)>[\s\S]*?<\/a>/g, '<a$1>Get Quote</a>');
  if (relative === 'index.html') html = replaceElement(html, /<section\b[^>]*id="products"/, 'section', unified(html));
  if (relative === 'custom-quote-products.html') {
    const cards = extractCards(fs.readFileSync(path.join(sourceDirectory, 'index.html'), 'utf8'));
    html = replaceElement(html, /<div\b[^>]*class="product-grid"/, 'div', '<div class="product-grid">' + quoteCards(cards).join('\n') + '</div>');
  }
  if (relative === 'custom-quote-products.html') html = html.replace(/<a\b[^>]*href="[^"#]*index\.html#order-instantly"[^>]*>[\s\S]*?<\/a>/g, '<a href="/index.html#products">Browse all products</a>');
  html = html.replace(/Order Now/g, 'Get Quote').replace(/Order Instantly/g, 'Get Quote').replace(/Quick Checkout/g, 'Get Quote').replace(/No quote needed\./g, 'Request a personalized quote.').replace(/Ready-to-order/g, 'Customizable').replace(/Total calculated at checkout\./g, 'Final pricing is confirmed with your quote.').replace(/fixed checkout/g, 'quote configuration');
  const slug = relative.match(/^products\/([^/]+)\.html$/)?.[1];
  if (slug) {
    const product = products[slug]; if (!product) throw new Error('Unknown product in quote-only mode: ' + slug);
    if (product.newForm) {
      html = html.replace('</body>', newForm(product, slug) + '</body>');
      if (!html.includes('id="quoteForm"')) throw new Error('Failed to create quote form');
    }
    html = html.replace(/(<div class="quote-header">\s*<h2)(?![^>]*id=)([^>]*>)/, '$1 id="quoteHeading" tabindex="-1"$2');
    html = html.replace(/\s+onsubmit="submitQuote\(event\)"/g, '');
    html = html.replace(/<input\b[^>]*id="fconsent"[^>]*>/, tag => /\bname=/.test(tag) ? tag : tag.replace(/\/?>(?=$)/, ' name="consent" value="agreed">'));
    if (!html.includes('name="product_id"')) html = html.replace(/(<form\b[^>]*id="quoteForm"[^>]*>)/, `$1<input type="hidden" name="product_id" value="${slug}"><input type="hidden" name="product_page_url" value="https://www.divineprinting.com/products/${slug}.html">`);
    if (!html.includes('id="quoteStatus"')) html = html.replace(/(<button\b[^>]*id="submitBtn"[^>]*>)/, '<p id="quoteStatus" role="status" aria-live="polite"></p>$1');
    html = html.replace(/<div\b([^>]*class="h-captcha"[^>]*)>/g, (tag, attrs) => attrs.includes('data-callback') ? tag : `<div${attrs} data-callback="divineQuoteCaptchaReady" data-expired-callback="divineQuoteCaptchaExpired" data-error-callback="divineQuoteCaptchaError">`);
    if (!html.includes('https://js.hcaptcha.com/1/api.js')) html = html.replace('</head>', '<script src="https://js.hcaptcha.com/1/api.js" async defer onerror="window.divineQuoteCaptchaLoadFailed=true;window.divineQuoteCaptchaError?.()"></script></head>');
    for (const script of ['quote-config.js', 'product-quote.js', 'vestment-quote.js']) {
      html = html.replace(new RegExp('<script\\b[^>]*src="[^\"]*js/' + script.replace('.', '\\.') + '"[^>]*>[\\s\\S]*?<\\/script>', 'g'), '');
    }
    const data = JSON.stringify({ slug, name: product.name, adapter: product.adapter, optionFields: product.optionFields }).replace(/</g, '\\u003c');
    html = html.replace('</body>', `<script type="application/json" id="quoteProduct">${data}</script><script src="/js/quote-config.js" defer></script><script src="/js/product-quote.js" defer></script><script src="/js/vestment-quote.js" defer></script></body>`);
  }
  return html;
}
module.exports = { projectHtml, deniedAssets, unified, products };
