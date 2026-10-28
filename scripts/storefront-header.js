'use strict';
// Root-relative destinations keep this fragment identical at every directory depth.
function renderHeader() {
 const links=[['/index.html','Home'],['/index.html#banners','Banners &amp; Flags'],['/index.html#events','Event Displays'],['/index.html#signage','Signs'],['/index.html#promo','Promo &amp; Stickers'],['/index.html#print','Print'],['/index.html#apparel','Apparel and Vestments']];
 const logo='<a href="/index.html" class="logo"><div class="logo-icon"><img src="/images/logo-icon.png" alt="Divine Printing Logo"/></div><div class="logo-text"><div class="brand">Divine Printing</div><div class="tagline">Crafted for the Kingdom</div></div></a>';
 return `<header class="site-header" data-storefront-header><div class="nav-inner">${logo}<nav class="desktop-nav" aria-label="Main navigation">${links.map(([href,label])=>`<a href="${href}">${label}</a>`).join('')}</nav><div class="header-actions"><a href="/account/account.html" class="header-icon" aria-label="My Account"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg><span class="icon-label">Account</span></a><a href="/cart.html" class="header-icon cart-icon" aria-label="Shopping Cart"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg><span class="cart-count" id="cart-count">0</span><span class="icon-label">Cart</span></a><button type="button" class="mobile-menu-btn" data-menu-open aria-label="Open Menu" aria-controls="mobile-menu" aria-expanded="false"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg></button></div></div><div class="mobile-menu" id="mobile-menu" aria-hidden="true"><div class="mobile-menu-header">${logo}<button type="button" class="mobile-menu-close" data-menu-close aria-label="Close Menu">×</button></div><nav class="mobile-nav" aria-label="Mobile navigation">${links.map(([href,label])=>`<a href="${href}">${label}</a>`).join('')}<a href="/account/account.html">My Account</a><a href="/cart.html">My Cart (<span class="mobile-cart-count" data-mobile-cart-count>0</span>)</a></nav></div><script src="/js/storefront-header.js" defer></script></header>`;
}
function updateHeaders(root) {
 const fs=require('node:fs'),path=require('node:path');
 for(const file of require('./storefront-header-paths.json')) {
  const target=path.join(root,file),html=fs.readFileSync(target,'utf8');
  const matches=html.match(/<header\b[^>]*>[\s\S]*?<\/header>/g)||[];
  if(matches.length!==1)throw Error(`Expected exactly one common header in ${file}`);
  fs.writeFileSync(target,html.replace(matches[0],renderHeader()));
 }
}
if(require.main===module)updateHeaders(require('node:path').resolve(__dirname,'..'));
module.exports={renderHeader,updateHeaders};
