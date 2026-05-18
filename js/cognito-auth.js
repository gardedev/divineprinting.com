// Divine Printing Cognito Authentication
const COGNITO_DOMAIN = 'https://login.divineprinting.com';
const CLIENT_ID = '73v7c7cbc0c0mm08kfdfv4casj';
const REDIRECT_URI = window.location.origin + '/account/account.html';
const API_BASE = 'https://u7klzkkpbc.execute-api.us-east-1.amazonaws.com';

// PKCE Helper functions
function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// Exchange authorization code for tokens
async function exchangeCodeForTokens(code) {
  const verifier = sessionStorage.getItem('pkce_verifier');
  sessionStorage.removeItem('pkce_verifier');
  
  const tokenUrl = `${COGNITO_DOMAIN}/oauth2/token`;
  const params = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    code: code,
    redirect_uri: REDIRECT_URI,
    code_verifier: verifier
  });

  try {
    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    if (!response.ok) {
      throw new Error('Token exchange failed');
    }

    const tokens = await response.json();
    localStorage.setItem('dp_access_token', tokens.access_token);
    localStorage.setItem('dp_id_token', tokens.id_token);
    localStorage.setItem('dp_refresh_token', tokens.refresh_token);
    return tokens;
  } catch (error) {
    console.error('Error exchanging code for tokens:', error);
    return null;
  }
}

// Parse authorization code from URL
function parseCodeFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  
  if (code) {
    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
    return code;
  }
  return null;
}

// Get stored token
function getToken() {
  return localStorage.getItem('dp_id_token');
}

// Decode JWT to get user info
function decodeToken(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => {
      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
    return JSON.parse(jsonPayload);
  } catch (e) {
    return null;
  }
}

// Get current user from token
function getCurrentUser() {
  const token = getToken();
  if (!token) return null;
  
  const decoded = decodeToken(token);
  if (!decoded) return null;
  
  // Check if token is expired
  if (decoded.exp * 1000 < Date.now()) {
    logout();
    return null;
  }
  
  return {
    email: decoded.email,
    name: decoded.name || decoded.email,
    sub: decoded.sub
  };
}

// Redirect to Cognito hosted UI for login
async function login() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem('pkce_verifier', verifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'email openid profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  window.location.href = `${COGNITO_DOMAIN}/login?${params}`;
}

// Redirect to Cognito hosted UI for signup
async function signup() {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  sessionStorage.setItem('pkce_verifier', verifier);

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'email openid profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  const fullUrl = `${COGNITO_DOMAIN}/signup?${params}`;
  console.log('Signup URL:', fullUrl);
  window.location.href = fullUrl;
}

// Logout
function logout() {
  localStorage.removeItem('dp_id_token');
  localStorage.removeItem('dp_access_token');
  localStorage.removeItem('dp_refresh_token');
  const logoutUrl = `${COGNITO_DOMAIN}/logout?client_id=${CLIENT_ID}&logout_uri=${encodeURIComponent(REDIRECT_URI)}`;
  window.location.href = logoutUrl;
}

// Fetch orders from API
async function fetchOrders() {
  const token = getToken();
  if (!token) return { orders: [], count: 0 };
  
  try {
    const response = await fetch(`${API_BASE}/orders`, {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch orders');
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching orders:', error);
    return { orders: [], count: 0 };
  }
}

// Initialize auth on page load
async function initAuth() {
  // Check for authorization code in URL (Cognito redirect)
  const code = parseCodeFromUrl();
  
  if (code) {
    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code);
    if (tokens) {
      showDashboard(getCurrentUser());
      return;
    }
  }
  
  // Check if user is already logged in
  const user = getCurrentUser();
  
  if (user) {
    showDashboard(user);
  } else {
    showLoginPrompt();
  }
}

// UI functions
function showDashboard(user) {
  const loggedOutContent = document.getElementById('loggedOutContent');
  const loggedInContent = document.getElementById('loggedInContent');
  const logoutBtn = document.getElementById('logoutBtn');
  
  if (loggedOutContent) loggedOutContent.style.display = 'none';
  if (loggedInContent) loggedInContent.style.display = 'block';
  if (logoutBtn) logoutBtn.style.display = '';
  
  // Update user name
  const customerNameEl = document.getElementById('customerName');
  if (customerNameEl) customerNameEl.textContent = user.name || user.email;
  
  // Load orders
  loadOrders();
  
  // Load saved designs count
  const savedDesigns = JSON.parse(localStorage.getItem('divinePrinting_savedDesigns') || '[]');
  const savedDesignsEl = document.getElementById('savedDesigns');
  if (savedDesignsEl) savedDesignsEl.textContent = savedDesigns.length;
}

function showLoginPrompt() {
  const loggedOutContent = document.getElementById('loggedOutContent');
  const loggedInContent = document.getElementById('loggedInContent');
  const logoutBtn = document.getElementById('logoutBtn');
  
  if (loggedOutContent) loggedOutContent.style.display = 'block';
  if (loggedInContent) loggedInContent.style.display = 'none';
  if (logoutBtn) logoutBtn.style.display = 'none';
}

async function loadOrders() {
  const ordersListEl = document.getElementById('recentOrdersList');
  if (!ordersListEl) return;
  
  ordersListEl.innerHTML = '<p>Loading orders...</p>';
  
  try {
    const data = await fetchOrders();
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
      
      // Update stats
      const totalOrdersEl = document.getElementById('totalOrders');
      const totalSpentEl = document.getElementById('totalSpent');
      if (totalOrdersEl) totalOrdersEl.textContent = data.count;
      if (totalSpentEl) {
        const total = data.orders.reduce((sum, o) => sum + o.total, 0);
        totalSpentEl.textContent = '$' + total.toFixed(2);
      }
    } else {
      ordersListEl.innerHTML = '<p>No orders yet.</p>';
    }
  } catch (error) {
    ordersListEl.innerHTML = '<p>Error loading orders.</p>';
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  
  // Login button
  const loginBtn = document.getElementById('loginBtn');
  if (loginBtn) loginBtn.addEventListener('click', () => login());
  
  // Signup button
  const signupBtn = document.getElementById('signupBtn');
  if (signupBtn) signupBtn.addEventListener('click', () => signup());
  
  // Logout button
  const logoutBtn = document.getElementById('logoutBtn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
});
