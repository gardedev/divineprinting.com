(function (global) {
  'use strict';

  const STORAGE_KEY = 'dp_anonymous_cart_v1';
  const CLAIM_STORAGE_KEY = 'dp_cart_claim_v1';
  const API_BASE = global.DIVINE_CART_API_BASE || 'https://i3w6x21dzg.execute-api.us-east-1.amazonaws.com';
  const RETRYABLE = new Set([502, 503, 504]);

  function readSession() {
    try {
      const value = JSON.parse(global.sessionStorage.getItem(STORAGE_KEY) || 'null');
      return value && typeof value.cartId === 'string' && typeof value.cartToken === 'string' ? value : null;
    } catch (_) { return null; }
  }

  function writeSession(state) {
    global.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ cartId: state.cart.cartId, cartToken: state.cartToken }));
  }

  function mutationId() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') return global.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function authenticatedMode() {
    return typeof global.getAccessToken === 'function' && Boolean(global.getAccessToken());
  }

  async function request(path, options, retry = true, authenticated = false) {
    try {
      const response = authenticated
        ? await global.authenticatedCartFetch(path, options)
        : await global.fetch(`${API_BASE}${path}`, options);
      if (retry && RETRYABLE.has(response.status)) return request(path, options, false, authenticated);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body.error || 'The cart request could not be completed.');
        error.code = body.code || 'CART_API_FAILED';
        error.status = response.status;
        throw error;
      }
      return body;
    } catch (error) {
      if (retry && !error.status) return request(path, options, false, authenticated);
      throw error;
    }
  }

  async function createAnonymousCart() {
    const body = await request('/api/carts/anonymous', { method: 'POST', headers: { Accept: 'application/json' } });
    const state = { cart: body.cart, items: body.items || [], cartToken: body.cartToken };
    writeSession(state);
    return state;
  }

  async function loadAnonymousCart(createIfMissing) {
    const saved = readSession();
    if (!saved) return createIfMissing ? createAnonymousCart() : null;
    try {
      const body = await request(`/api/carts/anonymous/${encodeURIComponent(saved.cartId)}`, {
        headers: { Accept: 'application/json', 'X-Cart-Token': saved.cartToken },
      });
      return { cart: body.cart, items: body.items || [], cartToken: saved.cartToken };
    } catch (error) {
      if (error.code === 'CART_TOKEN_INVALID' || error.code === 'CART_EXPIRED') global.sessionStorage.removeItem(STORAGE_KEY);
      throw error;
    }
  }

  async function loadCustomerCart() {
    if (typeof global.authenticatedCartFetch !== 'function') throw new Error('Authenticated cart support is unavailable.');
    const body = await request('/api/carts/current', { headers: { Accept: 'application/json' } }, true, true);
    return { mode: 'customer', cart: body.cart, items: body.items || [] };
  }

  async function loadCurrentCart(createIfMissing) {
    return authenticatedMode() ? loadCustomerCart() : loadAnonymousCart(createIfMissing);
  }

  async function mutate(method, itemPath, payload, expectedCartVersion, expectedItemVersion, idempotencyKey) {
    const state = await loadCurrentCart(true);
    const customer = state.mode === 'customer';
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey || mutationId(),
      'If-Match': String(expectedCartVersion || state.cart.version),
      ...(customer ? {} : { 'X-Cart-Token': state.cartToken }),
    };
    if (expectedItemVersion) headers['X-Cart-Item-Version'] = String(expectedItemVersion);
    const path = customer
      ? `/api/carts/current/items${itemPath || ''}`
      : `/api/carts/anonymous/${encodeURIComponent(state.cart.cartId)}/items${itemPath || ''}`;
    const body = await request(path, {
      method, headers, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    }, true, customer);
    return customer
      ? { mode: 'customer', cart: body.cart, items: body.items || [] }
      : { cart: body.cart, items: body.items || [], cartToken: state.cartToken };
  }

  async function addConfiguredJob(job, idempotencyKey) {
    return mutate('POST', '', { itemType: 'CONFIGURED_JOB', ...job }, undefined, undefined, idempotencyKey);
  }

  async function updateConfiguredJob(item, changes, expectedCartVersion, idempotencyKey) {
    try {
      return await mutate('PATCH', `/${encodeURIComponent(item.cartItemId)}`, { itemType: 'CONFIGURED_JOB', ...changes }, expectedCartVersion, item.version, idempotencyKey);
    } catch (error) {
      if (error.code === 'CART_VERSION_CONFLICT') await loadCurrentCart(false);
      throw error;
    }
  }

  async function removeItem(item, expectedCartVersion, idempotencyKey) {
    try {
      return await mutate('DELETE', `/${encodeURIComponent(item.cartItemId)}`, undefined, expectedCartVersion, item.version, idempotencyKey);
    } catch (error) {
      if (error.code === 'CART_VERSION_CONFLICT') await loadCurrentCart(false);
      throw error;
    }
  }

  function readClaim() {
    try {
      const value = JSON.parse(global.sessionStorage.getItem(CLAIM_STORAGE_KEY) || 'null');
      return value && typeof value.mutationId === 'string' ? value : null;
    } catch (_) { return null; }
  }

  function writeClaim(value) {
    global.sessionStorage.setItem(CLAIM_STORAGE_KEY, JSON.stringify(value));
  }

  function clearAnonymousAfterClaim() {
    global.sessionStorage.removeItem(STORAGE_KEY);
    global.sessionStorage.removeItem(CLAIM_STORAGE_KEY);
  }

  async function claimPreservedAnonymousCart() {
    const saved = readSession();
    if (!saved || !authenticatedMode() || typeof global.authenticatedCartFetch !== 'function') return null;
    let claim = readClaim();
    try {
      if (!claim || claim.anonymousCartId !== saved.cartId) {
        const [anonymousState, customerState] = await Promise.all([loadAnonymousCart(false), loadCustomerCart()]);
        if (!anonymousState) return null;
        claim = {
          anonymousCartId: saved.cartId,
          mutationId: mutationId(),
          anonymousVersion: anonymousState.cart.version,
          customerVersion: customerState.cart.version,
        };
        writeClaim(claim);
      }
      const body = await request('/api/carts/current/claim', {
        method: 'POST',
        headers: {
          Accept: 'application/json', 'Content-Type': 'application/json',
          'X-Cart-Token': saved.cartToken,
          'Idempotency-Key': claim.mutationId,
          'If-Match': String(claim.customerVersion),
          'X-Anonymous-Cart-Version': String(claim.anonymousVersion),
        },
        body: JSON.stringify({ anonymousCartId: claim.anonymousCartId }),
      }, true, true);
      clearAnonymousAfterClaim();
      return { mode: 'customer', cart: body.cart, items: body.items || [], warnings: body.warnings || [] };
    } catch (error) {
      if (['CART_TOKEN_INVALID', 'CART_EXPIRED', 'CART_ALREADY_CONVERTED'].includes(error.code)) clearAnonymousAfterClaim();
      else if (error.status) global.sessionStorage.removeItem(CLAIM_STORAGE_KEY);
      throw error;
    }
  }

  function beginLoginTransition() {
    claimPreservedAnonymousCart()
      .then((state) => {
        if (state && typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
          global.dispatchEvent(new global.CustomEvent('cart:claim-success', { detail: { warnings: state.warnings || [] } }));
        }
      })
      .catch((error) => {
        if (typeof global.dispatchEvent === 'function' && typeof global.CustomEvent === 'function') {
          global.dispatchEvent(new global.CustomEvent('cart:claim-failed', { detail: { code: error.code || 'CART_API_FAILED' } }));
        }
      });
  }

  if (typeof global.addEventListener === 'function') {
    global.addEventListener('auth:login-success', beginLoginTransition);
    global.addEventListener('auth:session-restored', beginLoginTransition);
  }

  global.DivineCart = { STORAGE_KEY, CLAIM_STORAGE_KEY, readSession, loadAnonymousCart, loadCustomerCart, loadCurrentCart, createAnonymousCart, addConfiguredJob, updateConfiguredJob, removeItem, claimPreservedAnonymousCart };
  if (typeof module !== 'undefined') module.exports = global.DivineCart;
}(typeof window !== 'undefined' ? window : globalThis));
