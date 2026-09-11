'use strict';

const { createHandler, notificationIdFromRecord } = require('../orderConfirmationLambda');

function record(eventID, state = 'order_confirmation', eventName = 'INSERT') {
  return { eventID, eventName, dynamodb: { NewImage: { notificationType: { S: state }, notificationId: { S: `order-confirmation:${eventID}` } } } };
}

describe('orderConfirmationLambda', () => {
  test('processes only inserted order-confirmation records', async () => {
    const service = { processNotification: jest.fn().mockResolvedValue({ state: 'sent' }) };
    const result = await createHandler({ service })({ Records: [record('1'), record('2', 'other'), record('3', 'order_confirmation', 'MODIFY')] });
    expect(service.processNotification).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ batchItemFailures: [] });
    expect(notificationIdFromRecord(record('1'))).toBe('order-confirmation:1');
  });
  test('returns partial batch failures only for retryable delivery errors', async () => {
    const service = { processNotification: jest.fn().mockRejectedValueOnce(Object.assign(new Error('retry'), { retryable: true })).mockResolvedValueOnce({ state: 'sent' }) };
    await expect(createHandler({ service })({ Records: [record('retry'), record('ok')] })).resolves.toEqual({ batchItemFailures: [{ itemIdentifier: 'retry' }] });
  });
  test('does not retry permanent or ambiguous terminal outcomes', async () => {
    const service = { processNotification: jest.fn().mockResolvedValueOnce({ state: 'failed' }).mockResolvedValueOnce({ state: 'delivery_unknown' }) };
    await expect(createHandler({ service })({ Records: [record('failed'), record('unknown')] })).resolves.toEqual({ batchItemFailures: [] });
  });
});
