'use strict';

const { createSesOrderConfirmationClient, validEmail, safeHeader } = require('../sesOrderConfirmationClient');
class Command { constructor(input) { this.input = input; } }

describe('sesOrderConfirmationClient', () => {
  test('sends through an injected SES client and returns only the message id', async () => {
    const client = { send: jest.fn().mockResolvedValue({ MessageId: 'provider-message-1', ignored: 'raw' }) };
    const provider = createSesOrderConfirmationClient({ client, SendEmailCommand: Command, sourceEmail: 'noreply@example.com' });
    await expect(provider.send({ to: 'buyer@example.com', subject: 'Order confirmation', html: '<p>Safe</p>', text: 'Safe' })).resolves.toEqual({ messageId: 'provider-message-1' });
    expect(client.send.mock.calls[0][0].input.Destination.ToAddresses).toEqual(['buyer@example.com']);
  });
  test.each([
    ['ThrottlingException', 'retryable'],
    ['MessageRejected', 'permanent'],
    ['UnknownProviderFailure', 'ambiguous'],
  ])('normalizes %s without exposing raw provider details', async (name, classification) => {
    const client = { send: jest.fn().mockRejectedValue(Object.assign(new Error('sensitive raw provider response'), { name })) };
    const provider = createSesOrderConfirmationClient({ client, SendEmailCommand: Command, sourceEmail: 'noreply@example.com' });
    await expect(provider.send({ to: 'buyer@example.com', subject: 'Safe', html: '<p>Safe</p>', text: 'Safe' })).rejects.toMatchObject({ classification });
  });
  test('treats a malformed provider response as ambiguous', async () => {
    const provider = createSesOrderConfirmationClient({ client: { send: jest.fn().mockResolvedValue({}) }, SendEmailCommand: Command, sourceEmail: 'noreply@example.com' });
    await expect(provider.send({ to: 'buyer@example.com', subject: 'Safe', html: '<p>Safe</p>', text: 'Safe' })).rejects.toMatchObject({ classification: 'ambiguous' });
  });
  test('times out as ambiguous and aborts the provider request', async () => {
    const client = { send: jest.fn((_command, { abortSignal }) => new Promise((_resolve, reject) => abortSignal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))) };
    const provider = createSesOrderConfirmationClient({ client, SendEmailCommand: Command, sourceEmail: 'noreply@example.com', timeoutMs: 1 });
    await expect(provider.send({ to: 'buyer@example.com', subject: 'Safe', html: '<p>Safe</p>', text: 'Safe' })).rejects.toMatchObject({ classification: 'ambiguous', code: 'EMAIL_PROVIDER_TIMEOUT' });
  });
  test('rejects invalid destinations and header injection before provider use', async () => {
    expect(validEmail('buyer\r\n@example.com')).toBe(false);
    expect(() => safeHeader('Order\r\nBcc: victim@example.com')).toThrow();
    const client = { send: jest.fn() };
    const provider = createSesOrderConfirmationClient({ client, SendEmailCommand: Command, sourceEmail: 'noreply@example.com' });
    await expect(provider.send({ to: 'bad\n@example.com', subject: 'Safe', html: 'x', text: 'x' })).rejects.toMatchObject({ classification: 'permanent' });
    expect(client.send).not.toHaveBeenCalled();
  });
});
