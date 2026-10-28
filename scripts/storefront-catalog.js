'use strict';
const fs=require('node:fs'),path=require('node:path');
function extractCards(html){
 const cards=[];const pattern=/<div\b[^>]*class="[^"]*\bproduct-card\b[^"]*"[^>]*>/g;let found;
 while((found=pattern.exec(html))){let depth=1;const tags=/<\/?div\b[^>]*>/g;tags.lastIndex=pattern.lastIndex;let tag;while(depth&&(tag=tags.exec(html)))depth+=tag[0].startsWith('</')?-1:1;if(depth)throw Error('Unbalanced product card');cards.push(html.slice(found.index,tags.lastIndex));pattern.lastIndex=tags.lastIndex}
 return cards;
}
function classifyProduct(root,slug,newIds=new Set()){
 const html=fs.readFileSync(path.join(root,'products',slug+'.html'),'utf8');
 if(newIds.has(slug))return {mode:'quote',evidence:'Approved vestment quote-only configuration'};
 if(slug==='church-t-shirt')return {mode:'checkout',evidence:'Existing two-panel configurator and configuredAddButton'};
 if(/data-standard-product/.test(html)&&/data-add-standard-product/.test(html))return {mode:'checkout',evidence:'Existing standard product configuration and add action'};
 const buttons=html.match(/<button\b[^>]*class="[^"]*add-to-cart-btn[^>]*>/g)||[];
 if(buttons.some(button=>!/(?:display\s*:\s*none|\bdisabled\b)/i.test(button))&&/src="[^\"]*cart\.js/.test(html))return {mode:'checkout',evidence:'Visible existing legacy cart action and cart bridge; no activation or readiness inference'};
 if(/action="https:\/\/formspree.io\/f\/xqeydkya"/.test(html))return {mode:'quote',evidence:'Quote workflow with no active purchase/configuration action'};
 throw Error('Unclassified storefront product: '+slug);
}
function catalog(root,newProducts){
 const newIds=new Set(newProducts.map(p=>p.slug));const cards=extractCards(fs.readFileSync(path.join(root,'index.html'),'utf8'));const seen=new Set();return cards.map(html=>{const href=html.match(/href="\/?products\/([^"#]+)\.html/);if(!href)throw Error('Product card has no product route');const slug=href[1];if(seen.has(slug))throw Error('Duplicate card: '+slug);seen.add(slug);return {slug,html,...classifyProduct(root,slug,newIds)}});
}
const categories=[['all','All Products'],['banners','Banners &amp; Flags'],['events','Event Displays'],['signs','Signs'],['stickers','Stickers &amp; Magnets'],['print','Print &amp; Paper'],['apparel','Apparel and Vestments']];
function renderHomeCollections(entries){
 const nav='<nav class="collection-nav" aria-label="Product collections"><a href="#order-instantly">Order Instantly</a><a href="#custom-quote-products">Custom Quote Products</a></nav>';
 const anchors=['banners','events','signage','promo','print','apparel'].map(id=>`<span id="${id}" data-category-anchor></span>`).join('');
 const groups=[['checkout','order-instantly','Order Instantly','Choose a product to configure or purchase through its existing ordering flow.'],['quote','custom-quote-products','Custom Quote Products','Share your requirements for church printing, vestments and liturgical accessories.']];
 return `<section id="products"><div class="section-inner">${anchors}<div class="section-header"><h2>Products for Every Ministry Need</h2><p>Find an existing ordering option or request a quote for your church.</p><div class="divider"></div></div>${nav}${groups.map(([mode,id,title,description])=>`<section id="${id}" class="product-collection" data-product-collection><div class="section-header"><h2 tabindex="-1">${title}</h2><p>${description}</p>${mode==='quote'?'<a class="collection-link" href="custom-quote-products.html">Browse All Custom Quote Products</a>':''}<div class="divider"></div></div><div class="cat-tabs" aria-label="${title} categories">${categories.map(([key,label])=>`<button type="button" class="cat-tab${key==='all'?' active':''}" data-filter="${key}" aria-pressed="${key==='all'}">${label}</button>`).join('')}</div><div class="product-grid">${entries.filter(e=>e.mode===mode).map(e=>e.html.replace(/\s+id="(?:banners|events|signage|promo|print|apparel)"/g,'')).join('\n')}</div><p class="collection-empty" hidden>No products in this collection match that category.</p></section>`).join('')}</div></section><script src="/js/storefront-collections.js" defer></script>\n`;
}
module.exports={extractCards,classifyProduct,catalog,renderHomeCollections};
