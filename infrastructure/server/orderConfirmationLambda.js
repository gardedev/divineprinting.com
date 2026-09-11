'use strict';

const { createOrderNotificationRepository } = require('./repositories/orderNotificationRepository');
const { createCheckoutRepository } = require('./repositories/checkoutRepository');
const { createSesOrderConfirmationClient } = require('./integrations/sesOrderConfirmationClient');
const { createOrderConfirmationService } = require('./services/orderConfirmationService');

function notificationIdFromRecord(record) {
  if (record?.eventName !== 'INSERT') return null;
  const image = record.dynamodb?.NewImage;
  if (image?.notificationType?.S !== 'order_confirmation' || typeof image?.notificationId?.S !== 'string') return null;
  return image.notificationId.S;
}

function createHandler({ service } = {}) {
  const confirmationService = service || createOrderConfirmationService({
    notificationRepository: createOrderNotificationRepository(),
    loadOrder: createCheckoutRepository().getCheckout,
    emailProvider: createSesOrderConfirmationClient(),
  });
  return async function handler(event) {
    const batchItemFailures = [];
    for (const record of event?.Records || []) {
      const notificationId = notificationIdFromRecord(record);
      if (!notificationId) continue;
      try {
        await confirmationService.processNotification(notificationId);
      } catch (error) {
        if (error?.retryable === true && record.eventID) batchItemFailures.push({ itemIdentifier: record.eventID });
      }
    }
    return { batchItemFailures };
  };
}

let handler;
async function runtimeHandler(event, context) {
  handler = handler || createHandler();
  return handler(event, context);
}

module.exports = { handler: runtimeHandler, createHandler, notificationIdFromRecord };
