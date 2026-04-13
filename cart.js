/**
 * Divine Printing — Cart System (Snipcart-powered)
 *
 * This module bridges the site's legacy addToCart() API to Snipcart.
 * All cart state is managed by Snipcart (persistent across sessions via
 * customer email capture). The custom localStorage cart has been removed.
 *
 * Public API (unchanged for existing product pages):
 *   addToCart(product)        — adds item and opens Snipcart modal
 *   removeFromCart(id)        — removes item from Snipcart cart
 *   showToast(message)        — shows the branded toast notification
 *   toggleMobileMenu()        — mobile nav toggle
 *
 * Snipcart handles:
 *   • Cart persistence (email-based across devices)
 *   • Item count badge (.snipcart-items-count)
 *   • Checkout, tax, shipping
 *   • Order confirmation emails
 */

// ─── Toast notification ────────────────────────────────────────────────────

function showToast(message, opts = {}) {
  const existing = document.getElementById('divine-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'divine-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  const isError = opts.type === 'error';

  toast.style.cssText = [
    'position:fixed',
    'bottom:24px',
    'right:24px',
    'z-index:9999',
    'padding:16px 20px',
    'border-radius:12px',
    'box-shadow:0 8px 32px rgba(0,0,0,.25)',
    'color:#fff',
    'font-family:Inter,sans-serif',
    'font-size:.95rem',
    'max-width:360px',
    'transform:translateY(100px)',
    'opacity:0',
    'transition:transform .3s ease,opacity .3s ease',
    isError
      ? 'background:linear-gradient(135deg,#b71c1c,#c62828)'
      : 'background:linear-gradient(135deg,#3d1a6e,#5a2d8a)',
  ].join(';');

  toast.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:12px;">
      <span style="font-size:1.4rem;line-height:1;">${isError ? '⚠️' : '✓'}</span>
      <div>
        <div style="font-weight:600;">${message}</div>
        ${!isError ? `
          <div style="font-size:.82rem;opacity:.85;margin-top:5px;">
            <button onclick="openCart()" style="background:none;border:none;color:#c9a227;text-decoration:underline;cursor:pointer;padding:0;font-size:inherit;">View Cart</button>
            &nbsp;&middot;&nbsp;
            <a href="/#products" style="color:#fff;text-decoration:underline;">Continue Shopping</a>
          </div>` : ''}
      </div>
    </div>
  `;

  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.style.transform = 'translateY(0)';
    toast.style.opacity   = '1';
  });

  const duration = opts.duration || (isError ? 6000 : 5000);
  setTimeout(() => {
    toast.style.transform = 'translateY(100px)';
    toast.style.opacity   = '0';
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ─── Open Snipcart cart modal ───────────────────────────────────────────────

function openCart() {
  if (window.Snipcart) {
    Snipcart.api.theme.cart.open();
  }
}

// ─── addToCart — bridges legacy API to Snipcart ────────────────────────────
/**
 * product = {
 *   id:       string   — unique product slug, e.g. 'church-vinyl-banner'
 *   name:     string   — display name
 *   price:    number   — unit price in USD
 *   qty:      number   — quantity (default 1)
 *   image:    string   — image URL
 *   options:  string   — size/variant description (optional)
 *   url:      string   — product page URL for Snipcart validation (optional)
 * }
 */
function addToCart(product) {
  if (!product || !product.id || !product.name || !product.price) {
    console.error('[Divine Cart] Invalid product data:', product);
    showToast('Could not add item to cart. Please try again.', { type: 'error' });
    return;
  }

  // Build the canonical product page URL for Snipcart's crawler validation
  const productUrl = product.url
    || (window.location.origin + '/products/' + product.id + '.html');

  if (!window.Snipcart) {
    // Snipcart not loaded yet — show a user-friendly error
    showToast('Cart is loading, please try again in a moment.', { type: 'error' });
    return;
  }

  Snipcart.api.cart.items.add({
    id:          product.id,
    name:        product.name,
    price:       parseFloat(product.price),
    quantity:    parseInt(product.qty) || 1,
    image:       product.image  || '',
    description: product.options || '',
    url:         productUrl,
  })
  .then(() => {
    showToast(product.name + ' added to cart!');
    // Open the cart modal so customer sees their item
    Snipcart.api.theme.cart.open();
  })
  .catch((err) => {
    console.error('[Divine Cart] Snipcart add error:', err);
    showToast('Could not add to cart. Please try again.', { type: 'error' });
  });
}

// ─── removeFromCart ─────────────────────────────────────────────────────────

function removeFromCart(id) {
  if (!window.Snipcart) return;
  Snipcart.api.cart.items.remove(id)
    .then(() => showToast('Item removed from cart.'))
    .catch((err) => console.error('[Divine Cart] remove error:', err));
}

// ─── Mobile menu toggle ──────────────────────────────────────────────────────

function toggleMobileMenu() {
  const menu = document.getElementById('mobile-menu');
  if (!menu) return;
  menu.classList.toggle('active');
  document.body.style.overflow = menu.classList.contains('active') ? 'hidden' : '';
}

// ─── Legacy stubs (no-ops for compatibility) ────────────────────────────────
// These were used by cart.html which is now replaced by Snipcart's built-in cart.

function getCart()           { return []; }   // Snipcart manages state
function saveCart()          {}               // no-op
function clearCart()         {}               // no-op
function updateCartCount()   {}               // Snipcart handles .snipcart-items-count
function updateQuantity()    {}               // use Snipcart UI instead
function formatPrice(price)  { return '$' + parseFloat(price).toFixed(2); }

// ─── Init ────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Nothing to init — Snipcart auto-initialises the cart count badge.
  // The `.snipcart-items-count` spans in the header are updated by Snipcart.
});
