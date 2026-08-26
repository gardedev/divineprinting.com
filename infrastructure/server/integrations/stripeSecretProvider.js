'use strict';

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

class StripeSecretError extends Error {
  constructor(message, cause) { super(message); this.name = 'StripeSecretError'; this.code = 'STRIPE_CONFIGURATION_INVALID'; if (cause) this.cause = cause; }
}

function createStripeSecretProvider({ client = new SecretsManagerClient({}), secretArn = process.env.STRIPE_SECRET_ARN } = {}) {
  if (typeof secretArn !== 'string' || !secretArn.trim()) throw new StripeSecretError('Stripe secret configuration is unavailable.');
  let cached;
  return async function getStripeSecret() {
    if (cached) return cached;
    try {
      const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn.trim() }));
      if (typeof response.SecretString !== 'string') throw new Error('SecretString is unavailable');
      const parsed = JSON.parse(response.SecretString);
      if (typeof parsed.STRIPE_SECRET_KEY !== 'string' || !parsed.STRIPE_SECRET_KEY.startsWith('sk_test_')) throw new Error('Test-mode key is unavailable');
      cached = parsed.STRIPE_SECRET_KEY;
      return cached;
    } catch (error) {
      throw new StripeSecretError('Stripe secret configuration is unavailable.', error);
    }
  };
}

module.exports = { createStripeSecretProvider, StripeSecretError };
