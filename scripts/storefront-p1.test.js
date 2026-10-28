'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),products=require('./vestment-products.json'),config=require('../js/quote-config.js'),header=require('./storefront-header'),catalog=require('./storefront-catalog');
test('all public common headers share exact markup and retain account/cart/mobile hooks without Blog navigation',()=>{
 const html=header.renderHeader();for(const file of require('./storefront-header-paths.json')){const page=fs.readFileSync(path.join(root,file),'utf8');assert.equal(page.match(/<header\b[^>]*>[\s\S]*?<\/header>/)[0],html,file)}
 assert.doesNotMatch(html,/>Blog</);assert.match(html,/href="\/account\/account.html"/);assert.match(html,/href="\/cart.html"/);assert.match(html,/class="cart-count" id="cart-count"/);assert.match(html,/aria-controls="mobile-menu" aria-expanded="false"/);assert.doesNotMatch(html,/onclick=/);
});
test('workflow adapter keeps each existing product exactly once and distinguishes actual active workflow',()=>{
 const entries=catalog.catalog(root,products);assert.equal(entries.length,37);assert.equal(new Set(entries.map(e=>e.slug)).size,37);assert.equal(entries.filter(e=>e.mode==='checkout').length,22);assert.equal(entries.filter(e=>e.mode==='quote').length,15);
 assert.equal(entries.find(e=>e.slug==='church-t-shirt').mode,'checkout');assert.equal(entries.find(e=>e.slug==='stage-backdrop-banner').mode,'quote');
 const home=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.match(home,/id="order-instantly"/);assert.match(home,/id="custom-quote-products"/);assert.doesNotMatch(home,/<p><a href="custom-quote-products.html">Browse Custom Quote Products/);
 const listing=fs.readFileSync(path.join(root,'custom-quote-products.html'),'utf8');assert.equal(catalog.extractCards(listing).length,15);assert.doesNotMatch(listing,/products\/church-t-shirt.html/);
});
test('public configuration matches reference endpoint and CAPTCHA, and descriptions/badges are structured and sourced',()=>{
 const stage=fs.readFileSync(path.join(root,'products/stage-backdrop-banner.html'),'utf8');assert.ok(stage.includes(config.endpoint));assert.ok(stage.includes(config.sitekey));assert.equal(config.thankYouUrl,'/thank-you.html');assert.ok(config.timeoutMs>=1000);
 for(const product of products){assert.equal(product.featureLabels.length,3);assert.equal(product.overview.length,2);assert.ok(product.ordering.length);assert.ok(product.overview.join(' ').length>250);assert.ok([3,4,5,10,11].includes(product.source.page));const page=fs.readFileSync(path.join(root,`products/${product.slug}.html`),'utf8');assert.ok(page.includes(`action="${config.endpoint}"`));assert.ok(page.includes(`data-sitekey="${config.sitekey}"`));assert.match(page,/data-expired-callback="divineQuoteCaptchaExpired"/);assert.match(page,/js\/quote-config.js/)}
 const vine=products.find(p=>p.slug==='gold-woven-grape-and-vine-vestment-trim');assert.match(vine.overview.join(' '),/woven grape and vine motif/i);
});
