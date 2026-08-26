'use strict';
const { createStripeCheckoutClient, MIN_EXPIRATION_SECONDS } = require('../stripeCheckoutClient');
describe('stripeCheckoutClient', () => {
  test('uses card, fixed URLs, 30-minute expiry, allowlisted metadata and disabled tax', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/c/pay/test', expires_at: 1800 }) });
    const client = createStripeCheckoutClient({ secretProvider: async () => 'sk_test_secret', fetchImpl, now: () => 0 });
    await client.createSession({ order: { orderId: 'o1', cartId: 'c1', shippingCents: 795 }, items: [{ productName: 'Tee', lineTotalCents: 2000 }], idempotencyKey: 'idem' });
    const request = fetchImpl.mock.calls[0][1]; const form = new URLSearchParams(request.body);
    expect(form.get('success_url')).toBe('https://divineprinting.com/checkout/success.html');
    expect(form.get('cancel_url')).toBe('https://divineprinting.com/checkout/cancel.html');
    expect(form.get('expires_at')).toBe(String(MIN_EXPIRATION_SECONDS));
    expect(form.get('payment_method_types[0]')).toBe('card'); expect(form.get('automatic_tax[enabled]')).toBe('false');
    expect([...form.keys()].filter((key) => key.startsWith('metadata['))).toEqual(['metadata[orderId]', 'metadata[cartId]', 'metadata[schema]']);
    expect(request.headers.Authorization).toBe('Bearer sk_test_secret'); expect(request.headers['Idempotency-Key']).toBe('idem');
  });
  test('returns safe errors without provider body or secret exposure', async () => {
    const client = createStripeCheckoutClient({ secretProvider: async () => 'sk_test_secret', fetchImpl: async () => ({ ok: false, status: 500 }) });
    await expect(client.createSession({ order: { orderId: 'o1', cartId: 'c1', shippingCents: 795 }, items: [], idempotencyKey: 'idem' })).rejects.toMatchObject({ code: 'STRIPE_UNAVAILABLE', message: 'Payment Session could not be created.' });
  });
  test('retrieves an existing Session without persisting its hosted URL', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'cs_test_1', url: 'https://checkout.stripe.com/x', expires_at: 1800 }) });
    await expect(createStripeCheckoutClient({ secretProvider: async () => 'sk_test_secret', fetchImpl }).retrieveSession('cs_test_1')).resolves.toMatchObject({ id: 'cs_test_1' });
    expect(fetchImpl.mock.calls[0][0]).toContain('/cs_test_1');
  });
});
