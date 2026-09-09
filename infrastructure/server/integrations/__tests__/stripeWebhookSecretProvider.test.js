'use strict';

const { createStripeWebhookSecretProvider } = require('../stripeWebhookSecretProvider');

describe('stripeWebhookSecretProvider', () => {
  test.each([
    'whsec_test_only_value',
    JSON.stringify({ STRIPE_WEBHOOK_SECRET: 'whsec_test_only_value' }),
  ])('reads and caches a dedicated webhook signing secret', async (SecretString) => {
    const client = { send: jest.fn().mockResolvedValue({ SecretString }) };
    const provider = createStripeWebhookSecretProvider({ client, secretArn: 'arn:aws:secretsmanager:us-east-1:911762440868:secret:test' });
    await expect(provider()).resolves.toBe('whsec_test_only_value');
    await expect(provider()).resolves.toBe('whsec_test_only_value');
    expect(client.send).toHaveBeenCalledTimes(1);
  });
  test('fails closed without configuration or a signing-secret value', async () => {
    await expect(createStripeWebhookSecretProvider({ client: {}, secretArn: '' })()).rejects.toThrow('configuration is unavailable');
    const provider = createStripeWebhookSecretProvider({ client: { send: jest.fn().mockResolvedValue({ SecretString: '{}' }) }, secretArn: 'arn:test' });
    await expect(provider()).rejects.toMatchObject({ code: 'WEBHOOK_SECRET_INVALID' });
  });
});
