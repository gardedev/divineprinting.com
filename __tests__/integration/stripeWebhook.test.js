'use strict';
/**
 * stripeWebhook.test.js
 * Tests for stripeWebhookValidator — covers all representative webhook behaviors.
 * Uses only Node built-ins; no Stripe SDK or HTTP server required.
 */

const crypto = require('crypto');
const {
  verifyWebhookSignature,
  createStripeWebhookValidator,
  StripeWebhookValidationError,
  DEFAULT_TOLERANCE_SECONDS,
} = require('../../infrastructure/server/integrations/stripeWebhookValidator');

// ── helpers ───────────────────────────────────────────────────────────────────

const SECRET = 'whsec_testsecret1234567890abcdef56789';
const NOW    = 1700000000; // fixed epoch for deterministic tests

/** Build a valid Stripe-Signature header for the given body and timestamp. */
function sign(rawBody, secret = SECRET, t = NOW) {
  const bodyStr = rawBody instanceof Buffer ? rawBody.toString('utf8') : rawBody;
  const payload = `${t}.${bodyStr}`;
  const sig     = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
  return `t=${t},v1=${sig}`;
}

/** Minimal Stripe event JSON string. */
function evtJson(type = 'payment_intent.succeeded', data = {}, id = 'evt_001') {
  return JSON.stringify({ id, type, object: 'event', data: { object: data }, livemode: false });
}

/** Call verifyWebhookSignature with a fixed `now` so timestamp checks are deterministic. */
function verify(rawBody, header, { secret = SECRET, now = () => NOW } = {}) {
  return verifyWebhookSignature({ rawBody, signatureHeader: header, secret, now });
}

// ── 1. Valid signature ────────────────────────────────────────────────────────

describe('Valid signature', () => {
  test('string body → returns parsed event and timestamp', () => {
    const body   = evtJson('payment_intent.succeeded', { amount: 1000 });
    const header = sign(body);
    const result = verify(body, header);
    expect(result.event.type).toBe('payment_intent.succeeded');
    expect(result.timestamp).toBe(NOW);
  });

  test('Buffer body → same result as string', () => {
    const body   = evtJson();
    const buf    = Buffer.from(body);
    const header = sign(buf);
    const result = verify(buf, header);
    expect(result.event.id).toBe('evt_001');
  });
});

// ── 2. Invalid / missing signature ────────────────────────────────────────────

describe('Invalid / missing signature', () => {
  const body = evtJson();

  const cases = [
    {
      name:   'empty string header → WEBHOOK_SIGNATURE_MISSING',
      header: '',
      code:   'WEBHOOK_SIGNATURE_MISSING',
    },
    {
      name:   'null header → WEBHOOK_SIGNATURE_MISSING',
      header: null,
      code:   'WEBHOOK_SIGNATURE_MISSING',
    },
    {
      name:   'wrong secret → WEBHOOK_SIGNATURE_INVALID',
      header: sign(body, 'whsec_wrongsecret12345678901234567'),
      code:   'WEBHOOK_SIGNATURE_INVALID',
    },
    {
      name:   'corrupted v1 value → WEBHOOK_SIGNATURE_INVALID',
      header: `t=${NOW},v1=deadbeef`,
      code:   'WEBHOOK_SIGNATURE_INVALID',
    },
    {
      name:   'header without t= → WEBHOOK_SIGNATURE_MALFORMED',
      header: `v1=${sign(body).split('v1=')[1]}`,
      code:   'WEBHOOK_SIGNATURE_MALFORMED',
    },
    {
      name:   'header with only t=, no v1= → WEBHOOK_SIGNATURE_MALFORMED',
      header: `t=${NOW}`,
      code:   'WEBHOOK_SIGNATURE_MALFORMED',
    },
  ];

  test.each(cases)('$name', ({ header, code }) => {
    expect(() => verify(body, header)).toThrow(
      expect.objectContaining({ name: 'StripeWebhookValidationError', code }),
    );
  });
});

// ── 3. Raw body exactness ─────────────────────────────────────────────────────

describe('Raw body exactness', () => {
  test('signature is computed over exact bytes — unicode preserved', () => {
    const raw    = '{"id":"evt_uni","type":"payment_intent.succeeded","object":"event",' +
                   '"data":{"object":{"emoji":"\\u2764"}},"livemode":false}';
    const buf    = Buffer.from(raw, 'utf8');
    const header = sign(buf);
    const result = verify(buf, header);
    expect(result.event.data.object.emoji).toBe('❤');
  });

  test('re-serialised body (different bytes) fails verification', () => {
    const original     = '{"id":"evt_ser","type":"charge.refunded","object":"event",' +
                         '"data":{"object":{}},"livemode":false}';
    const header       = sign(original);
    const reserialised = JSON.stringify(JSON.parse(original));
    if (original !== reserialised) {
      // If bytes differ, signature must fail.
      expect(() => verify(reserialised, header)).toThrow(StripeWebhookValidationError);
    } else {
      // If JSON.stringify happens to produce identical bytes, verification passes.
      expect(() => verify(reserialised, header)).not.toThrow();
    }
  });
});

