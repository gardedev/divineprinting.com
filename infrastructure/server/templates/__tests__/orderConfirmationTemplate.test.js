'use strict';

const { renderOrderConfirmation } = require('../orderConfirmationTemplate');

function fixture(overrides = {}) {
  return {
    order: { orderNumber: 'DP-ABC123', currency: 'USD', merchandiseSubtotalCents: 2000, discountCents: 100, shippingCents: 795, taxCents: null, totalCents: 2695, ...overrides.order },
    items: [{ productName: '<script>alert(1)</script>', quantity: 2, unitPriceCents: 1000, lineTotalCents: 2000, ...overrides.item }],
  };
}

describe('orderConfirmationTemplate', () => {
  test('renders supported totals and escapes untrusted item content in HTML', () => {
    const result = renderOrderConfirmation(fixture());
    expect(result.subject).toBe('Divine Printing order confirmation DP-ABC123');
    expect(result.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(result.html).not.toContain('<script>');
    expect(result.text).toContain('Merchandise subtotal: $20.00');
    expect(result.text).toContain('Discount: -$1.00');
    expect(result.text).toContain('Shipping: $7.95');
    expect(result.text).toContain('Order total: $26.95');
  });
  test('omits unavailable shipping address and absent tax/unit price cleanly', () => {
    const result = renderOrderConfirmation(fixture({ order: { addressSnapshot: { collectionAuthority: 'stripe_checkout' }, taxCents: null }, item: { unitPriceCents: undefined } }));
    expect(result.text).not.toContain('collectionAuthority');
    expect(result.text).not.toContain('Address');
    expect(result.text).not.toContain('Tax:');
    expect(result.text).not.toContain('each');
  });
  test('rejects order-number header injection', () => {
    expect(() => renderOrderConfirmation(fixture({ order: { orderNumber: 'DP-ABC\r\nBcc:x' } }))).toThrow('Invalid customer-facing order number');
  });
});
