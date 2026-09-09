'use strict';

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

class StripeWebhookSecretError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'StripeWebhookSecretError';
    this.code = 'WEBHOOK_SECRET_INVALID';
    if (cause) this.cause = cause;
  }
}

function createStripeWebhookSecretProvider({
  client = new SecretsManagerClient({}),
  secretArn = process.env.STRIPE_WEBHOOK_SECRET_ARN,
} = {}) {
  let cached;
  return async function getStripeWebhookSecret() {
    if (cached) return cached;
    if (typeof secretArn !== 'string' || !secretArn.trim()) {
      throw new StripeWebhookSecretError('Stripe webhook secret configuration is unavailable.');
    }
    try {
      const response = await client.send(new GetSecretValueCommand({ SecretId: secretArn.trim() }));
      if (typeof response.SecretString !== 'string') throw new Error('SecretString is unavailable');
      let value = response.SecretString;
      try {
        const parsed = JSON.parse(value);
        value = parsed.STRIPE_WEBHOOK_SECRET;
      } catch (_error) {
        // A dedicated secret may contain the signing secret as its entire value.
      }
      if (typeof value !== 'string' || !value.startsWith('whsec_')) {
        throw new Error('Webhook signing secret is unavailable');
      }
      cached = value;
      return cached;
    } catch (error) {
      throw new StripeWebhookSecretError('Stripe webhook secret configuration is unavailable.', error);
    }
  };
}

module.exports = { createStripeWebhookSecretProvider, StripeWebhookSecretError };
