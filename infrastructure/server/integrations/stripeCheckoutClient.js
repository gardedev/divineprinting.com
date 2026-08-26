'use strict';

const STRIPE_ENDPOINT = 'https://api.stripe.com/v1/checkout/sessions';
const MIN_EXPIRATION_SECONDS = 30 * 60;

class StripeCheckoutError extends Error {
  constructor(code, message, cause) { super(message || code); this.name = 'StripeCheckoutError'; this.code = code; if (cause) this.cause = cause; }
}

function append(form, key, value) { if (value !== undefined && value !== null) form.append(key, String(value)); }

function createStripeCheckoutClient({ secretProvider, fetchImpl = globalThis.fetch, now = () => Date.now(), config = {} } = {}) {
  if (typeof secretProvider !== 'function') throw new TypeError('A server-side Stripe secret provider is required.');
  if (typeof fetchImpl !== 'function') throw new TypeError('A fetch implementation is required.');
  const successUrl = config.successUrl || 'https://divineprinting.com/checkout/success.html';
  const cancelUrl = config.cancelUrl || 'https://divineprinting.com/checkout/cancel.html';
  const taxEnabled = config.taxEnabled === true;

  async function createSession({ order, items, idempotencyKey }) {
    const secret = await secretProvider();
    if (typeof secret !== 'string' || !secret.startsWith('sk_')) throw new StripeCheckoutError('STRIPE_CONFIGURATION_INVALID', 'Payment configuration is unavailable.');
    const form = new URLSearchParams();
    append(form, 'mode', 'payment'); append(form, 'success_url', successUrl); append(form, 'cancel_url', cancelUrl);
    append(form, 'expires_at', Math.floor(now() / 1000) + MIN_EXPIRATION_SECONDS);
    append(form, 'payment_method_types[0]', 'card'); append(form, 'shipping_address_collection[allowed_countries][0]', 'US');
    append(form, 'automatic_tax[enabled]', taxEnabled ? 'true' : 'false');
    append(form, 'metadata[orderId]', order.orderId); append(form, 'metadata[cartId]', order.cartId); append(form, 'metadata[schema]', 'orders-v2');
    items.forEach((item, index) => {
      append(form, `line_items[${index}][price_data][currency]`, 'usd');
      append(form, `line_items[${index}][price_data][unit_amount]`, item.lineTotalCents);
      append(form, `line_items[${index}][price_data][product_data][name]`, item.productName || item.baseSku || 'Configured item');
      append(form, `line_items[${index}][quantity]`, 1);
    });
    append(form, `line_items[${items.length}][price_data][currency]`, 'usd');
    append(form, `line_items[${items.length}][price_data][unit_amount]`, order.shippingCents);
    append(form, `line_items[${items.length}][price_data][product_data][name]`, 'Shipping');
    append(form, `line_items[${items.length}][quantity]`, 1);
    let response;
    try { response = await fetchImpl(STRIPE_ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': idempotencyKey }, body: form.toString() }); }
    catch (error) { throw new StripeCheckoutError('STRIPE_UNAVAILABLE', 'Payment service is temporarily unavailable.', error); }
    if (!response.ok) throw new StripeCheckoutError(response.status >= 500 ? 'STRIPE_UNAVAILABLE' : 'STRIPE_REQUEST_REJECTED', 'Payment Session could not be created.');
    const payload = await response.json();
    if (!payload?.id || !payload?.url || !Number.isInteger(payload.expires_at)) throw new StripeCheckoutError('STRIPE_RESPONSE_INVALID', 'Payment service returned an invalid response.');
    return { id: payload.id, url: payload.url, expiresAt: payload.expires_at };
  }
  async function retrieveSession(sessionId) {
    const secret = await secretProvider();
    if (typeof sessionId !== 'string' || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) throw new StripeCheckoutError('STRIPE_RESPONSE_INVALID', 'Payment Session is invalid.');
    let response;
    try { response = await fetchImpl(`${STRIPE_ENDPOINT}/${encodeURIComponent(sessionId)}`, { headers: { Authorization: `Bearer ${secret}` } }); }
    catch (error) { throw new StripeCheckoutError('STRIPE_UNAVAILABLE', 'Payment service is temporarily unavailable.', error); }
    if (!response.ok) throw new StripeCheckoutError('STRIPE_UNAVAILABLE', 'Payment Session could not be retrieved.');
    const payload = await response.json();
    if (!payload?.id || !payload?.url || !Number.isInteger(payload.expires_at)) throw new StripeCheckoutError('STRIPE_RESPONSE_INVALID', 'Payment service returned an invalid response.');
    return { id: payload.id, url: payload.url, expiresAt: payload.expires_at };
  }
  return { createSession, retrieveSession };
}

module.exports = { createStripeCheckoutClient, StripeCheckoutError, MIN_EXPIRATION_SECONDS, STRIPE_ENDPOINT };
