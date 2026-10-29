(function(){
 'use strict';
 const collections=Array.from(document.querySelectorAll('[data-product-collection]'));
 if(!collections.length||document.documentElement.dataset.collectionsInitialized)return;
 document.documentElement.dataset.collectionsInitialized='true';
 const aliases={banners:'banners',events:'events',signage:'signs',promo:'stickers',print:'print',apparel:'apparel'};
 function filter(section,category){
  section.querySelectorAll('[data-filter]').forEach(button=>{const active=button.dataset.filter===category;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active))});
  let count=0;section.querySelectorAll('.product-card[data-cat]').forEach(card=>{const matches=category==='all'||card.dataset.cat===category||(category==='stickers'&&card.dataset.cat==='promo');card.hidden=!matches;if(matches)count++});section.querySelector('.collection-empty').hidden=count>0;
 }
 function offset(){const height=document.querySelector('header')?.getBoundingClientRect().height||90;document.documentElement.style.setProperty('--storefront-anchor-offset',Math.ceil(height+16)+'px')}
 function navigate(){offset();const originalId=window.location.hash.slice(1);const id=['order-instantly','custom-quote-products'].includes(originalId)?'products':originalId;let target=id==='products'?collections[0]:document.getElementById(id);if(aliases[id]){collections.forEach(section=>filter(section,aliases[id]));target=collections.find(section=>Array.from(section.querySelectorAll('.product-card')).some(card=>!card.hidden))}
  if(target?.matches('[data-product-collection]')){target.scrollIntoView({behavior:'instant',block:'start'});target.querySelector('h2').focus({preventScroll:true})}}
 collections.forEach(section=>section.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>filter(section,button.dataset.filter))));
 document.addEventListener('click',event=>{const link=event.target.closest?.('a[href]');if(!link||event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;const destination=new URL(link.href);const localCategory=destination.origin===location.origin&&['/','/index.html'].includes(destination.pathname)&&aliases[destination.hash.slice(1)];if(!link.closest('.collection-nav')&&!localCategory)return;event.preventDefault();if(location.hash!==destination.hash)history.pushState(null,'',destination.hash);navigate()});
 window.addEventListener('hashchange',()=>requestAnimationFrame(navigate));window.addEventListener('popstate',()=>requestAnimationFrame(navigate));window.addEventListener('resize',offset);offset();requestAnimationFrame(navigate);
})();
