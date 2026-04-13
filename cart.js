// Divine Printing Cart System

function getCart() {
  return JSON.parse(localStorage.getItem('divineCart') || '[]');
}

function saveCart(cart) {
  localStorage.setItem('divineCart', JSON.stringify(cart));
  updateCartCount();
}

function updateCartCount() {
  const cart = getCart();
  const count = cart.reduce((sum, item) => sum + (item.qty || 1), 0);
  const badges = document.querySelectorAll('#cart-count');
  badges.forEach(badge => {
    badge.textContent = count;
    badge.style.display = count > 0 ? 'flex' : 'none';
  });
}

function showToast(message) {
  // Remove any existing toast
  const existingToast = document.getElementById('toast');
  if (existingToast) {
    existingToast.remove();
  }
  
  // Create new toast
  const toast = document.createElement('div');
  toast.id = 'toast';
  toast.className = 'toast';
  toast.innerHTML = `
    <div style="display:flex;align-items:center;gap:12px;">
      <span style="font-size:1.5rem;">✓</span>
      <div>
        <div style="font-weight:600;">${message}</div>
        <div style="font-size:0.85rem;opacity:0.9;margin-top:4px;">
          <a href="/cart.html" style="color:#fff;text-decoration:underline;">View Cart</a> or 
          <a href="/#products" style="color:#fff;text-decoration:underline;">Continue Shopping</a>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(toast);
  
  // Show with animation
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });
  
  // Auto hide after 5 seconds
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 5000);
}

function addToCart(product) {
  console.log('Adding to cart:', product);
  if (!product || !product.id) {
    console.error('Invalid product data:', product);
    showToast('Error: Could not add to cart');
    return;
  }
  
  const cart = getCart();
  const existing = cart.find(item => item.id === product.id);
  
  if (existing) {
    existing.qty += product.qty || 1;
  } else {
    cart.push({
      id: product.id,
      name: product.name,
      price: product.price,
      qty: product.qty || 1,
      image: product.image || 'images/logo-icon.png',
      options: product.options || ''
    });
  }
  
  saveCart(cart);
  showToast(product.name + ' added to cart!');
  console.log('Cart updated:', cart);
}

function removeFromCart(id) {
  let cart = getCart();
  cart = cart.filter(item => item.id !== id);
  saveCart(cart);
  showToast('Item removed from cart');
}

function updateQuantity(id, qty) {
  const cart = getCart();
  const item = cart.find(i => i.id === id);
  if (item) {
    item.qty = Math.max(1, qty);
    saveCart(cart);
  }
}

function clearCart() {
  localStorage.removeItem('divineCart');
  updateCartCount();
}

function formatPrice(price) {
  return '$' + parseFloat(price).toFixed(2);
}

// Mobile menu toggle
function toggleMobileMenu() {
  const menu = document.getElementById('mobile-menu');
  if (menu) {
    menu.classList.toggle('active');
    document.body.style.overflow = menu.classList.contains('active') ? 'hidden' : '';
  }
}

// Initialize cart count on page load
document.addEventListener('DOMContentLoaded', updateCartCount);
