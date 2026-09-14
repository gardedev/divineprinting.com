/**
 * account-api.js — Divine Printing Account API Client (Task 4.4)
 *
 * LEGACY NOTICE: The direct username/password login and register functions
 * previously in this file (login, register, verifyToken) have been REMOVED.
 *
 * The canonical authentication flow is Cognito Hosted UI + PKCE, implemented
 * in /js/cognito-auth.js. All protected API calls use the Access Token obtained
 * from that flow via Authorization: Bearer headers.
 *
 * Remaining functions:
 *   - getOrders: Fetches orders. Authentication is handled by cognito-auth.js.
 *   - Utility: getDomElement helpers for the account page UI.
 *
 * Deprecated and removed endpoints:
 *   - POST /auth/login    → REMOVED (was password-based; backend also disabled)
 *   - POST /auth/register → REMOVED (was password-based; backend returns 404 ENDPOINT_REMOVED)
 *   - POST /auth/verify   → REMOVED (was legacy session token validation)
 *   - POST /auth/send-magic-link → REMOVED (magic-link flow incompatible with PKCE architecture)
 */

'use strict';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ACCOUNT_API_BASE = 'https://cad1wdj8c8.execute-api.us-east-1.amazonaws.com';

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/**
 * Fetches the current user's orders.
 * Authentication (Authorization: Bearer <access_token>) is handled by
 * cognito-auth.js via authenticatedFetch — do not re-implement here.
 *
 * @param {Function} [fetchFn] - Optional fetch function override for testing.
 *                               Defaults to the global authenticatedFetch from cognito-auth.js.
 * @returns {Promise<{orders: Array, count: number}>}
 */
async function getOrders(fetchFn, cursor) {
  // Use injected fetch function (for testing) or the global authenticatedFetch
  const fetcher = fetchFn || (typeof authenticatedOrderFetch !== 'undefined' ? authenticatedOrderFetch : null);

  if (!fetcher) {
    console.warn('[account-api] authenticatedFetch not available. Load cognito-auth.js first.');
    throw new Error('Unable to load order history');
  }

  try {
    const path = '/api/orders' + (cursor ? '?cursor=' + encodeURIComponent(cursor) : '');
    const response = await fetcher(path);
    if (!response.ok) {
      if ((response.status === 401 || response.status === 403) && typeof clearAllAuthState === 'function') {
        clearAllAuthState();
      }
      throw new Error('Unable to load order history');
    }
    const data = await response.json();
    if (!data || !Array.isArray(data.orders)) throw new Error('Unable to load order history');
    return data;
  } catch (_error) {
    throw new Error('Unable to load order history');
  }
}

// ---------------------------------------------------------------------------
// Exports (for testing)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    getOrders,
    ACCOUNT_API_BASE,
  };
}
