/**
 * Divine Printing Snipcart Customizations
 * Forces View Cart to go to custom cart page
 */

// Override Snipcart's default behavior before it loads
window.SnipcartSettings = window.SnipcartSettings || {};

// Listen for when Snipcart is ready
document.addEventListener('snipcart.ready', function() {
  
  // Override the cart URL in Snipcart's configuration
  if (Snipcart.api && Snipcart.api.cart) {
    // Try to override the cart URL
    Snipcart.api.cart.setUrl = function() {
      window.location.href = '/cart.html';
    };
  }
  
  // Aggressive override - intercept ALL clicks on links that might be cart links
  document.addEventListener('click', function(e) {
    const target = e.target.closest('a, button');
    if (!target) return;
    
    // Check if this is inside Snipcart modal
    const isInSnipcart = target.closest('.snipcart-modal, .snipcart-add-product-confirmation');
    if (!isInSnipcart) return;
    
    // Check if it's a cart-related link/button
    const text = (target.textContent || '').toLowerCase();
    const href = target.getAttribute('href') || '';
    const classes = (target.className || '').toLowerCase();
    
    // If it mentions cart or view, redirect to our cart
    if (text.includes('cart') || text.includes('view cart') || 
        href.includes('cart') || classes.includes('cart')) {
      e.preventDefault();
      e.stopPropagation();
      window.location.href = '/cart.html';
      return false;
    }
  }, true); // Use capture phase
  
});

// Also try to catch the click before Snipcart processes it
document.addEventListener('click', function(e) {
  const target = e.target.closest('a[href*="cart"], button');
  if (!target) return;
  
  // Check if this is the problematic URL pattern
  const href = target.getAttribute('href') || '';
  if (href.includes('/products/cart/') || href.includes('/cart/products/')) {
    e.preventDefault();
    window.location.href = '/cart.html';
  }
}, true);
