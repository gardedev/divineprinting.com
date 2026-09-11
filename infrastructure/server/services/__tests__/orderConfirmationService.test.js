'use strict';

jest.mock('../../utils/logger', () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }));
const { createOrderConfirmationService } = require('../orderConfirmationService');

function setup(overrides = {}) {
  const notification = { notificationId: 'order-confirmation:o1', notificationType: 'order_confirmation', orderId: 'o1', deliveryState: 'pending', attemptCount: 0 };
  const notificationRepository = {
    getNotification: jest.fn().mockResolvedValue(notification),
    claimDelivery: jest.fn().mockResolvedValue({ ...notification, deliveryState: 'sending', attemptCount: 1 }),
    markSent: jest.fn().mockResolvedValue(true), markRetryable: jest.fn().mockResolvedValue(true), markFailed: jest.fn().mockResolvedValue(true), markDeliveryUnknown: jest.fn().mockResolvedValue(true),
    ...overrides.repo,
  };
  const checkout = { order: { orderId: 'o1', orderNumber: 'DP-ABC', paymentState: 'paid', orderState: 'confirmed', contactSnapshot: { email: 'buyer@example.com' }, currency: 'USD', merchandiseSubtotalCents: 1000, shippingCents: 795, taxCents: null, totalCents: 1795 }, items: [{ productName: 'Shirt', quantity: 1, unitPriceCents: 1000, lineTotalCents: 1000 }] };
  const loadOrder = jest.fn().mockResolvedValue(checkout);
  const emailProvider = { send: jest.fn().mockResolvedValue({ messageId: 'm1' }), ...overrides.provider };
  const render = jest.fn().mockReturnValue({ subject: 'Safe', text: 'Safe', html: '<p>Safe</p>' });
  return { notificationRepository, loadOrder, emailProvider, render, service: createOrderConfirmationService({ notificationRepository, loadOrder, emailProvider, render, maxAttempts: 3 }) };
}

describe('orderConfirmationService', () => {
  test('claims, validates, renders, sends, and records provider acceptance', async () => {
    const x = setup();
    await expect(x.service.processNotification('order-confirmation:o1')).resolves.toMatchObject({ state: 'sent' });
    expect(x.notificationRepository.claimDelivery).toHaveBeenCalledWith('order-confirmation:o1', 3);
    expect(x.emailProvider.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'buyer@example.com' }));
    expect(x.notificationRepository.markSent).toHaveBeenCalledWith('order-confirmation:o1', 'm1');
  });
  test.each(['sent', 'failed', 'delivery_unknown', 'sending'])('never resends %s records', async (state) => {
    const x = setup({ repo: { getNotification: jest.fn().mockResolvedValue({ notificationType: 'order_confirmation', deliveryState: state }) } });
    await expect(x.service.processNotification('order-confirmation:o1')).resolves.toMatchObject({ skipped: true, state });
    expect(x.emailProvider.send).not.toHaveBeenCalled();
  });
  test('known temporary failure is persisted retryable and returned for batch retry', async () => {
    const error = Object.assign(new Error('safe'), { classification: 'retryable', code: 'EMAIL_PROVIDER_TEMPORARY' });
    const x = setup({ provider: { send: jest.fn().mockRejectedValue(error) } });
    await expect(x.service.processNotification('order-confirmation:o1')).rejects.toMatchObject({ retryable: true });
    expect(x.notificationRepository.markRetryable).toHaveBeenCalled();
  });
  test('the final temporary failure is persisted as exhausted instead of retried', async () => {
    const error = Object.assign(new Error('safe'), { classification: 'retryable', code: 'EMAIL_PROVIDER_TEMPORARY' });
    const x = setup({ repo: { claimDelivery: jest.fn().mockResolvedValue({ notificationType: 'order_confirmation', orderId: 'o1', deliveryState: 'sending', attemptCount: 3 }) }, provider: { send: jest.fn().mockRejectedValue(error) } });
    await expect(x.service.processNotification('order-confirmation:o1')).resolves.toMatchObject({ state: 'failed' });
    expect(x.notificationRepository.markFailed).toHaveBeenCalledWith('order-confirmation:o1', 'RETRY_EXHAUSTED');
    expect(x.notificationRepository.markRetryable).not.toHaveBeenCalled();
  });
  test.each(['getNotification', 'claimDelivery'])('%s persistence failure requests a batch retry', async (method) => {
    const x = setup({ repo: { [method]: jest.fn().mockRejectedValue(new Error('ddb unavailable')) } });
    await expect(x.service.processNotification('order-confirmation:o1')).rejects.toMatchObject({ retryable: true });
    expect(x.emailProvider.send).not.toHaveBeenCalled();
  });
  test('order read failure is retryable before any provider call', async () => {
    const x = setup(); x.loadOrder.mockRejectedValue(new Error('ddb unavailable'));
    await expect(x.service.processNotification('order-confirmation:o1')).rejects.toMatchObject({ retryable: true });
    expect(x.notificationRepository.markRetryable).toHaveBeenCalledWith('order-confirmation:o1', 'ORDER_READ_TEMPORARY');
    expect(x.emailProvider.send).not.toHaveBeenCalled();
  });
  test('provider acceptance followed by sent-state failure becomes delivery_unknown without resend', async () => {
    const x = setup({ repo: { markSent: jest.fn().mockRejectedValue(new Error('ddb unavailable')) } });
    await expect(x.service.processNotification('order-confirmation:o1')).resolves.toMatchObject({ state: 'delivery_unknown' });
    expect(x.emailProvider.send).toHaveBeenCalledTimes(1);
    expect(x.notificationRepository.markDeliveryUnknown).toHaveBeenCalledWith('order-confirmation:o1', 'SENT_STATE_PERSISTENCE_UNKNOWN');
  });
  test.each([
    ['permanent', 'markFailed', 'failed'],
    ['ambiguous', 'markDeliveryUnknown', 'delivery_unknown'],
  ])('%s provider outcome becomes terminal %s', async (classification, method, state) => {
    const error = Object.assign(new Error('raw sensitive details'), { classification, code: `EMAIL_${classification.toUpperCase()}` });
    const x = setup({ provider: { send: jest.fn().mockRejectedValue(error) } });
    await expect(x.service.processNotification('order-confirmation:o1')).resolves.toMatchObject({ state });
    expect(x.notificationRepository[method]).toHaveBeenCalled();
  });
  test.each([
    [{ paymentState: 'checkout_session_created', orderState: 'checkout_pending', contactSnapshot: { email: 'buyer@example.com' } }, 'ORDER_NOT_PAID'],
    [{ paymentState: 'paid', orderState: 'confirmed', contactSnapshot: {} }, 'CUSTOMER_EMAIL_INVALID'],
  ])('permanently rejects non-sendable order data', async (orderPatch, errorClass) => {
    const x = setup();
    x.loadOrder.mockResolvedValue({ order: { orderId: 'o1', ...orderPatch }, items: [] });
    await expect(x.service.processNotification('order-confirmation:o1')).resolves.toMatchObject({ state: 'failed' });
    expect(x.notificationRepository.markFailed).toHaveBeenCalledWith('order-confirmation:o1', errorClass);
    expect(x.emailProvider.send).not.toHaveBeenCalled();
  });
  test('concurrent failed claim does no delivery work', async () => {
    const x = setup({ repo: { claimDelivery: jest.fn().mockResolvedValue(null) } });
    await expect(x.service.processNotification('order-confirmation:o1')).resolves.toMatchObject({ skipped: true });
    expect(x.emailProvider.send).not.toHaveBeenCalled();
  });
});
