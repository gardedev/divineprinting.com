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

const ACCOUNT_API_BASE = 'https://u7klzkkpbc.execute-api.us-east-1.amazonaws.com';

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
async function getOrders(fetchFn) {
  // Use injected fetch function (for testing) or the global authenticatedFetch
  const fetcher = fetchFn || (typeof authenticatedFetch !== 'undefined' ? authenticatedFetch : null);

  if (!fetcher) {
    console.warn('[account-api] authenticatedFetch not available. Load cognito-auth.js first.');
    return { orders: [], count: 0 };
  }

  try {
    const response = await fetcher('/api/orders');
    if (!response.ok) {
      return { orders: [], count: 0 };
    }
    return await response.json();
  } catch (_error) {
    return { orders: [], count: 0 };
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
