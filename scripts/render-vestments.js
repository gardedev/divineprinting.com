'use strict';
// Scoped renderer: existing product pages and checkout are never regenerated.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const products = require('./vestment-products.json');
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stage = fs.readFileSync(path.join(root, 'products/stage-backdrop-banner.html'), 'utf8');
let header = stage.slice(stage.indexOf('<div class="topbar">'), stage.indexOf('<div class="breadcrumb">'));
header = header.replace('&#9889; Same-day production available','Church vestments by custom quote');
header = header.replace(/<button class="header-icon cart-icon[\s\S]*?<\/button>/, '<a href="../cart.html" class="header-icon" aria-label="Shopping Cart">Cart</a>').replace(/<button class="snipcart-checkout"[\s\S]*?<\/button>/, '<a href="../cart.html">My Cart</a>');
header = header.replaceAll('<a href="../blog/index.html">Blog</a>', '<a href="../index.html#apparel">Apparel and Vestments</a><a href="../blog/index.html">Blog</a>');
const footer = stage.slice(stage.indexOf('<footer>'), stage.indexOf('<script>\nasync function submitQuote')).replace('<h4>Products</h4>', '<h4>Products</h4><a href="../custom-quote-products.html">Custom Quote Products</a><a href="../index.html#apparel">Apparel and Vestments</a>');
const field = (name,label,type='text',required=false) => `<div class="form-group"><label for="q-${esc(name)}">${esc(label)}${required?' *':''}</label><input id="q-${esc(name)}" name="${esc(name)}" type="${type}" ${required?'required':''}/></div>`;
function shell(title,description,body,prefix='../',captcha=false){return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${esc(title)} — Divine Printing</title><meta name="description" content="${esc(description)}"/><link rel="icon" href="${prefix}favicon.ico"/><link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"/><link rel="stylesheet" href="${prefix}styles.css?v=3"/><link rel="stylesheet" href="${prefix}product.css"/><link rel="stylesheet" href="${prefix}vestments.css"/>${captcha?'<script src="https://js.hcaptcha.com/1/api.js" async defer></script>':''}</head><body>${prefix?header:header.replaceAll('../','')}${body}${prefix?footer:footer.replaceAll('../','')}<script src="${prefix}js/vestment-quote.js" defer></script></body></html>\n`;}
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
function card(p,prefix=''){const mode=purchaseCapabilities(p);return `<div class="product-card${approvedQuoteIds.has(p.id)?' vestment-card':''}" data-cat="${esc(p.category||'quote')}"><div class="product-img"><a href="${prefix}products/${esc(p.slug)}.html"><img loading="lazy" src="${prefix}${esc(p.image)}" alt="${esc(p.alt||p.name)}"/></a></div><div class="product-body"><h3>${esc(p.name)}</h3><p>${esc(p.description||'Tell us about your project and request a custom quote.')}</p><a class="btn-order" href="${mode.checkout?esc(mode.checkoutUrl):`${prefix}products/${esc(p.slug)}.html`}">${mode.checkout?'Configure and Order':'Request a Quote'}</a>${mode.checkout&&mode.quote?`<a class="btn-quote-outline" href="${prefix}products/${esc(p.slug)}.html#quote">Request a Quote</a>`:''}</div></div>`;}
function renderProduct(p) {
 const mode = purchaseCapabilities(p);
 const specs=Object.entries({...p.specifications,Colors:p.colors.join(', ')}).map(([k,v])=>`<div class="spec-row"><span class="spec-label">${esc(k)}</span><span class="spec-value">${esc(v)}</span></div>`).join('');
 const form=mode.quote?`<section class="quote-section" id="quote"><div class="quote-inner"><div class="quote-header"><h2>Request a Free Quote</h2><p>Tell us what your church needs. We will review your measurements, design requirements and requested date with your quote.</p><div class="divider"></div></div><div class="quote-form" id="quoteFormWrap"><form id="quoteForm" action="https://formspree.io/f/xqeydkya" method="POST"><input type="hidden" name="product" value="${esc(p.name)}"/><input type="hidden" name="product_id" value="${esc(p.id)}"/><input type="hidden" name="product_page_url" value="https://www.divineprinting.com/products/${esc(p.slug)}.html"/><div class="form-row">${field('name','Full Name','text',true)}${field('email','Email Address','email',true)}</div><div class="form-row">${field('phone','Phone Number','tel')}${field('church','Church / Organization')}</div><div class="form-row">${field('quantity','Quantity Needed')}${field('delivery_date','Requested delivery date','date')}</div><div class="form-group"><label for="q-color">Preferred color / finish</label><select id="q-color" name="color"><option value="">Select a color...</option>${p.colors.map(c=>`<option>${esc(c)}</option>`).join('')}</select></div>${p.quoteFields.map(f=>field(f.name,f.label)).join('')}<div class="form-group"><label for="q-message">Additional instructions / design requirements</label><textarea id="q-message" name="message"></textarea></div><p>Measurements, designs and delivery requests are subject to confirmation with your quote.</p><div class="form-check"><input type="checkbox" id="fconsent" name="consent" value="agreed" required/><label for="fconsent">I agree to be contacted by Divine Printing regarding this quote request. We respect your privacy and will never share your information.</label></div><div class="h-captcha" data-sitekey="a5f28750-0a52-40f2-a1b0-eee4c19022ae"></div><p id="quoteStatus" role="status" aria-live="polite"></p><button type="submit" class="btn-submit" id="submitBtn">✝ Send My Quote Request</button></form></div></div></section>`:'';
 const body=`<main><div class="breadcrumb"><a href="../index.html">Home</a> › <a href="../index.html#apparel">Apparel and Vestments</a> › ${esc(p.name)}</div><div class="product-hero"><div class="product-gallery"><div class="product-main-img"><img src="../${esc(p.image)}" alt="${esc(p.alt)}" width="900" height="490"/></div></div><div class="product-info"><div class="pi-category">✝ Apparel and Vestments</div><h1>${esc(p.name)}</h1><p class="pi-tagline">${esc(p.description)}</p><div class="pi-specs"><h4>Product Specifications</h4>${specs}</div><div class="pi-actions">${purchaseActions(p)}<a href="../custom-quote-products.html" class="btn-quote-outline">Custom Quote Products</a></div></div></div><div class="product-desc"><div><h2>About This Product</h2><p>${esc(p.description)}</p><p>${mode.quote?'Share your required quantity, measurements and design details below. Pricing and order details will be confirmed with your quote.':'Continue to the existing ordering page to configure your product and review order details.'}</p></div><div class="pi-features"><h4>Features and ordering details</h4><ul>${Object.entries(p.specifications).map(([k,v])=>`<li>${esc(k)}: ${esc(v)}</li>`).join('')}</ul></div></div>${form}</main>`;
 const html = shell(p.name,p.description,body,'../',mode.quote).replace('</head>', `<link rel="canonical" href="https://www.divineprinting.com/products/${esc(p.slug)}.html"/></head>`);
 return mode.quote ? html : html.replaceAll('href="#quote"', 'href="../custom-quote-products.html"');
}
function generateApprovedProducts() {
// Only these configured vestments are generated; no existing checkout page is migrated.
for (const product of products) {
  if (product.purchaseMode !== 'quote') throw new Error('Approved vestments must remain quote-only');
  fs.writeFileSync(path.join(root, `products/${product.slug}.html`), renderProduct(product));
}
// Existing quote inventory is derived from the existing forms, not a second catalog.
const existing=[];
for(const filename of fs.readdirSync(path.join(root,'products')).filter(n=>n.endsWith('.html')&&!products.some(p=>`${p.slug}.html`===n))){const html=fs.readFileSync(path.join(root,'products',filename),'utf8');if(!/action="https:\/\/formspree.io\/f\/xqeydkya"/.test(html))continue; const name=html.match(/<h1[^>]*>(.*?)<\/h1>/s)?.[1]; const image=html.match(/class="product-main-img"[\s\S]*?<img[^>]*src="([^\"]+)"/)?.[1];if(name&&image)existing.push({slug:filename.slice(0,-5),name:name.replace(/<[^>]+>/g,''),image:image.replace(/^\.\.\//,''),purchaseMode:'quote'});}
fs.writeFileSync(path.join(root,'custom-quote-products.html'),shell('Custom Quote Products','Request quotes for church printing, vestments and liturgical accessories.',`<main class="section-inner"><div class="section-header"><h1>Custom Quote Products</h1><p>Browse church products with a quote request form for your project.</p><a href="index.html#apparel">Apparel and Vestments</a></div><div class="product-grid">${[...existing,...products].map(p=>card(p)).join('')}</div></main>`,'',false));
let index=fs.readFileSync(path.join(root,'index.html'),'utf8').replace('<div class="cat-tab">Apparel</div>','<div class="cat-tab">Apparel and Vestments</div>').replace("'Apparel':", "'Apparel and Vestments':");
index=index.replace(/\n<!-- VESTMENTS START -->[\s\S]*?<!-- VESTMENTS END -->/,'');
index=index.replace('      <div class="product-card" data-cat="apparel">','\n<!-- VESTMENTS START -->\n'+products.map((p,i)=>card(p).replace('<div ', i===0?'<div id="apparel" ':'<div ')).join('\n')+'\n<!-- VESTMENTS END -->\n      <div class="product-card" data-cat="apparel">');
if(!index.includes('href="custom-quote-products.html"'))index=index.replace('<div class="cat-tabs">','<p><a href="custom-quote-products.html">Browse Custom Quote Products</a></p>\n<div class="cat-tabs">');
if (!index.includes('href="/vestments.css"')) index=index.replace('<link rel="stylesheet" href="/styles.css?v=3" />', '<link rel="stylesheet" href="/styles.css?v=3" />\n  <link rel="stylesheet" href="/vestments.css" />');
fs.writeFileSync(path.join(root,'index.html'),index);
const tshirt=path.join(root,'products/church-t-shirt.html');fs.writeFileSync(tshirt,fs.readFileSync(tshirt,'utf8').replace('&#10013; Apparel</div>','&#10013; Apparel and Vestments</div>'));
console.log(`Rendered ${products.length} approved quote products and listing with ${existing.length} existing quote products`);


let sitemap=fs.readFileSync(path.join(root,'sitemap.xml'),'utf8');
for(const route of ['custom-quote-products.html',...products.map(p=>`products/${p.slug}.html`)]){const url=`https://www.divineprinting.com/${route}`;if(!sitemap.includes(url))sitemap=sitemap.replace('</urlset>',`  <url><loc>${url}</loc></url>\n</urlset>`);}
fs.writeFileSync(path.join(root,'sitemap.xml'),sitemap);

}
if (require.main === module) generateApprovedProducts();
module.exports = { products, purchaseCapabilities, purchaseActions, card, renderProduct, generateApprovedProducts };
