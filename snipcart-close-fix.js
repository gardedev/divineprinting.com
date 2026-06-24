// Close button fix - v2
(function() {
  'use strict';
  
  function fixCloseButton() {
    var btn = document.querySelector('.snipcart-cart-header__close-button');
    if (!btn || btn.getAttribute('data-fixed') === 'true') return;
    
    btn.setAttribute('data-fixed', 'true');
    btn.style.cssText = 'background:#c9a227 !important;border:2px solid #c9a227 !important;border-radius:8px !important;width:44px !important;height:44px !important;display:flex !important;align-items:center !important;justify-content:center !important;color:#1a0d30 !important;font-size:28px !important';
    btn.innerHTML = '&times;';
  }
  
  // Try multiple times
  setInterval(fixCloseButton, 300);
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', fixCloseButton);
  } else {
    fixCloseButton();
  }
  
  document.addEventListener('snipcart.ready', fixCloseButton);
})();
