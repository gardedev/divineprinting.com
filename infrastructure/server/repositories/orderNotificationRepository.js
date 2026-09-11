'use strict';

const { GetCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { docClient } = require('../utils/dynamoDbClient');

const DEFAULT_TABLE = process.env.ORDER_NOTIFICATIONS_TABLE || 'divine-printing-order-notifications';

class OrderNotificationRepositoryError extends Error {
  constructor(code, message, cause) {
    super(message || code);
    this.name = 'OrderNotificationRepositoryError';
    this.code = code;
    this.isDomainError = true;
    if (cause) this.cause = cause;
  }
}

function createOrderNotificationRepository({ client = docClient, tableName = DEFAULT_TABLE, now = () => new Date() } = {}) {
  async function getNotification(notificationId) {
    try {
      const result = await client.send(new GetCommand({
        TableName: tableName,
        Key: { notificationId },
        ConsistentRead: true,
      }));
      return result.Item || null;
    } catch (error) {
      throw new OrderNotificationRepositoryError('NOTIFICATION_READ_FAILED', 'Notification could not be read.', error);
    }
  }

  async function claimDelivery(notificationId, maxAttempts) {
    const at = now().toISOString();
    try {
      const result = await client.send(new UpdateCommand({
        TableName: tableName,
        Key: { notificationId },
        UpdateExpression: 'SET #state = :sending, #updatedAt = :at, #claimedAt = :at ADD #attemptCount :one',
        ConditionExpression: '(#state = :pending OR #state = :retryable) AND #attemptCount < :maxAttempts',
        ExpressionAttributeNames: {
          '#state': 'deliveryState', '#updatedAt': 'updatedAt', '#claimedAt': 'claimedAt', '#attemptCount': 'attemptCount',
        },
        ExpressionAttributeValues: {
          ':sending': 'sending', ':pending': 'pending', ':retryable': 'retryable', ':at': at, ':one': 1, ':maxAttempts': maxAttempts,
        },
        ReturnValues: 'ALL_NEW',
      }));
      return result.Attributes || null;
    } catch (error) {
      if (error?.name === 'ConditionalCheckFailedException') return null;
      throw new OrderNotificationRepositoryError('NOTIFICATION_CLAIM_FAILED', 'Notification could not be claimed.', error);
    }
  }

  async function transition(notificationId, fromState, toState, fields = {}) {
    const at = now().toISOString();
    const names = { '#state': 'deliveryState', '#updatedAt': 'updatedAt' };
    const values = { ':fromState': fromState, ':toState': toState, ':at': at };
    const sets = ['#state = :toState', '#updatedAt = :at'];
    for (const [key, value] of Object.entries(fields)) {
      names[`#${key}`] = key;
      values[`:${key}`] = value;
      sets.push(`#${key} = :${key}`);
    }
    try {
      await client.send(new UpdateCommand({
        TableName: tableName,
        Key: { notificationId },
        UpdateExpression: `SET ${sets.join(', ')}`,
        ConditionExpression: '#state = :fromState',
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
      }));
      return true;
    } catch (error) {
      if (error?.name === 'ConditionalCheckFailedException') return false;
      throw new OrderNotificationRepositoryError('NOTIFICATION_STATE_FAILED', 'Notification state could not be updated.', error);
    }
  }

  return {
    getNotification,
    claimDelivery,
    markSent: (id, providerMessageId) => transition(id, 'sending', 'sent', { providerMessageId, sentAt: now().toISOString() }),
    markRetryable: (id, errorClass) => transition(id, 'sending', 'retryable', { lastErrorClass: errorClass, lastFailedAt: now().toISOString() }),
    markFailed: (id, errorClass) => transition(id, 'sending', 'failed', { lastErrorClass: errorClass, failedAt: now().toISOString() }),
    markDeliveryUnknown: (id, errorClass) => transition(id, 'sending', 'delivery_unknown', { lastErrorClass: errorClass, deliveryUnknownAt: now().toISOString() }),
  };
}

module.exports = { createOrderNotificationRepository, OrderNotificationRepositoryError, DEFAULT_TABLE };
