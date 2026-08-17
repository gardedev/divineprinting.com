/**
 * account-auth.js — Divine Printing Account Auth Client (Task 4.4)
 *
 * LEGACY NOTICE: This file previously implemented a magic-link sign-in flow
 * and localStorage-based session management. Both have been REMOVED as they
 * are architecturally incompatible with the approved Cognito Hosted UI + PKCE
 * authentication architecture.
 *
 * Removed features:
 *   - Magic-link email sending (POST /auth/send-magic-link)
 *   - Magic-link token validation (POST /auth/validate)
 *   - localStorage session token storage (dp_session_token, dp_customer)
 *   - DivinePrintingAuth.init() token-in-URL handler
 *
 * The canonical authentication flow is now:
 *   1. User clicks "Sign In" → Redirected to Cognito Hosted UI (cognito-auth.js)
 *   2. Cognito redirects back with authorization code (PKCE)
 *   3. cognito-auth.js exchanges code for tokens (Access, ID, Refresh)
 *   4. Access Token is stored in sessionStorage (never localStorage)
 *   5. ID Token is used ONLY for display info on the frontend
 *   6. Refresh Token remains frontend-to-Cognito in sessionStorage only
 *   7. cognito-auth.js calls POST /api/customers/bootstrap automatically
 *
 * Retained for compatibility:
 *   - DivinePrintingAuth.isSignedIn() → delegates to cognito-auth.js getCurrentUser()
 *   - DivinePrintingAuth.signOut()    → delegates to cognito-auth.js logout()
 *   - DivinePrintingAuth.getCustomer() → delegates to cognito-auth.js getCurrentUser()
 *
 * Pages that previously called DivinePrintingAuth.init() should instead
 * ensure cognito-auth.js is loaded; it auto-initializes on DOMContentLoaded.
 */

'use strict';

(function (root) {

  // -------------------------------------------------------------------------
  // Public API (compatibility shim — delegates to cognito-auth.js)
  // -------------------------------------------------------------------------

  /**
   * init() is now a no-op. Authentication is initialized automatically by
   * cognito-auth.js on DOMContentLoaded.
   *
   * Previously: accepted a base URL and handled magic-link ?token= params.
   * Now: REMOVED — magic-link flow is disabled per approved architecture.
   *
   * @deprecated No-op. Kept for backward compatibility of callers.
   */
  function init() {
    // No-op. cognito-auth.js handles initialization automatically.
    // Magic-link ?token= handling has been permanently removed.
  }

  /**
   * Returns whether the user is currently signed in.
   * Delegates to cognito-auth.js getCurrentUser() (sessionStorage/in-memory check).
   *
   * @returns {boolean}
   */
  function isSignedIn() {
    if (typeof getCurrentUser === 'function') {
      return getCurrentUser() !== null;
    }
    // Fallback: check sessionStorage directly if cognito-auth.js is not loaded
    try {
      return !!sessionStorage.getItem('dp_access_token');
    } catch (_e) {
      return false;
    }
  }

  /**
   * Returns the current user object (from ID Token — display purposes only).
   * Delegates to cognito-auth.js getCurrentUser().
   *
   * @returns {{email: string, name: string, sub: string, emailVerified: boolean}|null}
   */
  function getCustomer() {
    if (typeof getCurrentUser === 'function') {
      return getCurrentUser();
    }
    return null;
  }

  /**
   * Signs the user out. Delegates to cognito-auth.js logout().
   * Clears sessionStorage, in-memory tokens, and redirects to Cognito logout.
   */
  function signOut() {
    if (typeof logout === 'function') {
      logout();
      return;
    }
    // Fallback if cognito-auth.js is not loaded
    try {
      sessionStorage.removeItem('dp_access_token');
      sessionStorage.removeItem('dp_id_token');
      sessionStorage.removeItem('dp_refresh_token');
      // Clean up any legacy localStorage tokens
      localStorage.removeItem('dp_token');
      localStorage.removeItem('dp_customer');
      localStorage.removeItem('dp_session_token');
      localStorage.removeItem('dp_access_token');
      localStorage.removeItem('dp_id_token');
      localStorage.removeItem('dp_refresh_token');
    } catch (_e) {
      // Storage unavailable
    }
    window.location.reload();
  }

  // -------------------------------------------------------------------------
  // Explicitly removed functions (throw safe errors if accidentally called)
  // -------------------------------------------------------------------------

  /**
   * @deprecated REMOVED. Magic-link flow is incompatible with Cognito PKCE architecture.
   * @throws {Error}
   */
  function sendMagicLink() {
    throw new Error(
      'sendMagicLink has been removed. Use the Cognito Hosted UI login flow (cognito-auth.js).'
    );
  }

  /**
   * @deprecated REMOVED. Legacy backend session fetch is removed.
   * @throws {Error}
   */
  function fetchOrders() {
    throw new Error(
      'fetchOrders on DivinePrintingAuth has been removed. ' +
      'Use authenticatedFetch from cognito-auth.js instead.'
    );
  }

  /**
   * @deprecated REMOVED. Legacy backend profile fetch is removed.
   * @throws {Error}
   */
  function fetchProfile() {
    throw new Error(
      'fetchProfile on DivinePrintingAuth has been removed. ' +
      'Profile data is derived from the Cognito ID Token via getCurrentUser().'
    );
  }

  // -------------------------------------------------------------------------
  // Export
  // -------------------------------------------------------------------------

  root.DivinePrintingAuth = {
    init,
    isSignedIn,
    getCustomer,
    signOut,
    // Removed functions (kept as stubs for safe failure)
    sendMagicLink,
    fetchOrders,
    fetchProfile,
  };

})(typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this));

// ---------------------------------------------------------------------------
// Exports (for testing)
// ---------------------------------------------------------------------------

if (typeof module !== 'undefined' && module.exports) {
  // Re-export the DivinePrintingAuth object for Node.js test access
  module.exports = {
    DivinePrintingAuth: (typeof window !== 'undefined' ? window.DivinePrintingAuth : null),
  };
}
