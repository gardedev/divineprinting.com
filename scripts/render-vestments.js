'use strict';
// Scoped renderer: existing product pages and checkout are never regenerated.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const products = require('./vestment-products.json');
const quoteConfig = require('../js/quote-config.js');
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stage = fs.readFileSync(path.join(root, 'products/stage-backdrop-banner.html'), 'utf8');
const { renderHeader, updateHeaders } = require('./storefront-header');
const header = renderHeader();
const catalogTools = require('./storefront-catalog');
const footer = stage.slice(stage.indexOf('<footer>'), stage.indexOf('<script>\nasync function submitQuote')).replace('<h4>Products</h4>', '<h4>Products</h4><a href="../custom-quote-products.html">Custom Quote Products</a><a href="../index.html#apparel">Apparel and Vestments</a>');
const field = (name,label,type='text',required=false) => `<div class="form-group"><label for="q-${esc(name)}">${esc(label)}${required?' *':''}</label><input id="q-${esc(name)}" name="${esc(name)}" type="${type}" ${required?'required':''}/></div>`;
function shell(title,description,body,prefix='../',captcha=false){return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${esc(title)} — Divine Printing</title><meta name="description" content="${esc(description)}"/><link rel="icon" href="${prefix}favicon.ico"/><link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"/><link rel="stylesheet" href="${prefix}styles.css?v=3"/><link rel="stylesheet" href="${prefix}product.css"/><link rel="stylesheet" href="${prefix}vestments.css"/>${captcha?'<script src="https://js.hcaptcha.com/1/api.js" async defer onerror="window.divineQuoteCaptchaLoadFailed=true;window.divineQuoteCaptchaError?.()"></script>':''}</head><body${captcha?' class="vestment-product"':''}>${prefix?header:header.replaceAll('../','')}${body}${prefix?footer:footer.replaceAll('../','')}<script src="${prefix}js/quote-config.js" defer></script><script src="${prefix}js/vestment-quote.js" defer></script></body></html>\n`;}
// Checkout capability is supplied explicitly by a caller using an existing local
// storefront route. The renderer creates no cart item, price or checkout backend.
const approvedQuoteIds = new Set(products.map(product => product.id));
function purchaseCapabilities(product) {
  const mode = product.purchaseMode;
  if (!['checkout', 'quote', 'both'].includes(mode)) throw new Error('Invalid purchase mode');
  if (approvedQuoteIds.has(product.id) && mode !== 'quote') throw new Error('Approved vestments must remain quote-only');
  const capabilities = { quote: mode !== 'checkout', checkout: mode !== 'quote', checkoutUrl: null };
  if (capabilities.checkout) {
    if (typeof product.checkoutUrl !== 'string' || !product.checkoutUrl.startsWith('/') || product.checkoutUrl.startsWith('//')) throw new Error('Checkout requires an existing local checkout destination');
    const destination = new URL(product.checkoutUrl, 'https://www.divineprinting.com');
    if (destination.origin !== 'https://www.divineprinting.com' || !/^\/(?:products\/[^/]+|checkout\/[^/]+|cart)\.html$/.test(destination.pathname) || !fs.existsSync(path.join(root, destination.pathname))) throw new Error('Checkout destination must be an existing storefront route');
    capabilities.checkoutUrl = destination.pathname + destination.search + destination.hash;
  }
  return capabilities;
}
function purchaseActions(product) {
  const mode = purchaseCapabilities(product);
  return (mode.checkout ? `<a href="${esc(mode.checkoutUrl)}" class="btn-order">Configure and Order</a>` : '') +
    (mode.quote ? '<a href="#quote" class="btn-quote">✝ Request a Free Quote</a>' : '');
}
function card(p,prefix=''){const mode=purchaseCapabilities(p);return `<div class="product-card${approvedQuoteIds.has(p.id)?' vestment-card':''}" data-cat="${esc(p.category||'quote')}"><div class="product-img"><a href="${prefix}products/${esc(p.slug)}.html"><img loading="lazy" src="${prefix}${esc(p.image)}" alt="${esc(p.alt||p.name)}"/></a></div><div class="product-body"><h3>${esc(p.name)}</h3><p>${esc(p.description||'Tell us about your project and request a custom quote.')}</p>${p.featureLabels?`<div class="product-meta">${p.featureLabels.map(label=>`<span class="meta-tag">${esc(label)}</span>`).join('')}</div>`:''}<a class="btn-order" href="${mode.checkout?esc(mode.checkoutUrl):`${prefix}products/${esc(p.slug)}.html${approvedQuoteIds.has(p.id)?'#quote':''}`}">${mode.checkout?'Configure and Order':'Request a Quote'}</a>${mode.checkout&&mode.quote?`<a class="btn-quote-outline" href="${prefix}products/${esc(p.slug)}.html#quote">Request a Quote</a>`:''}</div></div>`;}
function renderProduct(p) {
 const mode = purchaseCapabilities(p);
 const specs=Object.entries({...p.specifications,Colors:p.colors.join(', ')}).map(([k,v])=>`<div class="spec-row"><span class="spec-label">${esc(k)}</span><span class="spec-value">${esc(v)}</span></div>`).join('');
 const form=mode.quote?`<section class="quote-section" id="quote"><div class="quote-inner"><div class="quote-header"><h2 id="quoteHeading" tabindex="-1">Request a Free Quote</h2><p>Tell us what your church needs. We will review your measurements, design requirements and requested date with your quote.</p><div class="divider"></div></div><div class="quote-form" id="quoteFormWrap"><form id="quoteForm" action="${quoteConfig.endpoint}" method="POST"><input type="hidden" name="product" value="${esc(p.name)}"/><input type="hidden" name="product_id" value="${esc(p.id)}"/><input type="hidden" name="product_page_url" value="https://www.divineprinting.com/products/${esc(p.slug)}.html"/><div class="form-row">${field('name','Full Name','text',true)}${field('email','Email Address','email',true)}</div><div class="form-row">${field('phone','Phone Number','tel')}${field('church','Church / Organization')}</div><div class="form-row">${field('quantity','Quantity Needed')}${field('delivery_date','Requested delivery date','date')}</div><div class="form-group"><label for="q-color">Preferred color / finish</label><select id="q-color" name="color"><option value="">Select a color...</option>${p.colors.map(c=>`<option>${esc(c)}</option>`).join('')}</select></div>${p.quoteFields.map(f=>field(f.name,f.label)).join('')}<div class="form-group"><label for="q-message">Additional instructions / design requirements</label><textarea id="q-message" name="message"></textarea></div><p>Measurements, designs and delivery requests are subject to confirmation with your quote.</p><div class="form-check"><input type="checkbox" id="fconsent" name="consent" value="agreed" required/><label for="fconsent">I agree to be contacted by Divine Printing regarding this quote request. We respect your privacy and will never share your information.</label></div><div class="h-captcha" data-sitekey="${quoteConfig.sitekey}" data-callback="divineQuoteCaptchaReady" data-expired-callback="divineQuoteCaptchaExpired" data-error-callback="divineQuoteCaptchaError"></div><p id="quoteStatus" role="status" aria-live="polite"></p><button type="submit" class="btn-submit" id="submitBtn">✝ Send My Quote Request</button></form></div></div></section>`:'';
 const body=`<main><div class="breadcrumb"><a href="../index.html">Home</a> › <a href="../index.html#apparel">Apparel and Vestments</a> › ${esc(p.name)}</div><div class="product-hero"><div class="product-gallery"><div class="product-main-img"><img src="../${esc(p.image)}" alt="${esc(p.alt)}" width="900" height="490"/></div></div><div class="product-info"><div class="pi-category">✝ Apparel and Vestments</div><h1>${esc(p.name)}</h1><p class="pi-tagline">${esc(p.description)}</p><div class="pi-specs"><h4>Product Specifications</h4>${specs}</div><div class="pi-actions">${purchaseActions(p)}<a href="../custom-quote-products.html" class="btn-quote-outline">Custom Quote Products</a></div></div></div><div class="product-desc"><div><h2>About This Product</h2>${(p.overview||[p.description]).map(paragraph=>`<p>${esc(paragraph)}</p>`).join('')}${p.ordering?`<h3>Planning Your Quote</h3>${p.ordering.map(paragraph=>`<p>${esc(paragraph)}</p>`).join('')}`:''}<p>${mode.quote?'Share your required quantity, measurements and design details below. Pricing and order details will be confirmed with your quote.':'Continue to the existing ordering page to configure your product and review order details.'}</p></div><div class="pi-features"><h4>Features and ordering details</h4><ul>${Object.entries(p.specifications).map(([k,v])=>`<li>${esc(k)}: ${esc(v)}</li>`).join('')}</ul></div></div>${form}</main>`;
 const html = shell(p.name,p.description,body,'../',mode.quote).replace('</head>', `<link rel="canonical" href="https://www.divineprinting.com/products/${esc(p.slug)}.html"/></head>`);
 return mode.quote ? html : html.replaceAll('href="#quote"', 'href="../custom-quote-products.html"');
}
function generateApprovedProducts() {
// Only these configured vestments are generated; no existing checkout page is migrated.
for (const product of products) {
  if (product.purchaseMode !== 'quote') throw new Error('Approved vestments must remain quote-only');
  fs.writeFileSync(path.join(root, `products/${product.slug}.html`), renderProduct(product));
}
// Adapt the existing homepage catalog/card identities to actual purchasing workflows.
const entries=catalogTools.catalog(root,products).map(entry=>{
 const product=products.find(p=>p.slug===entry.slug);
 if(product)return {...entry,html:card(product)};
 if(entry.mode==='quote')return {...entry,html:entry.html.replace(/<a\b[^>]*class="btn-order"[^>]*>[\s\S]*?<\/a>/, `<a class="btn-order" href="products/${entry.slug}.html#quote">Request a Quote</a>`)};
 return entry;
});
let index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const start=index.indexOf('<section id="products">'),end=index.indexOf('<!-- TESTIMONIALS -->');
if(start<0||end<start)throw Error('Homepage product region missing');
index=index.slice(0,start)+catalogTools.renderHomeCollections(entries)+'\n'+index.slice(end);
index=index.replace(/  \/\/ Category tabs[\s\S]*?(?=<\/script>)/,'');
fs.writeFileSync(path.join(root,'index.html'),index);
const quotes=entries.filter(entry=>entry.mode==='quote');
const quoteBody=`<main class="section-inner"><div class="section-header"><h1>Custom Quote Products</h1><p>Tell us about your church printing or vestment project.</p><a class="collection-link" href="/index.html#order-instantly">Browse Order Instantly</a></div><div class="product-grid">${quotes.map(entry=>entry.html).join('')}</div></main>`;
fs.writeFileSync(path.join(root,'custom-quote-products.html'),shell('Custom Quote Products','Church products requiring a custom quote.',quoteBody,'',false));
updateHeaders(root);
console.log(`Rendered ${products.length} approved quote products and listing with ${quotes.length} existing quote products`);


let sitemap=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
for(const route of ['custom-quote-products.html',...products.map(p=>`products/${p.slug}.html`)]){const url=`https://www.divineprinting.com/${route}`;if(!sitemap.includes(url))sitemap=sitemap.replace('</urlset>',`  <url><loc>${url}</loc></url>\n</urlset>`);}
fs.writeFileSync(path.join(root,'sitemap.xml'),sitemap);

}
if (require.main === module) generateApprovedProducts();
module.exports = { products, purchaseCapabilities, purchaseActions, card, renderProduct, generateApprovedProducts };
