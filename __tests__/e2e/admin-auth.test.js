'use strict';

const session = {};
global.sessionStorage = {
  getItem: jest.fn(key => session[key] ?? null),
  setItem: jest.fn((key, value) => { session[key] = String(value); }),
  removeItem: jest.fn(key => { delete session[key]; }),
};
global.document = { getElementById: jest.fn(() => null) };

function jwt(payload) {
  return `e30.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.sig`;
}

let adminAuth;
let stored;

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  Object.keys(session).forEach(key => delete session[key]);
  stored = {};
  global.decodeJwtPayload = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
  global.parseCodeFromUrl = jest.fn(() => null);
  global.exchangeCodeForTokens = jest.fn();
  global.storeSessionTokens = jest.fn((accessToken, idToken) => {
    stored.accessToken = accessToken;
    stored.idToken = idToken;
    session.dp_access_token = accessToken;
    session.dp_id_token = idToken;
  });
  global.storeRefreshToken = jest.fn(token => {
    stored.refreshToken = token;
    session.dp_refresh_token = token;
  });
  global.getAccessToken = jest.fn(() => session.dp_access_token || null);
  global.clearAllAuthState = jest.fn(() => {
    Object.keys(session).forEach(key => delete session[key]);
    stored = {};
  });
  global.authenticatedFetch = jest.fn();
  global.login = jest.fn();
  global.logout = jest.fn();
  adminAuth = require('../../js/admin-auth');
});

describe('Task 4.5 admin frontend auth', () => {
  test.each([
    [['admin'], true],
    [['customer', 'admin'], true],
    [['customer'], false],
    [['system'], false],
    [undefined, false],
    ['admin', false],
  ])('admin group check for %j is %s', (groups, expected) => {
    expect(adminAuth.accessTokenHasAdminGroup(jwt({ 'cognito:groups': groups }))).toBe(expected);
  });

  it('completes a valid callback and verifies access token with backend', async () => {
    global.parseCodeFromUrl.mockReturnValue('code');
    global.exchangeCodeForTokens.mockResolvedValue({
      accessToken: jwt({ 'cognito:groups': ['admin'] }),
      idToken: jwt({ email: 'admin@example.com' }),
      refreshToken: 'refresh-token',
    });
    global.authenticatedFetch.mockResolvedValue({
      ok: true, json: async () => ({ authenticated: true }),
    });

    await expect(adminAuth.initAdminAuth()).resolves.toBe(true);
    expect(global.authenticatedFetch).toHaveBeenCalledWith('/api/admin/session');
    expect(global.storeSessionTokens).toHaveBeenCalled();
    expect(global.storeRefreshToken).toHaveBeenCalledWith('refresh-token');
  });

  it('clears all state and never calls backend for a non-admin callback', async () => {
    global.parseCodeFromUrl.mockReturnValue('code');
    global.exchangeCodeForTokens.mockResolvedValue({
      accessToken: jwt({ 'cognito:groups': ['customer'] }),
      idToken: jwt({}), refreshToken: 'secret-refresh-token',
    });
    expect(await adminAuth.initAdminAuth()).toBe(false);
    expect(global.clearAllAuthState).toHaveBeenCalled();
    expect(global.authenticatedFetch).not.toHaveBeenCalled();
    expect(global.storeSessionTokens).not.toHaveBeenCalled();
    expect(global.storeRefreshToken).not.toHaveBeenCalled();
  });

  it('clears stored tokens when authoritative backend returns ADMIN_REQUIRED', async () => {
    session.dp_access_token = jwt({ 'cognito:groups': ['admin'] });
    session.dp_id_token = 'id-token';
    session.dp_refresh_token = 'refresh-token';
    global.authenticatedFetch.mockResolvedValue({
      ok: false, json: async () => ({ code: 'ADMIN_REQUIRED' }),
    });
    expect(await adminAuth.initAdminAuth()).toBe(false);
    expect(global.clearAllAuthState).toHaveBeenCalled();
    expect(session.dp_refresh_token).toBeUndefined();
  });

  it('uses shared login after clearing any customer/admin session', async () => {
    await adminAuth.startAdminLogin();
    expect(global.clearAllAuthState).toHaveBeenCalled();
    expect(global.login).toHaveBeenCalled();
  });

  it('delegates logout to shared cleanup/logout implementation', () => {
    adminAuth.adminLogout();
    expect(global.logout).toHaveBeenCalled();
  });

  it('does not contain bootstrap calls or direct refresh-token network handling', () => {
    const fs = require('fs');
    const source = fs.readFileSync(require.resolve('../../js/admin-auth'), 'utf8');
    expect(source).not.toContain('callBootstrap');
    expect(source).not.toContain('/api/customers/bootstrap');
    expect(source).not.toContain('/oauth2/token');
  });

  it('gates both admin landing pages through the shared admin verifier', () => {
    const fs = require('fs');
    const path = require('path');
    for (const page of ['index.html', 'designs.html']) {
      const html = fs.readFileSync(path.join(__dirname, '../../admin', page), 'utf8');
      expect(html).toContain('../js/cognito-auth.js');
      expect(html).toContain('../js/admin-auth.js');
      expect(html).toContain('initAdminAuth()');
    }
  });
});
