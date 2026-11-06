'use strict';
// Scoped custom-printing renderer; existing products and runtime quote handling are preserved.
const fs = require('node:fs'), path = require('node:path');
const products = require('./books-print-products.json');
const quoteConfig = require('../js/quote-config');
const { renderHeader } = require('./storefront-header');
const { extractCards, catalog, renderHomeCollections } = require('./storefront-catalog');
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fields = [
 {name:'quantity',label:'Quantity needed',type:'number',required:true,min:1,max:10000},
 {name:'delivery_date',label:'Requested delivery date',type:'date'},
 {name:'delivery_destination',label:'Delivery destination (city, region and country)'},
 {name:'dimensions',label:'Requested book dimensions / trim size',placeholder:'Not sure / need guidance, or provide dimensions and units'},
 {name:'page_count',label:'Interior page count (leave blank if not sure)',type:'number',min:1},
 {name:'binding',label:'Binding preference',choices:'bindingPreferences'},
 {name:'cover_type',label:'Cover preference',choices:'coverPreferences'},
 {name:'interior_color',label:'Interior color preference',choices:['Need guidance','Black and white (request)','Full color (request)','Mixed color and black and white (request)']},
 {name:'paper',label:'Interior paper preference',placeholder:'Not sure / need guidance, or describe your preference'},
 {name:'finishing',label:'Cover finishing preference',placeholder:'Not sure / need guidance, or describe the finish to review'},
 {name:'artwork_readiness',label:'Artwork / manuscript readiness',choices:['Not sure / need guidance','Ready to print','In progress','Need help preparing files']},
 {name:'message',label:'Additional instructions',type:'textarea'}
];
function field(f, product) {
 const id='q-'+f.name, attrs=`id="${id}" name="${f.name}"${f.required?' required':''}`;
 const options=typeof f.choices==='string'?product[f.choices]:f.choices;
 const control=options?`<select ${attrs}>${options.map(value=>`<option>${esc(value)}</option>`).join('')}</select>`:
  f.type==='textarea'?`<textarea ${attrs} maxlength="500"></textarea>`:
  `<input ${attrs} type="${f.type||'text'}"${f.type==='number'?` min="${f.min}"${f.max?` max="${f.max}"`:''} step="1"`:f.type==='date'?'':` maxlength="${f.maxlength||500}"`}${f.placeholder?` placeholder="${esc(f.placeholder)}"`:''}/>`;
 return `<div class="form-group"><label for="${id}">${esc(f.label)}${f.required?' *':''}</label>${control}</div>`;
}
function imageAvailable(root,p) { return fs.existsSync(path.join(root,p.image)); }
function card(root,p) {
 const image=imageAvailable(root,p)?`<div class="product-img"><a href="products/${esc(p.slug)}.html"><img loading="lazy" src="${esc(p.image)}" alt="${esc(p.alt)}" width="900" height="490" style="object-fit:contain"/></a></div>`:'';
 return `<div class="product-card" data-cat="print" data-book-product="${esc(p.slug)}">${image}<div class="product-body"><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p><a class="btn-order" href="products/${esc(p.slug)}.html">Request a Quote</a></div></div>`;
}
function renderProduct(root,p) {
 const stage=fs.readFileSync(path.join(root,'products/stage-backdrop-banner.html'),'utf8');
 const footer=stage.match(/<footer>[\s\S]*?<\/footer>/)[0];
 const image=imageAvailable(root,p)?`<div class="product-gallery"><div class="product-main-img"><img src="../${esc(p.image)}" alt="${esc(p.alt)}" width="900" height="490" style="object-fit:contain"/></div><p>Illustrative custom-printing mockup. Final materials and finishing are confirmed with your quote.</p></div>`:'';
 const contact=[{name:'name',label:'Full name',required:true,maxlength:100},{name:'email',label:'Email address',type:'email',required:true,maxlength:254},{name:'church',label:'Church / organization',maxlength:100},{name:'phone',label:'Phone number',type:'tel',maxlength:50}];
 const form=`<section class="quote-section" id="quote"><div class="quote-inner"><div class="quote-header"><h2 id="quoteHeading" tabindex="-1">Request a Free Quote</h2><p>Tell us about your printing project. Preferences, availability, minimum quantities and delivery estimates are confirmed with your quote.</p></div><div class="quote-form" id="quoteFormWrap"><form id="quoteForm" action="${quoteConfig.endpoint}" method="POST"><input type="hidden" name="product" value="${esc(p.name)}"/><input type="hidden" name="product_id" value="${esc(p.slug)}"/><input type="hidden" name="product_page_url" value="https://www.divineprinting.com/products/${esc(p.slug)}.html"/>${contact.map(f=>field(f,p)).join('')}${fields.map(f=>field(f,p)).join('')}<p>Choose Need guidance or leave optional specifications blank if you are not sure. Requested formats and finishes are subject to confirmation. Do not include sensitive information in your inquiry.</p><div class="form-check"><input type="checkbox" id="fconsent" name="consent" value="agreed" required/><label for="fconsent">I agree to be contacted by Divine Printing about this quote request.</label></div><div class="h-captcha" data-sitekey="${quoteConfig.sitekey}" data-callback="divineQuoteCaptchaReady" data-expired-callback="divineQuoteCaptchaExpired" data-error-callback="divineQuoteCaptchaError"></div><p id="quoteStatus" role="status" aria-live="polite"></p><button type="submit" class="btn-submit" id="submitBtn">Send My Quote Request</button></form></div></div></section>`;
 const body=`<main><div class="breadcrumb"><a href="../index.html">Home</a> › <a href="../index.html#print">Books and Print</a> › ${esc(p.name)}</div><div class="product-hero"${image?'':' style="grid-template-columns:minmax(0,1fr)"'}>${image}<div class="product-info"><div class="pi-category">Books and Print</div><h1>${esc(p.name)}</h1><p class="pi-tagline">${esc(p.description)}</p><div class="pi-specs"><h2>Plan your printing project</h2><div class="spec-row"><span class="spec-label">Requested project</span><span class="spec-value">${esc(p.requestedFormat)}</span></div><div class="spec-row"><span class="spec-label">Content</span><span class="spec-value">Your artwork, manuscript or page layouts</span></div><div class="spec-row"><span class="spec-label">Size, paper and binding</span><span class="spec-value">Request your preferences for quote review</span></div></div><p>We print your supplied content. This service does not include a prewritten book or ready-made manuscript. Materials, binding and finishing are reviewed for your project before confirmation.</p><div class="pi-actions"><a href="#quote" class="btn-quote">Get Quote</a></div></div></div><div class="product-desc"><div><h2>Custom printing for your ministry</h2><p>${esc(p.description)}</p><p>Share your quantity, requested date and printing brief. If your content or specifications are still in progress, tell us what guidance you need.</p></div><div class="pi-features"><h2>Suitable projects</h2><ul>${p.uses.map(use=>`<li>${esc(use)}</li>`).join('')}</ul></div></div>${form}</main>`;
 return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${esc(p.name)} | Divine Printing</title><meta name="description" content="${esc(p.description)}"/><link rel="canonical" href="https://www.divineprinting.com/products/${esc(p.slug)}.html"/><link rel="icon" href="../favicon.ico"/><link rel="stylesheet" href="../styles.css?v=3"/><link rel="stylesheet" href="../product.css"/></head><body>${renderHeader()}${body}${footer}<script src="../js/quote-config.js" defer></script><script src="../js/vestment-quote.js" defer></script></body></html>\n`;
}
function replaceGrid(html, replacement) {
 const start=html.search(/<div class="product-grid">/);if(start<0)throw Error('Missing listing grid');const tags=/<\/?div\b[^>]*>/g;tags.lastIndex=html.indexOf('>',start)+1;let depth=1,m;while(depth&&(m=tags.exec(html)))depth+=m[0].startsWith('</')?-1:1;if(depth)throw Error('Unbalanced listing grid');return html.slice(0,start)+'<div class="product-grid">'+replacement+'</div>'+html.slice(tags.lastIndex);
}
function generate(root=path.resolve(__dirname,'..')) {
 const ids=new Set(products.map(p=>p.slug));for(const p of products)fs.writeFileSync(path.join(root,'products',p.slug+'.html'),renderProduct(root,p));
 let index=fs.readFileSync(path.join(root,'index.html'),'utf8');const entries=catalog(root,[]).filter(e=>!ids.has(e.slug));for(const p of products)entries.push({slug:p.slug,mode:'quote',html:card(root,p)});
 const start=index.indexOf('<section id="products">'),end=index.indexOf('<!-- TESTIMONIALS -->');if(start<0||end<start)throw Error('Missing homepage catalog boundary');index=index.slice(0,start)+renderHomeCollections(entries)+'\n'+index.slice(end);fs.writeFileSync(path.join(root,'index.html'),index);
 const listing=path.join(root,'custom-quote-products.html');const original=fs.readFileSync(listing,'utf8');const existing=extractCards(original).filter(html=>!ids.has(html.match(/href="\/?products\/([^"#]+)\.html/)[1]));fs.writeFileSync(listing,replaceGrid(original,existing.concat(products.map(p=>card(root,p))).join('\n')));
 const sitemap=path.join(root,'sitemap.xml');let xml=fs.readFileSync(sitemap,'utf8');for(const p of products){const url=`https://www.divineprinting.com/products/${p.slug}.html`;if(!xml.includes('<loc>'+url+'</loc>'))xml=xml.replace('</urlset>',`  <url><loc>${url}</loc></url>\n</urlset>`);}fs.writeFileSync(sitemap,xml);
 return {products:products.length,missingImages:products.filter(p=>!imageAvailable(root,p)).map(p=>p.image)};
}
if(require.main===module)console.log(JSON.stringify(generate()));
module.exports={products,fields,field,card,renderProduct,generate};
