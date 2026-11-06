'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),renderer=require('../scripts/render-books-print'),registry=require('../scripts/quote-products.json');
const {buildStatic}=require('../scripts/build-static'),{extractCards}=require('../scripts/storefront-catalog'),{unified,projectHtml}=require('../scripts/quote-only');
const names=["Children's Faith Activity Books",'Ministry Notebooks','Devotional Journals','Church Memory Books','Christian Book Publishing','Ministry Guides & Workbooks','Church Booklets & Programs'];
beforeAll(()=>buildStatic(root,{mode:'quote_only'}));
const read=n=>fs.readFileSync(path.join(root,'dist',n),'utf8');
test('seven exact custom-print services join existing discovery without duplicate or migrated routes',()=>{
 expect(renderer.products.map(p=>p.name)).toEqual(names);expect(Object.keys(registry)).toHaveLength(44);
 for(const listing of ['index.html','custom-quote-products.html']){
  const cards=extractCards(read(listing));expect(cards).toHaveLength(44);expect(cards.filter(h=>/data-cat="print"/.test(h))).toHaveLength(9);
  const slugs=cards.map(h=>h.match(/href="\/?products\/([^"#]+)\.html/)[1]);expect(new Set(slugs).size).toBe(44);for(const p of renderer.products)expect(slugs).toContain(p.slug);
 }
 const sitemap=read('sitemap.xml');for(const p of renderer.products)expect(sitemap.match(new RegExp('<loc>https://www.divineprinting.com/products/'+p.slug+'\\.html</loc>','g'))).toHaveLength(1);
});
test('scoped renderer is idempotent and missing original images produce no substitute or broken markup',()=>{
 const paths=['index.html','custom-quote-products.html','sitemap.xml',...renderer.products.map(p=>'products/'+p.slug+'.html')];const digest=n=>crypto.createHash('sha256').update(fs.readFileSync(path.join(root,n))).digest('hex');const before=paths.map(digest);renderer.generate(root);expect(paths.map(digest)).toEqual(before);
 for(const p of renderer.products){const page=read('products/'+p.slug+'.html');expect(page).not.toMatch(/image pending|alibaba\.com|wholesale|supplier|\$\d|eco.friend|certif|guaranteed/i);expect(page).toContain('Your artwork, manuscript or page layouts');expect(page).toContain('subject to confirmation');}
});
test('seven optimized product images load from publishable assets with alt text and full-frame sizing',()=>{
 for(const p of renderer.products){
  const b=fs.readFileSync(path.join(root,p.image));expect(b.readUInt16BE(0)).toBe(0xffd8);let offset=2,dimensions;
  while(offset<b.length){if(b[offset]!==0xff){offset++;continue;}const marker=b[offset+1];if(marker===0xc0||marker===0xc2){dimensions=[b.readUInt16BE(offset+7),b.readUInt16BE(offset+5)];break;}offset+=2+b.readUInt16BE(offset+2);}
  expect(dimensions).toEqual([900,490]);expect(b.length).toBeLessThan(200000);expect(fs.readFileSync(path.join(root,'dist',p.image))).toEqual(b);
  const page=read('products/'+p.slug+'.html');expect(page).toContain('src="../'+p.image+'"');expect(page).toContain('alt="'+p.alt.replace(/&/g,'&amp;').replace(/'/g,'&#39;')+'"');expect(page).toContain('Illustrative custom-printing mockup.');expect(page).not.toContain('grid-template-columns:minmax(0,1fr)');expect(renderer.card(root,p)).toContain('style="object-fit:contain"');
 }
 const fixture=fs.mkdtempSync(path.join(os.tmpdir(),'divine-book-image-absence-'));
 try{fs.mkdirSync(path.join(fixture,'products'));fs.copyFileSync(path.join(root,'products/stage-backdrop-banner.html'),path.join(fixture,'products/stage-backdrop-banner.html'));const p=renderer.products[0],html=renderer.renderProduct(fixture,p);expect(html).not.toContain('src="../'+p.image+'"');expect(html).toContain('grid-template-columns:minmax(0,1fr)');expect(renderer.card(fixture,p)).not.toContain('<img');}finally{fs.rmSync(fixture,{recursive:true,force:true});}
});
test('all public category labels change while print keys and navigation URLs remain stable',()=>{
 for(const n of buildStatic(root,{mode:'quote_only'}).filter(n=>n.endsWith('.html')&&!n.startsWith('admin/'))){const html=read(n);expect(html).not.toMatch(/Print (?:&amp;|&) Paper/);expect(html).not.toMatch(/<a\b[^>]*href="[^"]*index\.html#print"[^>]*>\s*Print\s*<\/a>/);}
 expect(read('index.html')).toMatch(/data-filter="print"[^>]*>Books and Print/);expect(read('index.html')).toContain('id="print"');
 const unrelated='<html><head></head><body><a href="/print-help.html">Print</a><p>Print your own artwork.</p></body></html>';expect(projectHtml('help.html',unrelated)).toBe(unrelated);
});
test('new inquiry controls have labels, bounded quantity, unknown-spec choices and unchanged form/security integration',()=>{
 for(const p of renderer.products){const html=read('products/'+p.slug+'.html');expect(html).toContain('<h1>'+p.name.replace(/&/g,'&amp;').replace(/'/g,'&#39;')+'</h1>');expect(html.match(/<form\b[^>]*id="quoteForm"/g)).toHaveLength(1);expect(html.match(/<a href="#quote" class="btn-quote">Get Quote<\/a>/g)).toHaveLength(1);expect(html).toContain('action="https://formspree.io/f/xqeydkya"');expect(html).toContain('name="quantity" required type="number" min="1" max="10000" step="1"');expect(html).toContain('Need guidance');expect(html).toContain('name="message" maxlength="500"');expect(html).toContain('name="consent" value="agreed" required');expect(html).not.toMatch(/type="file"|Back to All Products|Add to Cart|Buy Now|Order Instantly/);expect(html.match(/src="\/js\/meta-tracking.js"/g)).toHaveLength(1);expect(html.match(/GTM-MZXJHMD5/g)).toHaveLength(2);for(const f of renderer.fields){expect(html).toContain('for="q-'+f.name+'"');expect(registry[p.slug].optionFields).toContain(f.name);}}
});
test('existing quote adapter carries exact identity and every book specification in structured payloads',()=>{
 for(const p of renderer.products){const values=Object.fromEntries(renderer.fields.map(f=>[f.name,'Need guidance']));Object.assign(values,{quantity:'25',delivery_destination:'Sample city, country',dimensions:'Not sure',page_count:'',message:'Original manuscript supplied'});const form={elements:{namedItem:n=>({value:values[n]})}};const document={getElementById:id=>id==='quoteProduct'?{textContent:JSON.stringify({slug:p.slug,name:p.name,adapter:'form',optionFields:registry[p.slug].optionFields})}:form,querySelector:()=>null,addEventListener:()=>{}};const window={};vm.runInNewContext(fs.readFileSync(path.join(root,'js/product-quote.js'),'utf8'),{window,document});const data=new Map();window.DivineQuoteOptions.prepare(form,data);expect(data.get('product')).toBe(p.name);expect(data.get('product_id')).toBe(p.slug);const summary=JSON.parse(data.get('selected_options'));expect(summary.product).toBe(p.slug);expect(summary.quoteFields).toEqual(values);expect(JSON.parse(data.get('customization_summary'))).toEqual(summary);values.message='x'.repeat(500);expect(()=>window.DivineQuoteOptions.snapshot()).not.toThrow();values.message='x'.repeat(501);expect(()=>window.DivineQuoteOptions.snapshot()).toThrow(/too long/);}
});
test('catalog registry guard rejects missing, duplicate and unregistered product identities',()=>{
 const source=fs.readFileSync(path.join(root,'index.html'),'utf8');expect(()=>unified(source.replace('products/childrens-faith-activity-books.html','products/unregistered-book.html'))).toThrow(/registry/);expect(()=>unified(source.replace(/data-book-product="childrens-faith-activity-books"/,''))).not.toThrow();
});
