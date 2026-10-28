(function () {
  'use strict';
  const header=document.querySelector('[data-storefront-header]');
  if(!header||header.dataset.initialized)return;
  header.dataset.initialized='true';
  const menu=header.querySelector('#mobile-menu'),open=header.querySelector('[data-menu-open]'),close=header.querySelector('[data-menu-close]');
  const desktopCount=header.querySelector('#cart-count'),mobileCount=header.querySelector('[data-mobile-cart-count]');
  function mirrorCount(){if(desktopCount&&mobileCount)mobileCount.textContent=desktopCount.textContent}
  mirrorCount();
  if(desktopCount&&window.MutationObserver)new MutationObserver(mirrorCount).observe(desktopCount,{childList:true,subtree:true,characterData:true});
  let previousOverflow;
  function setOpen(active,restoreFocus=true) {
    if(menu.classList.contains('active')===active)return;
    menu.classList.toggle('active',active);
    menu.setAttribute('aria-hidden',String(!active));open.setAttribute('aria-expanded',String(active));
    if(active){previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';close.focus()}
    else {document.body.style.overflow=previousOverflow||'';if(restoreFocus)open.focus()}
  }
  window.addEventListener('resize',()=>{if(innerWidth>1150&&menu.classList.contains('active'))setOpen(false,false)});
  open.addEventListener('click',()=>setOpen(true));close.addEventListener('click',()=>setOpen(false));
  menu.addEventListener('click',event=>{if(event.target.closest('a'))setOpen(false)});
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();setOpen(false)}
    if(event.key==='Tab'){
      const items=Array.from(menu.querySelectorAll('a,button')).filter(e=>e.getClientRects().length),first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus()}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus()}
    }
  });
})();