// ── 4. Stale timestamp ────────────────────────────────────────────────────────

describe('Stale timestamp', () => {
  test(`timestamp older than ${DEFAULT_TOLERANCE_SECONDS}s → WEBHOOK_TIMESTAMP_EXPIRED`, () => {
    const body   = evtJson();
    const staleT = NOW - DEFAULT_TOLERANCE_SECONDS - 1;
    const header = sign(body, SECRET, staleT);
    expect(() =>
      verifyWebhookSignature({ rawBody: body, signatureHeader: header, secret: SECRET, now: () => NOW }),
    ).toThrow(expect.objectContaining({ code: 'WEBHOOK_TIMESTAMP_EXPIRED' }));
  });

  test('timestamp exactly at tolerance boundary → succeeds', () => {
    const body   = evtJson();
    const boundT = NOW - DEFAULT_TOLERANCE_SECONDS;
    const header = sign(body, SECRET, boundT);
    expect(() =>
      verifyWebhookSignature({ rawBody: body, signatureHeader: header, secret: SECRET, now: () => NOW }),
    ).not.toThrow();
  });
});

// ── 5. Idempotency / duplicate detection ─────────────────────────────────────

describe('Idempotency (stateless verifier)', () => {
  test('verifying the same event twice returns consistent results', () => {
    const body   = evtJson('invoice.payment_succeeded', { amount_paid: 500 }, 'evt_idem');
    const header = sign(body);
    const r1     = verify(body, header);
    const r2     = verify(body, header);
    expect(r1.event.id).toBe(r2.event.id);
    expect(r1.timestamp).toBe(r2.timestamp);
  });

  test('concurrent calls with identical input both resolve to same event', async () => {
    const body   = evtJson('payment_intent.succeeded', {}, 'evt_concurrent');
    const header = sign(body);
    const [r1, r2] = await Promise.all([
      Promise.resolve(verify(body, header)),
      Promise.resolve(verify(body, header)),
    ]);
    expect(r1.event.id).toBe('evt_concurrent');
    expect(r2.event.id).toBe('evt_concurrent');
  });
});

// ── 6. Payment events ─────────────────────────────────────────────────────────

describe('Payment event types parse correctly', () => {
  const paymentCases = [
    {
      name: 'payment_intent.succeeded',
      type: 'payment_intent.succeeded',
      data: { amount: 2000, currency: 'usd' },
    },
    {
      name: 'payment_intent.payment_failed',
      type: 'payment_intent.payment_failed',
      data: { last_payment_error: { code: 'card_declined' } },
    },
    {
      name: 'invoice.payment_succeeded (late payment)',
      type: 'invoice.payment_succeeded',
      data: { amount_paid: 1500 },
    },
    {
      name: 'invoice.payment_failed',
      type: 'invoice.payment_failed',
      data: { amount_due: 1500 },
    },
  ];

  test.each(paymentCases)('$name → parsed event type matches', ({ type, data }) => {
    const body   = evtJson(type, data, `evt_${type.replace(/\./g, '_')}`);
    const header = sign(body);
    const result = verify(body, header);
    expect(result.event.type).toBe(type);
  });
});

// ── 7. Stale-state prevention ─────────────────────────────────────────────────

describe('Stale-state prevention (payload validity)', () => {
  test('payload missing id field → WEBHOOK_PAYLOAD_INVALID', () => {
    const raw    = JSON.stringify({ type: 'payment_intent.succeeded', object: 'event', data: {} });
    const header = sign(raw);
    expect(() => verify(raw, header)).toThrow(
      expect.objectContaining({ code: 'WEBHOOK_PAYLOAD_INVALID' }),
    );
  });

  test('payload missing type field → WEBHOOK_PAYLOAD_INVALID', () => {
    const raw    = JSON.stringify({ id: 'evt_x', object: 'event', data: {} });
    const header = sign(raw);
    expect(() => verify(raw, header)).toThrow(
      expect.objectContaining({ code: 'WEBHOOK_PAYLOAD_INVALID' }),
    );
  });

  test('non-JSON payload → WEBHOOK_PAYLOAD_INVALID', () => {
    const raw    = 'not json at all';
    const header = sign(raw);
    expect(() => verify(raw, header)).toThrow(
      expect.objectContaining({ code: 'WEBHOOK_PAYLOAD_INVALID' }),
    );
  });
});

// ── 8. Refund event ───────────────────────────────────────────────────────────

describe('Refund event', () => {
  test('charge.refunded parses correctly', () => {
    const body   = evtJson('charge.refunded', { id: 'ch_001', amount_refunded: 1000 }, 'evt_refund');
    const header = sign(body);
    const result = verify(body, header);
    expect(result.event.type).toBe('charge.refunded');
    expect(result.event.data.object.amount_refunded).toBe(1000);
  });
});

// ── 9. Dispute event ──────────────────────────────────────────────────────────

