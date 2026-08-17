(function (global) {
  'use strict';

  const STORAGE_KEY = 'dp_anonymous_cart_v1';
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

  async function request(path, options, retry = true) {
    try {
      const response = await global.fetch(`${API_BASE}${path}`, options);
      if (retry && RETRYABLE.has(response.status)) return request(path, options, false);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body.error || 'The cart request could not be completed.');
        error.code = body.code || 'CART_API_FAILED';
        error.status = response.status;
        throw error;
      }
      return body;
    } catch (error) {
      if (retry && !error.status) return request(path, options, false);
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

  async function mutate(method, itemPath, payload, expectedCartVersion, expectedItemVersion, idempotencyKey) {
    const state = await loadAnonymousCart(true);
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Cart-Token': state.cartToken,
      'Idempotency-Key': idempotencyKey || mutationId(),
      'If-Match': String(expectedCartVersion || state.cart.version),
    };
    if (expectedItemVersion) headers['X-Cart-Item-Version'] = String(expectedItemVersion);
    const body = await request(`/api/carts/anonymous/${encodeURIComponent(state.cart.cartId)}/items${itemPath || ''}`, {
      method, headers, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
    });
    return { cart: body.cart, items: body.items || [], cartToken: state.cartToken };
  }

  async function addConfiguredJob(job, idempotencyKey) {
    return mutate('POST', '', { itemType: 'CONFIGURED_JOB', ...job }, undefined, undefined, idempotencyKey);
  }

  async function updateConfiguredJob(item, changes, expectedCartVersion, idempotencyKey) {
    try {
      return await mutate('PATCH', `/${encodeURIComponent(item.cartItemId)}`, { itemType: 'CONFIGURED_JOB', ...changes }, expectedCartVersion, item.version, idempotencyKey);
    } catch (error) {
      if (error.code === 'CART_VERSION_CONFLICT') await loadAnonymousCart(false);
      throw error;
    }
  }

  async function removeItem(item, expectedCartVersion, idempotencyKey) {
    try {
      return await mutate('DELETE', `/${encodeURIComponent(item.cartItemId)}`, undefined, expectedCartVersion, item.version, idempotencyKey);
    } catch (error) {
      if (error.code === 'CART_VERSION_CONFLICT') await loadAnonymousCart(false);
      throw error;
    }
  }

  global.DivineCart = { STORAGE_KEY, readSession, loadAnonymousCart, createAnonymousCart, addConfiguredJob, updateConfiguredJob, removeItem };
  if (typeof module !== 'undefined') module.exports = global.DivineCart;
}(typeof window !== 'undefined' ? window : globalThis));
