'use strict';

const DEFAULT_TIMEOUT_MS = 8000;
const RETRYABLE_NAMES = new Set(['ThrottlingException', 'TooManyRequestsException', 'ServiceUnavailableException', 'InternalFailure', 'RequestTimeout']);
const PERMANENT_NAMES = new Set(['MessageRejected', 'MailFromDomainNotVerifiedException', 'ConfigurationSetDoesNotExistException', 'AccountSendingPausedException']);

class OrderEmailProviderError extends Error {
  constructor(code, classification, cause) {
    super('Order confirmation provider request failed.');
    this.name = 'OrderEmailProviderError';
    this.code = code;
    this.classification = classification;
    if (cause) this.cause = cause;
  }
}

function validEmail(value) {
  return typeof value === 'string' && value.length <= 254 && !/[\r\n]/.test(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function safeHeader(value, max = 200) {
  if (typeof value !== 'string' || !value || value.length > max || /[\r\n]/.test(value)) throw new OrderEmailProviderError('EMAIL_HEADER_INVALID', 'permanent');
  return value;
}

function defaultSdk() {
  // AWS Lambda Node.js runtimes provide AWS SDK v3. Loading lazily keeps tests provider-free.
  return require('@aws-sdk/client-ses');
}

function createSesOrderConfirmationClient({ client, SendEmailCommand, sourceEmail = process.env.SES_SENDER_EMAIL, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  let ses = client;
  let Command = SendEmailCommand;
  if (!ses || !Command) {
    const sdk = defaultSdk();
    ses = ses || new sdk.SESClient({});
    Command = Command || sdk.SendEmailCommand;
  }
  if (!validEmail(sourceEmail)) throw new OrderEmailProviderError('EMAIL_CONFIGURATION_INVALID', 'permanent');

  async function send({ to, subject, html, text }) {
    if (!validEmail(to)) throw new OrderEmailProviderError('EMAIL_DESTINATION_INVALID', 'permanent');
    safeHeader(subject);
    if (typeof html !== 'string' || typeof text !== 'string' || !html || !text) throw new OrderEmailProviderError('EMAIL_CONTENT_INVALID', 'permanent');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await ses.send(new Command({
        Source: sourceEmail,
        Destination: { ToAddresses: [to] },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: { Html: { Data: html, Charset: 'UTF-8' }, Text: { Data: text, Charset: 'UTF-8' } },
        },
      }), { abortSignal: controller.signal });
      if (!result || typeof result.MessageId !== 'string' || !result.MessageId) {
        throw new OrderEmailProviderError('EMAIL_PROVIDER_RESPONSE_AMBIGUOUS', 'ambiguous');
      }
      return { messageId: result.MessageId };
    } catch (error) {
      if (error instanceof OrderEmailProviderError) throw error;
      if (error?.name === 'AbortError' || controller.signal.aborted) throw new OrderEmailProviderError('EMAIL_PROVIDER_TIMEOUT', 'ambiguous', error);
      if (RETRYABLE_NAMES.has(error?.name)) throw new OrderEmailProviderError('EMAIL_PROVIDER_TEMPORARY', 'retryable', error);
      if (PERMANENT_NAMES.has(error?.name)) throw new OrderEmailProviderError('EMAIL_PROVIDER_REJECTED', 'permanent', error);
      throw new OrderEmailProviderError('EMAIL_PROVIDER_OUTCOME_UNKNOWN', 'ambiguous', error);
    } finally {
      clearTimeout(timer);
    }
  }

  return { send };
}

module.exports = { createSesOrderConfirmationClient, OrderEmailProviderError, validEmail, safeHeader, DEFAULT_TIMEOUT_MS };
