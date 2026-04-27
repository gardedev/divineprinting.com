// Divine Printing Custom Account API Client
const API_BASE = 'https://8773j5evpi.execute-api.us-east-2.amazonaws.com';

// Auth functions
async function register(email, password, name) {
  const response = await fetch(`${API_BASE}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, name }),
  });
  return response.json();
}

async function login(email, password) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (data.success) {
    localStorage.setItem('dp_token', data.token);
    localStorage.setItem('dp_customer', JSON.stringify(data.customer));
  }
  return data;
}

async function verifyToken(token) {
  const response = await fetch(`${API_BASE}/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
  });
  return response.json();
}

function logout() {
  localStorage.removeItem('dp_token');
  localStorage.removeItem('dp_customer');
  window.location.reload();
}

function getToken() {
  return localStorage.getItem('dp_token');
}

function getCustomer() {
  const customer = localStorage.getItem('dp_customer');
  return customer ? JSON.parse(customer) : null;
}

// Orders functions
async function getOrders(email) {
  const response = await fetch(`${API_BASE}/orders?email=${encodeURIComponent(email)}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  return response.json();
}

// Check auth status on page load
async function checkAuth() {
  const token = getToken();
  if (!token) {
    showLoginForm();
    return false;
  }
  
  const result = await verifyToken(token);
  if (result.valid) {
    showDashboard(result.customer);
    return true;
  } else {
    logout();
    return false;
  }
}

// UI functions
function showLoginForm() {
  const loggedOutContent = document.getElementById('loggedOutContent');
  const loggedInContent = document.getElementById('loggedInContent');
  if (loggedOutContent) loggedOutContent.style.display = 'block';
  if (loggedInContent) loggedInContent.style.display = 'none';
}

function showDashboard(customer) {
  const loggedOutContent = document.getElementById('loggedOutContent');
  const loggedInContent = document.getElementById('loggedInContent');
  if (loggedOutContent) loggedOutContent.style.display = 'none';
  if (loggedInContent) loggedInContent.style.display = 'block';
  
  // Update customer name
  const customerNameEl = document.getElementById('customerName');
  if (customerNameEl && customer) {
    customerNameEl.textContent = customer.name || customer.email;
  }
  
  // Load orders
  loadOrders(customer.email);
}

async function loadOrders(email) {
  const ordersListEl = document.getElementById('recentOrdersList');
  if (!ordersListEl) return;
  
  ordersListEl.innerHTML = '<p>Loading orders...</p>';
  
  try {
    const data = await getOrders(email);
    if (data.orders && data.orders.length > 0) {
      ordersListEl.innerHTML = data.orders.map(order => `
        <div class="order-card">
          <div class="order-header">
            <span class="order-id">Order #${order.invoiceNumber || order.orderId.slice(0, 8)}</span>
            <span class="order-status ${order.status}">${order.status}</span>
          </div>
          <div class="order-date">${new Date(order.createdAt).toLocaleDateString()}</div>
          <div class="order-items">${order.items.length} item(s)</div>
          <div class="order-total">$${order.total.toFixed(2)}</div>
        </div>
      `).join('');
    } else {
      ordersListEl.innerHTML = '<p>No orders yet.</p>';
    }
  } catch (error) {
    ordersListEl.innerHTML = '<p>Error loading orders.</p>';
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
  
  // Login form handler
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('loginEmail').value;
      const password = document.getElementById('loginPassword').value;
      const errorEl = document.getElementById('loginError');
      
      try {
        const result = await login(email, password);
        if (result.success) {
          window.location.reload();
        } else {
          errorEl.textContent = result.error || 'Login failed';
          errorEl.classList.add('visible');
        }
      } catch (error) {
        errorEl.textContent = 'Network error. Please try again.';
        errorEl.classList.add('visible');
      }
    });
  }
  
  // Register form handler
  const registerForm = document.getElementById('registerForm');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('registerEmail').value;
      const password = document.getElementById('registerPassword').value;
      const name = document.getElementById('registerName').value;
      const errorEl = document.getElementById('registerError');
      
      try {
        const result = await register(email, password, name);
        if (result.success) {
          // Auto-login after register
          await login(email, password);
          window.location.reload();
        } else {
          errorEl.textContent = result.error || 'Registration failed';
          errorEl.classList.add('visible');
        }
      } catch (error) {
        errorEl.textContent = 'Network error. Please try again.';
        errorEl.classList.add('visible');
      }
    });
  }
  
  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', logout);
  }
  
  // Tab switching
  const showRegisterLink = document.getElementById('showRegister');
  const showLoginLink = document.getElementById('showLogin');
  const loginTab = document.getElementById('loginTab');
  const registerTab = document.getElementById('registerTab');
  
  if (showRegisterLink) {
    showRegisterLink.addEventListener('click', (e) => {
      e.preventDefault();
      loginTab.style.display = 'none';
      registerTab.style.display = 'block';
    });
  }
  
  if (showLoginLink) {
    showLoginLink.addEventListener('click', (e) => {
      e.preventDefault();
      registerTab.style.display = 'none';
      loginTab.style.display = 'block';
    });
  }
  
  // Global tab switching function for onclick handlers
  window.showTab = function(tabName) {
    const loginTab = document.getElementById('loginTab');
    const registerTab = document.getElementById('registerTab');
    const loginTabBtn = document.getElementById('loginTabBtn');
    const registerTabBtn = document.getElementById('registerTabBtn');
    
    if (tabName === 'login') {
      loginTab.style.display = 'block';
      registerTab.style.display = 'none';
      loginTabBtn.classList.add('active');
      registerTabBtn.classList.remove('active');
    } else {
      loginTab.style.display = 'none';
      registerTab.style.display = 'block';
      loginTabBtn.classList.remove('active');
      registerTabBtn.classList.add('active');
    }
  };
});
