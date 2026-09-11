'use strict';

jest.mock('@aws-sdk/lib-dynamodb', () => ({ GetCommand: function(input){this.input=input;}, UpdateCommand: function(input){this.input=input;} }));
jest.mock('../../utils/dynamoDbClient', () => ({ docClient: {} }));
const { createOrderNotificationRepository } = require('../orderNotificationRepository');

describe('orderNotificationRepository', () => {
  test('claims only pending/retryable records with a bounded attempt count', async () => {
    const client = { send: jest.fn().mockResolvedValue({ Attributes: { notificationId: 'order-confirmation:o1', deliveryState: 'sending', attemptCount: 1 } }) };
    const result = await createOrderNotificationRepository({ client, now: () => new Date('2026-09-10T00:00:00Z') }).claimDelivery('order-confirmation:o1', 3);
    expect(result).toMatchObject({ deliveryState: 'sending', attemptCount: 1 });
    expect(client.send.mock.calls[0][0].input).toMatchObject({
      ConditionExpression: '(#state = :pending OR #state = :retryable) AND #attemptCount < :maxAttempts',
      ExpressionAttributeValues: expect.objectContaining({ ':maxAttempts': 3 }),
    });
  });
  test('a concurrent conditional failure is a safe no-op', async () => {
    const error = Object.assign(new Error('race'), { name: 'ConditionalCheckFailedException' });
    const client = { send: jest.fn().mockRejectedValue(error) };
    await expect(createOrderNotificationRepository({ client }).claimDelivery('order-confirmation:o1', 3)).resolves.toBeNull();
  });
  test.each([
    ['markSent', 'sent'], ['markRetryable', 'retryable'], ['markFailed', 'failed'], ['markDeliveryUnknown', 'delivery_unknown'],
  ])('%s conditionally leaves sending state for %s', async (method, expected) => {
    const client = { send: jest.fn().mockResolvedValue({}) };
    const repo = createOrderNotificationRepository({ client, now: () => new Date('2026-09-10T00:00:00Z') });
    await repo[method]('order-confirmation:o1', 'safe-value');
    expect(client.send.mock.calls[0][0].input).toMatchObject({ ConditionExpression: '#state = :fromState', ExpressionAttributeValues: expect.objectContaining({ ':fromState': 'sending', ':toState': expected }) });
  });
});
