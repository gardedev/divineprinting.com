/** Divine Printing admin login lifecycle (Task 4.5). */
'use strict';

const ADMIN_REQUIRED = 'ADMIN_REQUIRED';

function accessTokenHasAdminGroup(accessToken) {
  const claims = decodeJwtPayload(accessToken);
  return !!claims && Array.isArray(claims['cognito:groups']) &&
    claims['cognito:groups'].includes('admin');
}

function showAdminError(code) {
  const errorElement = document.getElementById('adminAuthError');
  if (errorElement) {
    errorElement.textContent = code === ADMIN_REQUIRED
      ? 'Administrator access is required.'
      : 'Unable to authenticate. Please try again.';
    errorElement.hidden = false;
  }
}

async function validateAdminSession() {
  const response = await authenticatedFetch('/api/admin/session');
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    return { success: false, code: body.code || 'AUTH_INVALID_TOKEN' };
  }
  return { success: true, data: await response.json() };
}

async function initAdminAuth() {
  const code = parseCodeFromUrl();

  if (code) {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens) {
      clearAllAuthState();
      showAdminError('TOKEN_EXCHANGE_FAILED');
      return false;
    }

    // Frontend group inspection is a UX gate only. The backend session probe
    // below is the authoritative signature and admin-group validation.
    if (!accessTokenHasAdminGroup(tokens.accessToken)) {
      clearAllAuthState();
      showAdminError(ADMIN_REQUIRED);
      return false;
    }

    storeSessionTokens(tokens.accessToken, tokens.idToken);
    if (tokens.refreshToken) storeRefreshToken(tokens.refreshToken);
  }

  const accessToken = await ensureFreshAccessToken();
  if (!accessToken) {
    // Retryable refresh-network failures retain only the tab-scoped refresh
    // credential. Invalid/expired refresh credentials were already cleared.
    if (!getRefreshToken()) clearAllAuthState();
    showAdminError('AUTH_INVALID_TOKEN');
    return false;
  }
  if (!accessTokenHasAdminGroup(accessToken)) {
    clearAllAuthState();
    showAdminError(ADMIN_REQUIRED);
    return false;
  }

  try {
    const result = await validateAdminSession();
    if (!result.success) {
      clearAllAuthState();
      showAdminError(result.code === ADMIN_REQUIRED ? ADMIN_REQUIRED : 'AUTH_INVALID_TOKEN');
      return false;
    }
    return true;
  } catch (error) {
    if (!error || error.code !== 'REFRESH_NETWORK_ERROR') clearAllAuthState();
    showAdminError('AUTH_INVALID_TOKEN');
    return false;
  }
}

async function startAdminLogin() {
  clearAllAuthState();
  return login();
}

function adminLogout() {
  logout();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    ADMIN_REQUIRED,
    accessTokenHasAdminGroup,
    validateAdminSession,
    initAdminAuth,
    startAdminLogin,
    adminLogout,
  };
}
