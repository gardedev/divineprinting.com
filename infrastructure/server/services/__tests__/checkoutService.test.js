'use strict';
jest.mock('../../repositories/checkoutRepository', () => ({ createCheckoutRepository: jest.fn(), deterministicId: jest.fn(() => 'order-1') }));
const { createCheckoutService, SHIPPING_CENTS, stripeKey } = require('../checkoutService');

function setup(overrides = {}) {
  const prepared = { readyForDurableCreation: true, proposedOrder: { customerId: 'sub-1', cartId: 'cart-1', cartVersion: 3, merchandiseSubtotalCents: 2000, shippingCents: SHIPPING_CENTS, discountCents: 0, taxStatus: 'disabled', taxCents: null, totalCents: 2795 }, proposedItems: [{ lineTotalCents: 2000 }], idempotency: { key: 'idem-key-1', scope: 'sub-1:cart-1:3', fingerprint: 'f'.repeat(64) } };
  const orderService = { prepareOrder: jest.fn().mockResolvedValue(prepared) };
  const checkoutRepository = { getCheckout: jest.fn().mockResolvedValue(null), createPendingCheckout: jest.fn().mockResolvedValue({ order: { ...prepared.proposedOrder, orderId: 'order-1', version: 1 }, items: prepared.proposedItems, idempotentReplay: false }), persistStripeSession: jest.fn().mockResolvedValue({ orderId: 'order-1' }), recordStripeFailureAndUnlock: jest.fn().mockResolvedValue(true), claimStripeEvent: jest.fn().mockResolvedValue({ claimed: true }), markStripeEventProcessed: jest.fn(), markStripeEventFailed: jest.fn(), getOrderByStripeSessionId: jest.fn(), transitionOrderToPaid: jest.fn(), transitionOrderPaymentFailed: jest.fn(), transitionOrderToRefunded: jest.fn(), transitionOrderToDisputed: jest.fn(), ...overrides.repo };
  const stripeClient = { createSession: jest.fn().mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/test', expiresAt: 123 }), retrieveSession: jest.fn(), ...overrides.stripe };
  return { prepared, orderService, checkoutRepository, stripeClient, service: createCheckoutService({ orderService, checkoutRepository, stripeClient }) };
}
describe('checkoutService', () => {
  test('prepares, atomically persists, calls Stripe once, and links the Session', async () => {
    const x = setup(); const result = await x.service.startCheckout({ auth: { sub: 'sub-1' }, idempotencyKey: 'idem-key-1', expectedCartVersion: 3 });
    expect(x.orderService.prepareOrder).toHaveBeenCalled(); expect(x.checkoutRepository.createPendingCheckout).toHaveBeenCalled();
    expect(x.stripeClient.createSession).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: stripeKey(x.prepared.idempotency) }));
    expect(x.checkoutRepository.persistStripeSession).toHaveBeenCalledTimes(1); expect(result.checkoutUrl).toContain('checkout.stripe.com');
  });
  test('compensates a Stripe failure without leaking provider details', async () => {
    const x = setup({ stripe: { createSession: jest.fn().mockRejectedValue(Object.assign(new Error('secret provider details'), { code: 'STRIPE_UNAVAILABLE' })) } });
    await expect(x.service.startCheckout({ idempotencyKey: 'idem-key-1', expectedCartVersion: 3 })).rejects.toMatchObject({ code: 'STRIPE_UNAVAILABLE' });
    expect(x.checkoutRepository.recordStripeFailureAndUnlock).toHaveBeenCalledWith(expect.objectContaining({ failureCode: 'STRIPE_UNAVAILABLE' }));
  });
  test('retries only Session persistence after Stripe succeeds', async () => {
    const persist = jest.fn().mockRejectedValueOnce(new Error('transient')).mockResolvedValueOnce({ orderId: 'order-1' });
    const x = setup({ repo: { persistStripeSession: persist } });
    await x.service.startCheckout({ idempotencyKey: 'idem-key-1', expectedCartVersion: 3 });
    expect(x.stripeClient.createSession).toHaveBeenCalledTimes(1); expect(persist).toHaveBeenCalledTimes(2);
  });
  test('fails closed when preparation authorities are incomplete', async () => {
    const x = setup(); x.orderService.prepareOrder.mockResolvedValue({ readyForDurableCreation: false });
    await expect(x.service.startCheckout({})).rejects.toMatchObject({ code: 'CHECKOUT_CONFIGURATION_INCOMPLETE' });
    expect(x.checkoutRepository.createPendingCheckout).not.toHaveBeenCalled(); expect(x.stripeClient.createSession).not.toHaveBeenCalled();
  });
  test('recovers an already-linked Session without rerunning preparation', async () => {
    const x = setup();
    x.checkoutRepository.getCheckout.mockResolvedValue({ order: { orderId: 'order-1', customerId: 'sub-1', cartId: 'cart-1', cartVersion: 3, idempotencyKey: 'idem-key-1', idempotencyFingerprint: 'f'.repeat(64), stripeCheckoutSessionId: 'cs_1' }, items: [] });
    x.stripeClient.retrieveSession.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.stripe.com/same', expiresAt: 123 });
    const result = await x.service.startCheckout({ auth: { sub: 'sub-1' }, checkoutInput: { cartId: 'cart-1' }, idempotencyKey: 'idem-key-1', expectedCartVersion: 3 });
    expect(result.idempotentReplay).toBe(true); expect(x.orderService.prepareOrder).not.toHaveBeenCalled(); expect(x.stripeClient.createSession).not.toHaveBeenCalled();
  });
  test('reconciles a late asynchronous payment success by checkout session', async () => {
    const order = { orderId: 'order-1', paymentState: 'checkout_session_created' };
    const x = setup({ repo: { getOrderByStripeSessionId: jest.fn().mockResolvedValue(order), transitionOrderToPaid: jest.fn().mockResolvedValue(true) } });
    const result = await x.service.handleWebhookEvent({ event: { id: 'evt_async', type: 'checkout.session.async_payment_succeeded', created: 1770000000, data: { object: { id: 'cs_async', payment_intent: 'pi_async' } } } });
    expect(x.checkoutRepository.getOrderByStripeSessionId).toHaveBeenCalledWith('cs_async');
    expect(x.checkoutRepository.transitionOrderToPaid).toHaveBeenCalledWith({ order, stripePaymentIntentId: 'pi_async', stripeEventId: 'evt_async' });
    expect(result).toMatchObject({ handled: true, idempotent: false, duplicate: false });
  });
  test('does not reprocess already claimed or concurrently processing events', async () => {
    const processed = setup({ repo: { claimStripeEvent: jest.fn().mockResolvedValue({ alreadyProcessed: true }) } });
    const concurrent = setup({ repo: { claimStripeEvent: jest.fn().mockResolvedValue({ duplicate: true }) } });
    await expect(processed.service.handleWebhookEvent({ event: { id: 'evt_1', type: 'checkout.session.expired' } })).resolves.toMatchObject({ idempotent: true });
    await expect(concurrent.service.handleWebhookEvent({ event: { id: 'evt_2', type: 'checkout.session.expired' } })).resolves.toMatchObject({ duplicate: true });
    expect(processed.checkoutRepository.getOrderByStripeSessionId).not.toHaveBeenCalled();
    expect(concurrent.checkoutRepository.getOrderByStripeSessionId).not.toHaveBeenCalled();
  });
  test.each([
    ['checkout.session.completed', { id: 'cs_1', payment_status: 'paid', payment_intent: 'pi_1' }, 'transitionOrderToPaid'],
    ['checkout.session.expired', { id: 'cs_1' }, 'transitionOrderPaymentFailed'],
    ['payment_intent.payment_failed', { id: 'pi_1', metadata: { checkout_session_id: 'cs_1' }, last_payment_error: { message: 'declined' } }, 'transitionOrderPaymentFailed'],
    ['charge.refunded', { id: 'ch_1', amount_refunded: 100, metadata: { checkout_session_id: 'cs_1' }, refunds: { data: [{ id: 're_1' }] } }, 'transitionOrderToRefunded'],
    ['charge.dispute.created', { id: 'dp_1', metadata: { checkout_session_id: 'cs_1' } }, 'transitionOrderToDisputed'],
    ['charge.dispute.updated', { id: 'dp_1', metadata: { checkout_session_id: 'cs_1' } }, 'transitionOrderToDisputed'],
    ['charge.dispute.closed', { id: 'dp_1', status: 'won', metadata: { checkout_session_id: 'cs_1' } }, null],
  ])('dispatches %s with idempotent event completion', async (type, object, transition) => {
    const order = { orderId: 'order-1', version: 2, cartId: 'cart-1', cartVersion: 3, paymentState: 'checkout_session_created' };
    const x = setup({ repo: { getOrderByStripeSessionId: jest.fn().mockResolvedValue(order), transitionOrderToPaid: jest.fn().mockResolvedValue(true), transitionOrderPaymentFailed: jest.fn().mockResolvedValue(true), transitionOrderToRefunded: jest.fn().mockResolvedValue(true), transitionOrderToDisputed: jest.fn().mockResolvedValue(true) } });
    await expect(x.service.handleWebhookEvent({ event: { id: `evt_${type}`, type, created: 1770000000, data: { object } } })).resolves.toMatchObject({ handled: true });
    if (transition) expect(x.checkoutRepository[transition]).toHaveBeenCalledTimes(1);
    expect(x.checkoutRepository.markStripeEventProcessed).toHaveBeenCalledTimes(1);
  });
});
