/**
 * Divine Printing — Account Auth Client
 *
 * Handles magic-link sign-in flow, session management (localStorage),
 * and authenticated API calls to the account backend.
 *
 * Usage:
 *   <script src="/js/account-auth.js"></script>
 *   <script>
 *     // Set API URL before using (from Terraform output)
 *     DivinePrintingAuth.init('https://xxxxx.execute-api.us-east-1.amazonaws.com');
 *   </script>
 */

(function (root) {
  'use strict';

  var STORAGE_SESSION_KEY  = 'dp_session_token';
  var STORAGE_CUSTOMER_KEY = 'dp_customer';
  var apiBaseUrl = '';

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------

  function init(baseUrl) {
    apiBaseUrl = (baseUrl || '').replace(/\/+$/, '');

    // Check for magic link token in URL
    var urlParams = new URLSearchParams(window.location.search);
    var token = urlParams.get('token');
    if (token) {
      validateToken(token);
    }
  }

  // ---------------------------------------------------------------------------
  // Session management
  // ---------------------------------------------------------------------------

  function getSession() {
    try {
      var token = localStorage.getItem(STORAGE_SESSION_KEY);
      var customer = JSON.parse(localStorage.getItem(STORAGE_CUSTOMER_KEY) || 'null');
      if (token && customer) {
        // Check client-side expiry (token is base64url payload + sig)
        var parts = token.split('.');
        if (parts.length === 2) {
          var payload = JSON.parse(atob(parts[0].replace(/-/g, '+').replace(/_/g, '/')));
          if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) {
            signOut();
            return null;
          }
        }
        return { token: token, customer: customer };
      }
    } catch (e) {
      console.warn('Session parse error:', e);
    }
    return null;
  }

  function isSignedIn() {
    return getSession() !== null;
  }

  function getCustomer() {
    var session = getSession();
    return session ? session.customer : null;
  }

  function signOut() {
    localStorage.removeItem(STORAGE_SESSION_KEY);
    localStorage.removeItem(STORAGE_CUSTOMER_KEY);
  }

  // ---------------------------------------------------------------------------
  // Auth flow
  // ---------------------------------------------------------------------------

  /**
   * Request a magic link email.
   * Returns a promise that resolves with { message } or rejects.
   */
  function sendMagicLink(email) {
    return fetch(apiBaseUrl + '/auth/send-magic-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email }),
    }).then(function (res) {
      return res.json();
    });
  }

  /**
   * Validate a magic-link token (called automatically when ?token= is in URL).
   * On success, stores session + customer in localStorage and reloads page.
   */
  function validateToken(token) {
    fetch(apiBaseUrl + '/auth/validate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: token }),
    })
    .then(function (res) { return res.json(); })
    .then(function (data) {
      if (data.sessionToken && data.customer) {
        localStorage.setItem(STORAGE_SESSION_KEY, data.sessionToken);
        localStorage.setItem(STORAGE_CUSTOMER_KEY, JSON.stringify(data.customer));

        // Clean the URL (remove token param) and reload
        var url = new URL(window.location.href);
        url.searchParams.delete('token');
        window.location.replace(url.pathname + url.search + url.hash);
      } else {
        console.error('Token validation failed:', data);
        showTokenError(data.error || 'Invalid or expired link. Please request a new one.');
      }
    })
    .catch(function (err) {
      console.error('Token validation error:', err);
      showTokenError('Something went wrong. Please try again.');
    });
  }

  function showTokenError(message) {
    // Dispatch a custom event so the page can display the error
    window.dispatchEvent(new CustomEvent('dp-auth-error', { detail: { message: message } }));
  }

  // ---------------------------------------------------------------------------
  // Authenticated API calls
  // ---------------------------------------------------------------------------

  function authFetch(path, options) {
    var session = getSession();
    if (!session) {
      return Promise.reject(new Error('Not signed in'));
    }

    options = options || {};
    options.headers = options.headers || {};
    options.headers['Authorization'] = 'Bearer ' + session.token;

    return fetch(apiBaseUrl + path, options).then(function (res) {
      if (res.status === 401) {
        // Session expired
        signOut();
        window.location.reload();
        return Promise.reject(new Error('Session expired'));
      }
      return res.json();
    });
  }

  function fetchOrders() {
    return authFetch('/account/orders');
  }

  function fetchProfile() {
    return authFetch('/account/profile');
  }

  // ---------------------------------------------------------------------------
  // Export
  // ---------------------------------------------------------------------------

  root.DivinePrintingAuth = {
    init:           init,
    getSession:     getSession,
    isSignedIn:     isSignedIn,
    getCustomer:    getCustomer,
    signOut:        signOut,
    sendMagicLink:  sendMagicLink,
    fetchOrders:    fetchOrders,
    fetchProfile:   fetchProfile,
  };

})(window);