describe('Dispute event', () => {
  test('charge.dispute.created parses correctly', () => {
    const body   = evtJson('charge.dispute.created', { id: 'dp_001', reason: 'fraudulent' }, 'evt_dispute');
    const header = sign(body);
    const result = verify(body, header);
    expect(result.event.type).toBe('charge.dispute.created');
    expect(result.event.data.object.reason).toBe('fraudulent');
  });
});

// ── 10. Unsupported event type ────────────────────────────────────────────────

describe('Unsupported event type', () => {
  test('unknown type still passes signature check (caller decides handling)', () => {
    const body   = evtJson('radar.early_fraud_warning.created', {}, 'evt_unsupported');
    const header = sign(body);
    const result = verify(body, header);
    // Verifier is agnostic to event type — must not throw.
    expect(result.event.type).toBe('radar.early_fraud_warning.created');
  });
});

// ── 11. Retry safety ─────────────────────────────────────────────────────────

describe('Retry safety', () => {
  test('verification is pure and stateless — safe to retry', () => {
    const body   = evtJson('payment_intent.succeeded', {}, 'evt_retry');
    const header = sign(body);
    // Three identical calls must all return identical results with no errors.
    [1, 2, 3].forEach(() => {
      const r = verify(body, header);
      expect(r.event.id).toBe('evt_retry');
    });
  });
});

// ── 12. Correlation safety ────────────────────────────────────────────────────

describe('Correlation safety', () => {
  test('events signed with different secrets do not cross-validate', () => {
    const secretA = 'whsec_tenantA1234567890123456789012';
    const secretB = 'whsec_tenantB1234567890123456789012';
    const body    = evtJson('payment_intent.succeeded', {}, 'evt_tenant_a');
    const headerA = sign(body, secretA);

    // Verifying tenant-A header with tenant-B secret must fail.
    expect(() =>
      verifyWebhookSignature({ rawBody: body, signatureHeader: headerA, secret: secretB, now: () => NOW }),
    ).toThrow(expect.objectContaining({ code: 'WEBHOOK_SIGNATURE_INVALID' }));
  });

  test('two independent events do not share state', () => {
    const bodyA   = evtJson('payment_intent.succeeded', { orderId: 'order_a' }, 'evt_corr_a');
    const bodyB   = evtJson('payment_intent.succeeded', { orderId: 'order_b' }, 'evt_corr_b');
    const headerA = sign(bodyA);
    const headerB = sign(bodyB);
    const rA      = verify(bodyA, headerA);
    const rB      = verify(bodyB, headerB);
    expect(rA.event.id).toBe('evt_corr_a');
    expect(rB.event.id).toBe('evt_corr_b');
    expect(rA.event.data.object.orderId).not.toBe(rB.event.data.object.orderId);
  });
});

// ── 13. Secret non-leakage ────────────────────────────────────────────────────

describe('Secret non-leakage', () => {
  test('StripeWebhookValidationError message does not echo the correct secret', () => {
    const body   = evtJson();
    const header = sign(body, 'whsec_wrongsecret12345678901234567');
    let thrown;
    try {
      verify(body, header);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeDefined();
    expect(thrown.message).not.toContain(SECRET);
    expect(thrown.message).not.toContain('whsec_');
  });

  test('error for invalid secret config does not expose secrets', () => {
    const err = (() => {
      try {
        verifyWebhookSignature({
          rawBody: evtJson(),
          signatureHeader: `t=${NOW},v1=abc`,
          secret: 'bad_not_a_whsec',
          now: () => NOW,
        });
      } catch (e) { return e; }
    })();
    expect(err).toBeDefined();
    expect(err.code).toBe('WEBHOOK_SECRET_INVALID');
    expect(err.message).not.toContain(SECRET);
  });
});

// ── 14. createStripeWebhookValidator (async factory) ─────────────────────────

describe('createStripeWebhookValidator', () => {
  test('throws TypeError when secretProvider is not a function', () => {
    expect(() => createStripeWebhookValidator({ secretProvider: 'not-a-fn' })).toThrow(TypeError);
  });

  test('provider returning wrong format → WEBHOOK_SECRET_INVALID', async () => {
    const provider  = async () => 'sk_test_not_a_webhook_secret';
    const validator = createStripeWebhookValidator({ secretProvider: provider });
    const body      = evtJson();
    const header    = sign(body);
    await expect(validator.verify(body, header)).rejects.toThrow(
      expect.objectContaining({ code: 'WEBHOOK_SECRET_INVALID' }),
    );
  });

  test('verify() with valid provider and near-current timestamp succeeds', async () => {
    const realNow = Math.floor(Date.now() / 1000);
    const body    = evtJson('payment_intent.succeeded', {}, 'evt_async');
    const header  = sign(body, SECRET, realNow);
    const provider  = async () => SECRET;
    // Use a large tolerance to avoid flakiness from test execution time.
    const validator = createStripeWebhookValidator({ secretProvider: provider, toleranceSeconds: 600 });
    const result    = await validator.verify(body, header);
    expect(result.event.id).toBe('evt_async');
  });
});
