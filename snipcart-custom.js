/**
 * Divine Printing Snipcart Customizations
 * Enables Snipcart's native checkout flow
 */

// Snipcart configuration
window.SnipcartSettings = window.SnipcartSettings || {};

// Listen for when Snipcart is ready
document.addEventListener('snipcart.ready', function() {
  console.log('Snipcart is ready');
  
  // You can add custom event handlers here if needed
  // For example, tracking events:
  /*
  Snipcart.events.on('item.added', function(item) {
    console.log('Item added to cart:', item);
  });
  */
});

// Handle any custom cart-related functionality
function openCart() {
  if (window.Snipcart) {
    Snipcart.api.theme.cart.open();
  }
}

// Legacy function for backward compatibility
function viewCart() {
  openCart();
}

// Fix close button styling - inject inline styles to override cached CSS
(function fixCloseButton() {
  const style = document.createElement('style');
  style.textContent = `
    .snipcart-cart-header__close-button {
      background: #c9a227 !important;
      border: 2px solid #c9a227 !important;
      border-radius: 8px !important;
      width: 44px !important;
      height: 44px !important;
      position: relative !important;
    }
    .snipcart-cart-header__close-button svg {
      display: none !important;
    }
    .snipcart-cart-header__close-button::after {
      content: '×' !important;
      color: #1a0d30 !important;
      font-size: 28px !important;
      font-weight: 300 !important;
      position: absolute !important;
      top: 50% !important;
      left: 50% !important;
      transform: translate(-50%, -50%) !important;
      line-height: 1 !important;
    }
  `;
  document.head.appendChild(style);
})();
