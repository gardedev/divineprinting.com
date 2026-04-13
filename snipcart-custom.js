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
