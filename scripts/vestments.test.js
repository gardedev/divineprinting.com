'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const products=require('./vestment-products.json');
const root=path.resolve(__dirname,'..');
test('all eleven catalog products are quote only with supported fields and bottom forms',()=>{
 assert.equal(products.length,11);assert.equal(new Set(products.map(p=>p.id)).size,11);
 for(const p of products){
  const html=fs.readFileSync(path.join(root,`products/${p.slug}.html`),'utf8');
  assert.equal(p.purchaseMode,'quote');assert.equal(p.category,'apparel');
  assert.match(html,/name="name"[^>]*required/);assert.match(html,/name="email"[^>]*required/);assert.match(html,/name="consent"[^>]*required/);
  assert.ok(html.includes(`name="product_id" value="${p.id}"`));assert.match(html,/name="product_page_url"/);
  assert.ok(html.indexOf('id="quote"')>html.indexOf('class="product-desc"'));
  assert.doesNotMatch(html,/snipcart-add-item|snipcart\.js|addToCart|send-quote\.php|Valor et Virtus|Masonic/i);
 }
});
test('discovery preserves category key and contains every product',()=>{
 const home=fs.readFileSync(path.join(root,'index.html'),'utf8');const listing=fs.readFileSync(path.join(root,'custom-quote-products.html'),'utf8');
 assert.equal((home.match(/data-filter="apparel"/g)||[]).length,2);assert.ok(home.includes('products/church-t-shirt.html'));
 for(const p of products){assert.ok(home.includes(`products/${p.slug}.html`));assert.ok(listing.includes(`products/${p.slug}.html`));}
 assert.ok(listing.includes('products/stage-backdrop-banner.html'));
});
function runtime({valid=true,token='captcha-token',ok=true,network=false}={}){
 let submit;const button={disabled:false,textContent:'Send'};const status={textContent:''};let resets=0,calls=[];
 const form={dataset:{},action:'https://formspree.io/f/xqeydkya',reportValidity:()=>valid,addEventListener:(type,fn)=>submit=fn};
 const context={document:{getElementById:id=>({quoteForm:form,submitBtn:button,quoteStatus:status}[id])},window:{DivineQuoteConfig:require('../js/quote-config.js'),hcaptcha:{getResponse:()=>token,reset:()=>resets++},location:{href:'https://www.divineprinting.com/products/test.html#quote',pathname:'/products/test.html'}},URL,AbortController,setTimeout,clearTimeout,FormData:class{constructor(){this.values={}}set(k,v){this.values[k]=v}},fetch:async(url,options)=>{calls.push({url,options});if(network)throw Error('offline');return {ok,status:ok?200:422,text:async()=>JSON.stringify(ok?{}:{errors:[{message:'Please try again'}]})}}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'js/vestment-quote.js'),'utf8'),context);
 return {submit:()=>submit({preventDefault(){}}),button,status,calls,context,resets:()=>resets};
}
test('invalid form and missing captcha never submit',async()=>{for(const settings of [{valid:false},{token:''}]){const r=runtime(settings);await r.submit();assert.equal(r.calls.length,0)}});
test('successful mocked Formspree submission uses fresh captcha and thank-you redirect',async()=>{const r=runtime();await r.submit();assert.equal(r.calls.length,1);const {url,options}=r.calls[0];assert.equal(url,'https://formspree.io/f/xqeydkya');assert.equal(options.method,'POST');assert.equal(options.headers.Accept,'application/json');assert.equal(options.body.values['h-captcha-response'],'captcha-token');assert.equal(r.context.window.location.href,'/thank-you.html')});
test('server and network errors restore form and captcha',async()=>{for(const settings of [{ok:false},{network:true}]){const r=runtime(settings);await r.submit();assert.equal(r.button.disabled,false);assert.ok(r.status.textContent);assert.equal(r.resets(),1)}});
test('double submit blocked while request is pending',async()=>{const r=runtime();r.button.disabled=true;await r.submit();assert.equal(r.calls.length,0)});
test('private sources excluded and new stylesheet published',()=>{const {isPublicAsset}=require('./build-static');assert.equal(isPublicAsset('vestments.css'),true);for(const f of ['scripts/vestment-products.json','scripts/render-vestments.js','vendor-references/source.pdf','review/manifest.json','.env'])assert.equal(isPublicAsset(f),false)});
test('requiring renderer performs no writes',()=>{
 const write=fs.writeFileSync;
 fs.writeFileSync=()=>{throw new Error('Import must not regenerate files')};
 try { delete require.cache[require.resolve('./render-vestments')];assert.equal(typeof require('./render-vestments').renderProduct,'function'); }
 finally {fs.writeFileSync=write;}
});
test('all purchase modes control page forms, CAPTCHA, actions and card destinations',()=>{
 const {renderProduct,card}=require('./render-vestments');
 for(const mode of ['quote','checkout','both']){
  const product={...products[0],id:'synthetic-product',slug:'synthetic-product',purchaseMode:mode,checkoutUrl:'/products/church-t-shirt.html'};
  const page=renderProduct(product),tile=card(product);const hasQuote=mode!=='checkout',hasCheckout=mode!=='quote';
  assert.equal(page.includes('id="quoteForm"'),hasQuote,mode+' quote form');
  assert.equal(page.includes('https://js.hcaptcha.com/1/api.js'),hasQuote,mode+' CAPTCHA');
  assert.equal(page.includes('href="#quote"'),hasQuote,mode+' quote anchor');
  assert.equal(page.includes('Configure and Order'),hasCheckout,mode+' checkout action');
  assert.equal(page.includes('href="/products/church-t-shirt.html"'),hasCheckout,mode+' checkout destination');
  assert.equal(tile.includes('Configure and Order'),hasCheckout,mode+' card checkout');
  assert.equal(tile.includes('Request a Quote'),hasQuote,mode+' card quote');
  if(mode==='both')assert.ok(tile.includes('products/synthetic-product.html#quote'));
 }
});
test('checkout modes fail closed without an existing local ordering destination',()=>{
 const {renderProduct}=require('./render-vestments');
 for(const mode of ['checkout','both'])for(const destination of [undefined,'javascript:alert(1)','https://outside.invalid/order','//outside.invalid/order','/checkout/missing.html','/scripts/render-vestments.js','#quote']){
  assert.throws(()=>renderProduct({...products[0],id:'synthetic',purchaseMode:mode,checkoutUrl:destination}),/Checkout/);
 }
 assert.throws(()=>renderProduct({...products[0],id:'synthetic',purchaseMode:'unknown'}),/Invalid purchase mode/);
});
test('every approved vestment rejects any checkout-capable override',()=>{
 const {renderProduct,card}=require('./render-vestments');
 for(const product of products){
  for(const mode of ['checkout','both']){
   const override={...product,purchaseMode:mode,checkoutUrl:'/products/church-t-shirt.html'};
   assert.throws(()=>renderProduct(override),/remain quote-only/);assert.throws(()=>card(override),/remain quote-only/);
  }
  assert.doesNotMatch(renderProduct({...product,checkoutUrl:'/products/church-t-shirt.html'}),/Configure and Order/);
 }
});
test('approved woven trim identity replaces the old unpublished identity everywhere public',()=>{
 const product=products.find(p=>p.id==='gold-woven-grape-and-vine-vestment-trim');
 assert.ok(product);assert.equal(product.name,'Gold Woven Grape and Vine Vestment Trim');
 assert.equal(product.image,'images/gold-woven-grape-and-vine-vestment-trim.jpg');
 const page=fs.readFileSync(path.join(root,`products/${product.slug}.html`),'utf8');
 assert.ok(page.includes(`<title>${product.name}`));assert.ok(page.includes(`<h1>${product.name}</h1>`));
 assert.ok(page.includes(`name="product" value="${product.name}"`));assert.ok(page.includes(`name="product_id" value="${product.id}"`));
 assert.ok(page.includes(`href="https://www.divineprinting.com/products/${product.slug}.html"`));
 const obsolete='embroidered-grape-and-vine-vestment-trim';
 for(const extension of ['products/'+obsolete+'.html','images/'+obsolete+'.jpg'])assert.equal(fs.existsSync(path.join(root,extension)),false);
 for(const file of ['index.html','custom-quote-products.html','sitemap.xml',...products.map(p=>`products/${p.slug}.html`)]){
  const html=fs.readFileSync(path.join(root,file),'utf8');assert.ok(!html.includes(obsolete));assert.ok(!html.includes('Embroidered Grape and Vine Vestment Trim'));
 }
});
function jpegDimensions(bytes){
 let offset=2;
 while(offset<bytes.length){assert.equal(bytes[offset++],0xff);let marker=bytes[offset++];while(marker===0xff)marker=bytes[offset++];const length=bytes.readUInt16BE(offset);
  if([0xc0,0xc1,0xc2].includes(marker))return {height:bytes.readUInt16BE(offset+3),width:bytes.readUInt16BE(offset+5)};
  offset+=length;
 }
 throw Error('JPEG frame not found');
}
test('all eleven reframed images are 900 by 490 and new 4:3 panels use subject-safe cover',()=>{
 for(const product of products){assert.deepEqual(jpegDimensions(fs.readFileSync(path.join(root,product.image))),{height:490,width:900})}
 const css=fs.readFileSync(path.join(root,'vestments.css'),'utf8');assert.match(css,/\.vestment-card \.product-img img\s*\{\s*object-fit: cover;/);
 assert.match(css,/\.vestment-product \.product-main-img img\s*\{\s*object-fit: cover;/);
 const home=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.match(home,/href="\/vestments.css"/);assert.equal((home.match(/class="product-card vestment-card"/g)||[]).length,11);
});

test('new quote cards target their own bottom form and existing quote cards preserve routes',()=>{
 const {card,renderProduct}=require('./render-vestments');
 for(const product of products){
  assert.ok(card(product).includes(`class="btn-order" href="products/${product.slug}.html#quote"`));
  assert.ok(renderProduct(product).includes('id="quoteHeading" tabindex="-1"'));
  assert.ok(renderProduct(product).includes('class="vestment-product"'));
 }
 const old=card({id:'existing',slug:'stage-backdrop-banner',name:'Stage',purchaseMode:'quote',image:'images/backdrop.jpg'});
 assert.ok(old.includes('class="btn-order" href="products/stage-backdrop-banner.html"'));
});
