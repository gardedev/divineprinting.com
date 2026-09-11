'use strict';

const { renderOrderConfirmation } = require('../templates/orderConfirmationTemplate');
const { validEmail } = require('../integrations/sesOrderConfirmationClient');
const logger = require('../utils/logger');

const MAX_ATTEMPTS = 3;
const TERMINAL_STATES = new Set(['sent', 'failed', 'delivery_unknown']);

class OrderConfirmationError extends Error {
  constructor(code, retryable, cause) {
    super(code);
    this.name = 'OrderConfirmationError';
    this.code = code;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

function createOrderConfirmationService({ notificationRepository, loadOrder, emailProvider, render = renderOrderConfirmation, maxAttempts = MAX_ATTEMPTS } = {}) {
  if (!notificationRepository || typeof notificationRepository.claimDelivery !== 'function') throw new TypeError('notificationRepository is required');
  if (typeof loadOrder !== 'function') throw new TypeError('loadOrder is required');
  if (!emailProvider || typeof emailProvider.send !== 'function') throw new TypeError('emailProvider is required');

  async function processNotification(notificationId) {
    let notification;
    try {
      notification = await notificationRepository.getNotification(notificationId);
    } catch (error) {
      throw new OrderConfirmationError('ORDER_CONFIRMATION_STATE_UNAVAILABLE', true, error);
    }
    if (!notification || notification.notificationType !== 'order_confirmation' || TERMINAL_STATES.has(notification.deliveryState) || notification.deliveryState === 'sending') {
      return { skipped: true, state: notification?.deliveryState || 'missing' };
    }
    let claimed;
    try {
      claimed = await notificationRepository.claimDelivery(notificationId, maxAttempts);
    } catch (error) {
      throw new OrderConfirmationError('ORDER_CONFIRMATION_CLAIM_UNAVAILABLE', true, error);
    }
    if (!claimed) return { skipped: true, state: 'not_claimed' };

    async function retryOrExhaust(errorClass, cause) {
      if (claimed.attemptCount >= maxAttempts) {
        await notificationRepository.markFailed(notificationId, 'RETRY_EXHAUSTED');
        logger.error('Order confirmation retries exhausted', null, { notificationId, orderId: claimed.orderId, errorClass });
        return { skipped: false, state: 'failed' };
      }
      await notificationRepository.markRetryable(notificationId, errorClass);
      logger.warn('Order confirmation delivery will retry', { notificationId, orderId: claimed.orderId, errorClass });
      throw new OrderConfirmationError('ORDER_CONFIRMATION_RETRYABLE', true, cause);
    }

    try {
      let checkout;
      try {
        checkout = await loadOrder(claimed.orderId);
      } catch (error) {
        return await retryOrExhaust('ORDER_READ_TEMPORARY', error);
      }
      const order = checkout?.order;
      const items = checkout?.items;
      if (!order || order.paymentState !== 'paid' || order.orderState !== 'confirmed') {
        await notificationRepository.markFailed(notificationId, 'ORDER_NOT_PAID');
        return { skipped: false, state: 'failed' };
      }
      const recipient = order.contactSnapshot?.email;
      if (!validEmail(recipient)) {
        await notificationRepository.markFailed(notificationId, 'CUSTOMER_EMAIL_INVALID');
        return { skipped: false, state: 'failed' };
      }
      const content = render({ order, items });
      let result;
      try {
        result = await emailProvider.send({ to: recipient, ...content });
      } catch (error) {
        const classification = error?.classification;
        if (classification === 'retryable') return await retryOrExhaust(error.code || 'EMAIL_PROVIDER_TEMPORARY', error);
        if (classification === 'ambiguous') {
          await notificationRepository.markDeliveryUnknown(notificationId, error.code || 'EMAIL_PROVIDER_OUTCOME_UNKNOWN');
          logger.error('Order confirmation delivery outcome is unknown', null, { notificationId, orderId: claimed.orderId, errorClass: error.code || 'EMAIL_PROVIDER_OUTCOME_UNKNOWN' });
          return { skipped: false, state: 'delivery_unknown' };
        }
        await notificationRepository.markFailed(notificationId, error?.code || 'ORDER_CONFIRMATION_INVALID');
        logger.error('Order confirmation delivery failed permanently', null, { notificationId, orderId: claimed.orderId, errorClass: error?.code || 'ORDER_CONFIRMATION_INVALID' });
        return { skipped: false, state: 'failed' };
      }
      try {
        const persisted = await notificationRepository.markSent(notificationId, result.messageId);
        if (!persisted) throw new Error('Sent-state condition failed');
      } catch (error) {
        try { await notificationRepository.markDeliveryUnknown(notificationId, 'SENT_STATE_PERSISTENCE_UNKNOWN'); } catch (_ignored) { /* no safe automatic resend */ }
        logger.error('Order confirmation acceptance could not be durably recorded', null, { notificationId, orderId: claimed.orderId, errorClass: 'SENT_STATE_PERSISTENCE_UNKNOWN' });
        return { skipped: false, state: 'delivery_unknown' };
      }
      logger.info('Order confirmation accepted by provider', { notificationId, orderId: claimed.orderId });
      return { skipped: false, state: 'sent' };
    } catch (error) {
      if (error instanceof OrderConfirmationError) throw error;
      const classification = error?.classification;
      if (classification === 'retryable') {
        return await retryOrExhaust(error.code || 'EMAIL_PROVIDER_TEMPORARY', error);
      }
      if (classification === 'ambiguous') {
        await notificationRepository.markDeliveryUnknown(notificationId, error.code || 'EMAIL_PROVIDER_OUTCOME_UNKNOWN');
        logger.error('Order confirmation delivery outcome is unknown', null, { notificationId, orderId: claimed.orderId, errorClass: error.code || 'EMAIL_PROVIDER_OUTCOME_UNKNOWN' });
        return { skipped: false, state: 'delivery_unknown' };
      }
      await notificationRepository.markFailed(notificationId, error?.code || 'ORDER_CONFIRMATION_INVALID');
      logger.error('Order confirmation delivery failed permanently', null, { notificationId, orderId: claimed.orderId, errorClass: error?.code || 'ORDER_CONFIRMATION_INVALID' });
      return { skipped: false, state: 'failed' };
    }
  }

  return { processNotification };
}

module.exports = { createOrderConfirmationService, OrderConfirmationError, MAX_ATTEMPTS, TERMINAL_STATES };
