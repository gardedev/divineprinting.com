'use strict';
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(),
  GetSecretValueCommand: function(input) { this.input = input; },
}));
const { createStripeSecretProvider } = require('../stripeSecretProvider');

describe('stripeSecretProvider', () => {
  test('retrieves the exact secret ARN once and caches only in memory', async () => {
    const client = { send: jest.fn().mockResolvedValue({ SecretString: JSON.stringify({ STRIPE_SECRET_KEY: 'sk_test_safe' }) }) };
    const provider = createStripeSecretProvider({ client, secretArn: 'arn:aws:secretsmanager:us-east-1:911762440868:secret:divine-printing/stripe/checkout/test-AbCd' });
    await expect(provider()).resolves.toBe('sk_test_safe'); await provider();
    expect(client.send).toHaveBeenCalledTimes(1); expect(client.send.mock.calls[0][0].input.SecretId).toContain('/stripe/checkout/test-');
  });
  test('fails safely for missing, malformed, or live-mode secrets', async () => {
    expect(() => createStripeSecretProvider({ client: {}, secretArn: '' })).toThrow('Stripe secret configuration is unavailable.');
    for (const SecretString of ['{}', '{bad', JSON.stringify({ STRIPE_SECRET_KEY: 'sk_live_forbidden' })]) {
      const provider = createStripeSecretProvider({ client: { send: jest.fn().mockResolvedValue({ SecretString }) }, secretArn: 'arn:test' });
      await expect(provider()).rejects.toMatchObject({ code: 'STRIPE_CONFIGURATION_INVALID', message: 'Stripe secret configuration is unavailable.' });
    }
  });
});
