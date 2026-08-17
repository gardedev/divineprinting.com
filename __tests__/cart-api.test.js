describe('Task 5.4 anonymous cart browser client', () => {
  beforeEach(() => {
    jest.resetModules();
    const createStorage = () => { const values = new Map(); return { getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, String(value)), removeItem: key => values.delete(key), clear: () => values.clear() }; };
    global.sessionStorage = createStorage();
    global.localStorage = createStorage();
    global.fetch = jest.fn();
    global.getAccessToken = undefined;
    global.authenticatedCartFetch = undefined;
    require('../js/cart-api');
  });

  const response = (status, body) => Promise.resolve({ status, ok: status >= 200 && status < 300, json: () => Promise.resolve(body) });

  test('lazily creates and restores a same-tab anonymous cart without localStorage', async () => {
    fetch.mockReturnValueOnce(response(201, { cart: { cartId: 'c1', version: 1 }, items: [], cartToken: 't'.repeat(43) }));
    await DivineCart.loadAnonymousCart(true);
    expect(JSON.parse(sessionStorage.getItem('dp_anonymous_cart_v1'))).toEqual({ cartId: 'c1', cartToken: 't'.repeat(43) });
    expect(localStorage.getItem('dp_anonymous_cart_v1')).toBeNull();
    expect(fetch.mock.calls[0][0]).toBe('https://i3w6x21dzg.execute-api.us-east-1.amazonaws.com/api/carts/anonymous');
  });

  test('uses token, versions, and the same idempotency key on one retry', async () => {
    sessionStorage.setItem('dp_anonymous_cart_v1', JSON.stringify({ cartId: 'c1', cartToken: 't'.repeat(43) }));
    fetch.mockReturnValueOnce(response(200, { cart: { cartId: 'c1', version: 4 }, items: [] }))
      .mockReturnValueOnce(response(503, {})).mockReturnValueOnce(response(200, { cart: { cartId: 'c1', version: 5 }, items: [] }));
    await DivineCart.addConfiguredJob({ productId: 'p', variantAllocations: [], customerConfiguration: {} }, 'stable-key');
    const first = fetch.mock.calls[1][1]; const second = fetch.mock.calls[2][1];
    expect(first.headers['X-Cart-Token']).toBe('t'.repeat(43));
    expect(first.headers['If-Match']).toBe('4');
    expect(first.headers['Idempotency-Key']).toBe('stable-key');
    expect(second.headers['Idempotency-Key']).toBe('stable-key');
  });

  test('clears an invalid anonymous credential and never logs it', async () => {
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    sessionStorage.setItem('dp_anonymous_cart_v1', JSON.stringify({ cartId: 'c1', cartToken: 't'.repeat(43) }));
    fetch.mockReturnValueOnce(response(401, { code: 'CART_TOKEN_INVALID', error: 'Invalid' }));
    await expect(DivineCart.loadAnonymousCart()).rejects.toMatchObject({ code: 'CART_TOKEN_INVALID' });
    expect(sessionStorage.getItem('dp_anonymous_cart_v1')).toBeNull();
    expect(spy).not.toHaveBeenCalled(); spy.mockRestore();
  });

  test('transports the UI cart/item versions and does not replay a semantic conflict', async () => {
    sessionStorage.setItem('dp_anonymous_cart_v1', JSON.stringify({ cartId: 'c1', cartToken: 't'.repeat(43) }));
    fetch.mockReturnValueOnce(response(200, { cart: { cartId: 'c1', version: 9 }, items: [] }))
      .mockReturnValueOnce(response(409, { code: 'CART_VERSION_CONFLICT', error: 'Changed' }))
      .mockReturnValueOnce(response(200, { cart: { cartId: 'c1', version: 9 }, items: [] }));
    await expect(DivineCart.updateConfiguredJob({ cartItemId: 'i1', version: 3 }, { variantAllocations: [] }, 7, 'mutation')).rejects.toMatchObject({ code: 'CART_VERSION_CONFLICT' });
    expect(fetch.mock.calls[1][1].headers).toMatchObject({ 'If-Match': '7', 'X-Cart-Item-Version': '3' });
    expect(fetch).toHaveBeenCalledTimes(3); // initial load, one mutation, conflict refetch only
  });

  test('uses authenticated current-cart routes without changing the anonymous envelope', async () => {
    const envelope = JSON.stringify({ cartId: 'anonymous-cart', cartToken: 'z'.repeat(43), future: { claim: true } });
    sessionStorage.setItem('dp_anonymous_cart_v1', envelope);
    global.getAccessToken = jest.fn(() => 'verified-access-token');
    global.authenticatedCartFetch = jest.fn()
      .mockReturnValueOnce(response(200, { cart: { cartId: 'customer-cart', version: 4 }, items: [] }))
      .mockReturnValueOnce(response(200, { cart: { cartId: 'customer-cart', version: 4 }, items: [] }))
      .mockReturnValueOnce(response(200, { cart: { cartId: 'customer-cart', version: 5 }, items: [] }));
    const loaded = await DivineCart.loadCurrentCart(false);
    expect(loaded).toMatchObject({ mode: 'customer', cart: { cartId: 'customer-cart' } });
    await DivineCart.addConfiguredJob({ productId: 'p', variantAllocations: [], customerConfiguration: {} }, 'customer-mutation');
    expect(global.authenticatedCartFetch.mock.calls[0][0]).toBe('/api/carts/current');
    expect(global.authenticatedCartFetch.mock.calls[2][0]).toBe('/api/carts/current/items');
    expect(global.authenticatedCartFetch.mock.calls[2][1].headers).not.toHaveProperty('X-Cart-Token');
    expect(global.authenticatedCartFetch.mock.calls[2][1].headers['Idempotency-Key']).toBe('customer-mutation');
    expect(sessionStorage.getItem('dp_anonymous_cart_v1')).toBe(envelope);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('claims after login and clears the preserved envelope only after authoritative success', async () => {
    const token = 'q'.repeat(43);
    sessionStorage.setItem('dp_anonymous_cart_v1', JSON.stringify({ cartId: 'anonymous-cart', cartToken: token }));
    global.getAccessToken = jest.fn(() => 'verified-access-token');
    global.authenticatedCartFetch = jest.fn()
      .mockReturnValueOnce(response(200, { cart: { cartId: 'customer-cart', version: 5 }, items: [] }))
      .mockReturnValueOnce(response(200, { cart: { cartId: 'customer-cart', version: 6 }, items: [], warnings: ['CART_PRICE_UPDATED'] }));
    fetch.mockReturnValueOnce(response(200, { cart: { cartId: 'anonymous-cart', version: 3 }, items: [] }));
    const result = await DivineCart.claimPreservedAnonymousCart();
    expect(result).toMatchObject({ mode: 'customer', warnings: ['CART_PRICE_UPDATED'] });
    const [path, options] = authenticatedCartFetch.mock.calls[1];
    expect(path).toBe('/api/carts/current/claim');
    expect(options.headers).toMatchObject({ 'X-Cart-Token': token, 'If-Match': '5', 'X-Anonymous-Cart-Version': '3' });
    expect(JSON.parse(options.body)).toEqual({ anonymousCartId: 'anonymous-cart' });
    expect(sessionStorage.getItem('dp_anonymous_cart_v1')).toBeNull();
    expect(sessionStorage.getItem('dp_cart_claim_v1')).toBeNull();
  });

  test('preserves the anonymous envelope but resets semantic claim metadata after an authoritative conflict', async () => {
    const envelope = JSON.stringify({ cartId: 'anonymous-cart', cartToken: 'r'.repeat(43), future: true });
    sessionStorage.setItem('dp_anonymous_cart_v1', envelope);
    global.getAccessToken = jest.fn(() => 'verified-access-token');
    global.authenticatedCartFetch = jest.fn()
      .mockReturnValueOnce(response(200, { cart: { cartId: 'customer-cart', version: 5 }, items: [] }))
      .mockReturnValueOnce(response(409, { code: 'CART_VERSION_CONFLICT', error: 'Changed' }));
    fetch.mockReturnValueOnce(response(200, { cart: { cartId: 'anonymous-cart', version: 3 }, items: [] }));
    await expect(DivineCart.claimPreservedAnonymousCart()).rejects.toMatchObject({ code: 'CART_VERSION_CONFLICT' });
    expect(sessionStorage.getItem('dp_anonymous_cart_v1')).toBe(envelope);
    expect(sessionStorage.getItem('dp_cart_claim_v1')).toBeNull();
  });

  test.each(['CART_TOKEN_INVALID', 'CART_EXPIRED', 'CART_ALREADY_CONVERTED'])('clears an authoritatively unusable anonymous envelope for %s', async (code) => {
    sessionStorage.setItem('dp_anonymous_cart_v1', JSON.stringify({ cartId: 'anonymous-cart', cartToken: 's'.repeat(43) }));
    global.getAccessToken = jest.fn(() => 'verified-access-token');
    global.authenticatedCartFetch = jest.fn().mockReturnValueOnce(response(200, { cart: { cartId: 'customer-cart', version: 5 }, items: [] }));
    fetch.mockReturnValueOnce(response(code === 'CART_EXPIRED' ? 410 : code === 'CART_ALREADY_CONVERTED' ? 409 : 401, { code, error: 'Unavailable' }));
    await expect(DivineCart.claimPreservedAnonymousCart()).rejects.toMatchObject({ code });
    expect(sessionStorage.getItem('dp_anonymous_cart_v1')).toBeNull();
  });
});
