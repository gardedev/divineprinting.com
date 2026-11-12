'use strict';
// Scoped custom-printing renderer; existing products and runtime quote handling are preserved.
const fs = require('node:fs'), path = require('node:path');
const products = require('./books-print-products.json');
const quoteConfig = require('../js/quote-config');
const { renderHeader } = require('./storefront-header');
const { extractCards, catalog, renderHomeCollections } = require('./storefront-catalog');
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Keep the retained project fields aligned with the shared quote payload adapter.
const fields = [
 {name:'quantity',label:'Quantity',type:'text',required:true,bookQuantity:true},
 {name:'delivery_date',label:'Requested Delivery Date',type:'date'},
 {name:'dimensions',label:'Book Size',placeholder:'Dimensions and units, or leave blank if unsure'},
 {name:'page_count',label:'Page Count',type:'number',min:1},
 {name:'message',label:'Project Details / Special Instructions',type:'textarea',placeholder:'Describe your content, paper, binding, cover, finishing or artwork preferences.'}
];
const retiredSlug = 'church-flyers-standard';
const cardSlug = html => html.match(/href="\/?products\/([^"#]+)\.html/)[1];
function field(f, product) {
 const id='q-'+f.name, attrs=`id="${id}" name="${f.name}"${f.required?' required':''}`;
 const options=typeof f.choices==='string'?product[f.choices]:f.choices;
 const control=options?`<select ${attrs}>${options.map(value=>`<option>${esc(value)}</option>`).join('')}</select>`:
  f.type==='textarea'?`<textarea ${attrs} maxlength="500"${f.placeholder?` placeholder="${esc(f.placeholder)}"`: ''}></textarea>`:
  `<input ${attrs} type="${f.type||'text'}"${f.bookQuantity?' inputmode="numeric" pattern="[0-9]{1,16}" data-book-quote-quantity':f.type==='number'?` min="${f.min}"${f.max?` max="${f.max}"`:''} step="1"`:f.type==='date'?'':` maxlength="${f.maxlength||500}"`}${f.placeholder?` placeholder="${esc(f.placeholder)}"`:''}/>`;
 return `<div class="form-group"><label for="${id}">${esc(f.label)}${f.required?' *':''}</label>${control}</div>`;
}
function imageAvailable(root,p) { return fs.existsSync(path.join(root,p.image)); }
function card(root,p) {
 const image=fs.existsSync(path.join(root,p.detailImage))?`<div class="product-img"><a href="products/${esc(p.slug)}.html"><img loading="lazy" src="${esc(p.detailImage)}" alt="${esc(p.alt)}" width="900" height="675" style="transform:none"/></a></div>`:'';
 return `<div class="product-card" data-cat="print" data-book-product="${esc(p.slug)}">${image}<div class="product-body"><h3>${esc(p.name)}</h3><p>${esc(p.description)}</p><div class="product-meta">${p.cardBadges.map(badge=>`<span class="meta-tag">${esc(badge)}</span>`).join('')}</div><a class="btn-order" href="products/${esc(p.slug)}.html">Request a Quote</a></div></div>`;
}
function renderProduct(root,p) {
 const stage=fs.readFileSync(path.join(root,'products/stage-backdrop-banner.html'),'utf8');
 const footer=stage.match(/<footer>[\s\S]*?<\/footer>/)[0];
 const detailAvailable=fs.existsSync(path.join(root,p.detailImage));
 const image=detailAvailable?`<div class="product-gallery"><div class="product-main-img"><img src="../${esc(p.detailImage)}" alt="${esc(p.alt)}" width="900" height="675"/></div><div class="product-scripture">&ldquo;${esc(p.scripture.text)}&rdquo;<cite>&mdash; ${esc(p.scripture.reference)} (${esc(p.scripture.translation)}${p.scripture.excerpt?', excerpt':''})</cite></div><p style="font-size:.8rem;line-height:1.5;margin-top:12px;color:var(--gray)">Illustrative custom-printing mockup. Final materials and finishing are confirmed with your quote.</p></div>`:'';
 const contact=[{name:'name',label:'Full Name',required:true,maxlength:100},{name:'email',label:'Email Address',type:'email',required:true,maxlength:254},{name:'phone',label:'Phone Number',type:'tel',maxlength:50},{name:'church',label:'Church / Organization',maxlength:100}];
 const paired=contact.concat(fields.slice(0,-1));
 const rows=[];for(let i=0;i<paired.length;i+=2)rows.push(`<div class="form-row">${paired.slice(i,i+2).map(f=>field(f,p)).join('')}</div>`);
 const form=`<section class="quote-section" id="quote"><div class="quote-inner"><div class="quote-header"><h2 id="quoteHeading" tabindex="-1">Request a Free Quote</h2><p>Tell us about your printing project. Specifications, availability and delivery estimates are confirmed with your quote.</p><div class="divider"></div></div><div class="quote-form" id="quoteFormWrap"><form id="quoteForm" action="${quoteConfig.endpoint}" method="POST"><input type="hidden" name="product" value="${esc(p.name)}"/><input type="hidden" name="product_id" value="${esc(p.slug)}"/><input type="hidden" name="product_page_url" value="https://www.divineprinting.com/products/${esc(p.slug)}.html"/>${rows.join('')}${field(fields.at(-1),p)}<p style="font-size:.85rem;line-height:1.5;margin-bottom:20px">Optional specifications are requests subject to confirmation. Do not include sensitive information in your inquiry.</p><div class="form-check"><input type="checkbox" id="fconsent" name="consent" value="agreed" required/><label for="fconsent">I agree to be contacted by Divine Printing about this quote request.</label></div><div class="h-captcha" data-sitekey="${quoteConfig.sitekey}" data-callback="divineQuoteCaptchaReady" data-expired-callback="divineQuoteCaptchaExpired" data-error-callback="divineQuoteCaptchaError"></div><p id="quoteStatus" role="status" aria-live="polite"></p><button type="submit" class="btn-submit" id="submitBtn">Send My Quote Request</button></form></div></div></section>`;
 const body=`<main><div class="breadcrumb"><div style="max-width:1280px;margin:0 auto;padding:0 24px;"><a href="../index.html">Home</a> <span>›</span> <a href="../index.html#print">Books and Print</a> <span>›</span> <span>${esc(p.name)}</span></div></div><div class="product-hero"${image?'':' style="grid-template-columns:minmax(0,1fr)"'}>${image}<div class="product-info"><div class="pi-category">&#10013; Books and Print</div><h1>${esc(p.name)}</h1><p class="pi-tagline">${esc(p.description)}</p><div class="pi-specs"><h4>Product Specifications</h4>${p.specifications.map(([label,value])=>`<div class="spec-row"><span class="spec-label">${esc(label)}</span><span class="spec-value">${esc(value)}</span></div>`).join('')}</div><div class="pi-features"><h4>Key Features</h4><ul>${p.features.map(feature=>`<li>${esc(feature)}</li>`).join('')}</ul></div><div class="pi-actions"><a href="#quote" class="btn-quote">Get Quote</a></div></div></div><div class="product-desc"><div><h2>About This Product</h2>${p.about.map(paragraph=>`<p>${esc(paragraph)}</p>`).join('')}</div><div class="use-cases"><h4>&#10013; Perfect For</h4>${p.uses.map(use=>`<div class="use-case-item"><span class="uc-icon" aria-hidden="true">&#10013;</span>${esc(use)}</div>`).join('')}</div></div>${form}</main>`;
 return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${esc(p.name)} | Divine Printing</title><meta name="description" content="${esc(p.description)}"/><link rel="canonical" href="https://www.divineprinting.com/products/${esc(p.slug)}.html"/><link rel="icon" href="../favicon.ico"/><link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@400;600;700&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet"/><link rel="stylesheet" href="../styles.css?v=3"/><link rel="stylesheet" href="../product.css"/></head><body>${renderHeader()}${body}${footer}<script src="../js/books-print-quantity.js" defer></script><script src="../js/quote-config.js" defer></script><script src="../js/vestment-quote.js" defer></script></body></html>\n`;
}
function replaceGrid(html, replacement) {
 const start=html.search(/<div class="product-grid">/);if(start<0)throw Error('Missing listing grid');const tags=/<\/?div\b[^>]*>/g;tags.lastIndex=html.indexOf('>',start)+1;let depth=1,m;while(depth&&(m=tags.exec(html)))depth+=m[0].startsWith('</')?-1:1;if(depth)throw Error('Unbalanced listing grid');return html.slice(0,start)+'<div class="product-grid">'+replacement+'</div>'+html.slice(tags.lastIndex);
}
function generate(root=path.resolve(__dirname,'..')) {
 const ids=new Set(products.map(p=>p.slug));for(const p of products)fs.writeFileSync(path.join(root,'products',p.slug+'.html'),renderProduct(root,p));
 let index=fs.readFileSync(path.join(root,'index.html'),'utf8');const entries=catalog(root,[]).filter(e=>!ids.has(e.slug)&&e.slug!==retiredSlug);for(const p of products)entries.push({slug:p.slug,mode:'quote',html:card(root,p)});
 const start=index.indexOf('<section id="products">'),end=index.indexOf('<!-- TESTIMONIALS -->');if(start<0||end<start)throw Error('Missing homepage catalog boundary');index=index.slice(0,start)+renderHomeCollections(entries)+'\n'+index.slice(end);fs.writeFileSync(path.join(root,'index.html'),index);
 const listing=path.join(root,'custom-quote-products.html');const original=fs.readFileSync(listing,'utf8');const existing=extractCards(original).filter(html=>!ids.has(cardSlug(html))&&cardSlug(html)!==retiredSlug);fs.writeFileSync(listing,replaceGrid(original,existing.concat(products.map(p=>card(root,p))).join('\n')));
 const sitemap=path.join(root,'sitemap.xml');let xml=fs.readFileSync(sitemap,'utf8');xml=xml.replace(/\s*<url>\s*<loc>https:\/\/www\.divineprinting\.com\/products\/church-flyers-standard\.html<\/loc>[\s\S]*?<\/url>/g,'');for(const p of products){const url=`https://www.divineprinting.com/products/${p.slug}.html`;if(!xml.includes('<loc>'+url+'</loc>'))xml=xml.replace('</urlset>',`  <url><loc>${url}</loc></url>\n</urlset>`);}fs.writeFileSync(sitemap,xml);
 return {products:products.length,missingImages:products.filter(p=>!imageAvailable(root,p)).map(p=>p.image)};
}
if(require.main===module)console.log(JSON.stringify(generate()));
module.exports={products,fields,field,card,renderProduct,generate};
