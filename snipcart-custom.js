/**
 * Divine Printing Snipcart Customizations
 * Handles View Cart link interception and other Snipcart behaviors
 */

// Wait for Snipcart to be ready
document.addEventListener('snipcart.ready', function() {
  
  // Override the View Cart link behavior in Snipcart's popup
  // Snipcart creates the popup dynamically, so we need to watch for it
  const observer = new MutationObserver(function(mutations) {
    mutations.forEach(function(mutation) {
      // Look for the View Cart link in Snipcart's confirmation popup
      const viewCartLinks = document.querySelectorAll('.snipcart-cart-button, .snipcart-cart__footer a[href*="cart"], a.snipcart-cart-button');
      
      viewCartLinks.forEach(function(link) {
        // Check if we've already processed this link
        if (link.dataset.dpHandled) return;
        link.dataset.dpHandled = 'true';
        
        // Override the click behavior
        link.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          
          // Navigate to our custom cart page
          window.location.href = '/cart.html';
        });
      });
      
      // Also look for the "View Cart" button in the add-to-cart confirmation
      const confirmationButtons = document.querySelectorAll('.snipcart-add-product-confirmation__button, .snipcart-add-product-confirmation__cart-button');
      
      confirmationButtons.forEach(function(button) {
        if (button.dataset.dpHandled) return;
        button.dataset.dpHandled = 'true';
        
        // Check if this is the "View Cart" button (not "Continue Shopping")
        const buttonText = button.textContent.toLowerCase();
        if (buttonText.includes('cart') || buttonText.includes('view')) {
          button.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            window.location.href = '/cart.html';
          });
        }
      });
    });
  });
  
  // Start observing the document for Snipcart elements
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
  
});

// Also handle clicks on snipcart-checkout class to go to our cart
document.addEventListener('click', function(e) {
  const checkoutButton = e.target.closest('.snipcart-checkout');
  if (checkoutButton && !checkoutButton.classList.contains('snipcart-modal-open')) {
    // If it's not inside the Snipcart modal, redirect to our cart
    const isInModal = checkoutButton.closest('.snipcart-modal__container');
    if (!isInModal) {
      e.preventDefault();
      window.location.href = '/cart.html';
    }
  }
});
