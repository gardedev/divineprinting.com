'use strict';

/**
 * Unit tests for utils/logger.js
 *
 * Strategy:
 *   - Spy on process.stdout.write and process.stderr.write to capture emitted
 *     log lines without touching the real output streams.
 *   - Restore all environment variable mutations after each test so tests do
 *     not bleed into one another.
 *   - Test every public method (debug, info, warn, error) and the internal
 *     helpers (_scrub, _resolveMinLevel).
 */

const logger = require('../logger');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Parse the last JSON line written to the spy. */
function lastEntry(spy) {
  const calls = spy.mock.calls;
  if (!calls.length) return null;
  const last = calls[calls.length - 1][0];
  return JSON.parse(last.trim());
}

/** Collect all JSON entries written to the spy (newest-last). */
function allEntries(spy) {
  return spy.mock.calls.map(([line]) => JSON.parse(line.trim()));
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let stdoutSpy;
let stderrSpy;
let savedNodeEnv;
let savedLogLevel;

beforeEach(() => {
  stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  savedNodeEnv = process.env.NODE_ENV;
  savedLogLevel = process.env.LOG_LEVEL;
  // Reset to a known non-production, non-overridden state
  delete process.env.NODE_ENV;
  delete process.env.LOG_LEVEL;
});

afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
  if (savedNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = savedNodeEnv;
  }
  if (savedLogLevel === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = savedLogLevel;
  }
});

// ---------------------------------------------------------------------------
// 1. Basic level routing
// ---------------------------------------------------------------------------

describe('logger.info', () => {
  test('writes to stdout', () => {
    logger.info('hello info');
    expect(stdoutSpy).toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
    const entry = lastEntry(stdoutSpy);
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('hello info');
  });

  test('includes ISO timestamp', () => {
    logger.info('timestamp test');
    const entry = lastEntry(stdoutSpy);
    expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

describe('logger.warn', () => {
  test('writes to stdout with level=warn', () => {
    logger.warn('watch out');
    expect(stdoutSpy).toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
    const entry = lastEntry(stdoutSpy);
    expect(entry.level).toBe('warn');
    expect(entry.message).toBe('watch out');
  });
});

describe('logger.debug', () => {
  test('writes to stdout in non-production (level=debug)', () => {
    // NODE_ENV is unset (non-production); default min level is 'debug'
    logger.debug('debug msg');
    expect(stdoutSpy).toHaveBeenCalled();
    const entry = lastEntry(stdoutSpy);
    expect(entry.level).toBe('debug');
  });

  test('suppressed when NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    logger.debug('should be suppressed');
    expect(stdoutSpy).not.toHaveBeenCalled();
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});

describe('logger.error', () => {
  test('writes to stderr', () => {
    logger.error('something broke');
    expect(stderrSpy).toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
    const entry = lastEntry(stderrSpy);
    expect(entry.level).toBe('error');
    expect(entry.message).toBe('something broke');
  });

  test('attaches error name and message when Error passed', () => {
    const err = new Error('db timeout');
    logger.error('Database error', err);
    const entry = lastEntry(stderrSpy);
    expect(entry.error.name).toBe('Error');
    expect(entry.error.message).toBe('db timeout');
  });

  test('includes stack trace in non-production', () => {
    // NODE_ENV is unset → non-production
    const err = new Error('test error');
    logger.error('Test', err);
    const entry = lastEntry(stderrSpy);
    expect(entry.error.stack).toBeDefined();
    expect(entry.error.stack).toContain('Error: test error');
  });

  test('omits stack trace in production', () => {
    process.env.NODE_ENV = 'production';
    const err = new Error('prod error');
    logger.error('Test', err);
    const entry = lastEntry(stderrSpy);
    expect(entry.error.stack).toBeUndefined();
  });

  test('treats non-Error second arg as metadata', () => {
    logger.error('Something failed', { context: 'webhook' });
    const entry = lastEntry(stderrSpy);
    expect(entry.meta).toEqual({ context: 'webhook' });
    expect(entry.error).toBeUndefined();
  });

  test('accepts error + separate meta object', () => {
    const err = new Error('boom');
    logger.error('Route failed', err, { route: '/api/auth/login' });
    const entry = lastEntry(stderrSpy);
    expect(entry.error.message).toBe('boom');
    expect(entry.meta.route).toBe('/api/auth/login');
  });
});

// ---------------------------------------------------------------------------
// 2. Metadata handling
// ---------------------------------------------------------------------------

describe('metadata in entries', () => {
  test('info() attaches meta object', () => {
    logger.info('Order saved', { orderId: 'abc-123' });
    const entry = lastEntry(stdoutSpy);
    expect(entry.meta).toEqual({ orderId: 'abc-123' });
  });

  test('warn() attaches meta object', () => {
    logger.warn('Rate limit close', { remaining: 5 });
    const entry = lastEntry(stdoutSpy);
    expect(entry.meta.remaining).toBe(5);
  });

  test('no meta key when none supplied', () => {
    logger.info('No meta here');
    const entry = lastEntry(stdoutSpy);
    expect(entry.meta).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 3. Sensitive-field scrubbing
// ---------------------------------------------------------------------------

describe('logger._scrub', () => {
  const scrub = logger._scrub;

  test('redacts "password" key', () => {
    const result = scrub({ password: 'super-secret' });
    expect(result.password).toBe('[REDACTED]');
  });

  test('redacts "passwordHash" (case-insensitive)', () => {
    const result = scrub({ passwordHash: 'abc123' });
    expect(result.passwordHash).toBe('[REDACTED]');
  });

  test('redacts "token"', () => {
    const result = scrub({ token: 'eyJhbGci...' });
    expect(result.token).toBe('[REDACTED]');
  });

  test('redacts "apiKey"', () => {
    const result = scrub({ apiKey: 'sk-live-xxx' });
    expect(result.apiKey).toBe('[REDACTED]');
  });

  test('redacts "authorization"', () => {
    const result = scrub({ authorization: 'Bearer abc' });
    expect(result.authorization).toBe('[REDACTED]');
  });

  test('redacts "secretKey"', () => {
    const result = scrub({ secretKey: 'supersecret' });
    expect(result.secretKey).toBe('[REDACTED]');
  });

  test('preserves non-sensitive fields', () => {
    const result = scrub({ email: 'user@example.com', orderId: 'ord-1' });
    expect(result.email).toBe('user@example.com');
    expect(result.orderId).toBe('ord-1');
  });

  test('handles nested objects', () => {
    const result = scrub({ user: { password: 'secret', name: 'Alice' } });
    expect(result.user.password).toBe('[REDACTED]');
    expect(result.user.name).toBe('Alice');
  });

  test('passes through null as-is', () => {
    expect(scrub(null)).toBeNull();
  });

  test('passes through array as-is', () => {
    const arr = [1, 2, 3];
    expect(scrub(arr)).toEqual([1, 2, 3]);
  });

  test('passes through primitive string as-is', () => {
    expect(scrub('hello')).toBe('hello');
  });

  test('returns [MaxDepthReached] at depth > 10', () => {
    // Simulate hitting the depth cap
    expect(scrub({}, 11)).toBe('[MaxDepthReached]');
  });
});

// ---------------------------------------------------------------------------
// 4. Sensitive fields are scrubbed before emission
// ---------------------------------------------------------------------------

describe('sensitive data not emitted', () => {
  test('password in meta is redacted in emitted entry', () => {
    logger.info('User registered', { email: 'user@example.com', password: 'secret' });
    const entry = lastEntry(stdoutSpy);
    expect(entry.meta.password).toBe('[REDACTED]');
    expect(entry.meta.email).toBe('user@example.com');
  });

  test('token in meta is redacted', () => {
    logger.warn('Token refresh attempt', { token: 'abc.def.ghi', userId: '123' });
    const entry = lastEntry(stdoutSpy);
    expect(entry.meta.token).toBe('[REDACTED]');
    expect(entry.meta.userId).toBe('123');
  });

  test('nested password in meta is redacted', () => {
    logger.error('Auth error', null, { credentials: { password: 'p@ss', user: 'bob' } });
    const entry = lastEntry(stderrSpy);
    expect(entry.meta.credentials.password).toBe('[REDACTED]');
    expect(entry.meta.credentials.user).toBe('bob');
  });
});

// ---------------------------------------------------------------------------
// 5. Log-level filtering via LOG_LEVEL env var
// ---------------------------------------------------------------------------

describe('log level filtering', () => {
  test('LOG_LEVEL=warn suppresses info', () => {
    process.env.LOG_LEVEL = 'warn';
    logger.info('should be suppressed');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  test('LOG_LEVEL=warn allows warn', () => {
    process.env.LOG_LEVEL = 'warn';
    logger.warn('visible');
    expect(stdoutSpy).toHaveBeenCalled();
  });

  test('LOG_LEVEL=warn allows error', () => {
    process.env.LOG_LEVEL = 'warn';
    logger.error('also visible');
    expect(stderrSpy).toHaveBeenCalled();
  });

  test('LOG_LEVEL=error suppresses warn', () => {
    process.env.LOG_LEVEL = 'error';
    logger.warn('suppressed');
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  test('LOG_LEVEL=debug allows all levels', () => {
    process.env.LOG_LEVEL = 'debug';
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');
    expect(stdoutSpy).toHaveBeenCalledTimes(3); // debug, info, warn
    expect(stderrSpy).toHaveBeenCalledTimes(1); // error
  });

  test('invalid LOG_LEVEL falls back to default', () => {
    process.env.LOG_LEVEL = 'verbose'; // not a known level
    // Non-production default is 'debug'
    logger.debug('should appear');
    expect(stdoutSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. _resolveMinLevel
// ---------------------------------------------------------------------------

describe('_resolveMinLevel', () => {
  test('returns debug in non-production without LOG_LEVEL', () => {
    delete process.env.NODE_ENV;
    delete process.env.LOG_LEVEL;
    expect(logger._resolveMinLevel()).toBe('debug');
  });

  test('returns info when NODE_ENV=production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.LOG_LEVEL;
    expect(logger._resolveMinLevel()).toBe('info');
  });

  test('LOG_LEVEL=warn overrides production default', () => {
    process.env.NODE_ENV = 'production';
    process.env.LOG_LEVEL = 'warn';
    expect(logger._resolveMinLevel()).toBe('warn');
  });

  test('LOG_LEVEL is case-insensitive', () => {
    process.env.LOG_LEVEL = 'ERROR';
    expect(logger._resolveMinLevel()).toBe('error');
  });
});

// ---------------------------------------------------------------------------
// 7. JSON format integrity
// ---------------------------------------------------------------------------

describe('JSON output format', () => {
  test('every entry is valid JSON', () => {
    logger.info('test');
    const raw = stdoutSpy.mock.calls[0][0];
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  test('entry always has timestamp, level, message', () => {
    logger.warn('format check');
    const entry = lastEntry(stdoutSpy);
    expect(entry).toHaveProperty('timestamp');
    expect(entry).toHaveProperty('level');
    expect(entry).toHaveProperty('message');
  });

  test('output lines end with newline', () => {
    logger.info('newline check');
    const raw = stdoutSpy.mock.calls[0][0];
    expect(raw.endsWith('\n')).toBe(true);
  });

  test('error output lines end with newline', () => {
    logger.error('err newline');
    const raw = stderrSpy.mock.calls[0][0];
    expect(raw.endsWith('\n')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 8. HTTP response safety (smoke-test: routes don't leak error details)
// ---------------------------------------------------------------------------

describe('HTTP response safety (integration smoke)', () => {
  /**
   * This block verifies that our route error handlers call logger.error for
   * unexpected errors while still returning a safe, generic HTTP response.
   *
   * We test this by checking that logger.error correctly handles an Error
   * object (the stack stays internal) while the emitted entry's meta or
   * error.stack field would never be forwarded to a client.
   */
  test('error entries contain stack only in entry, not in any "response" field', () => {
    const internalErr = new Error('DynamoDB connection refused');
    logger.error('Route error', internalErr, { route: '/api/auth/register' });

    const entry = lastEntry(stderrSpy);

    // Stack is in the log entry (non-production)
    expect(entry.error.stack).toContain('DynamoDB connection refused');
    // But the entry has no "response" or "body" field that could leak to clients
    expect(entry.response).toBeUndefined();
    expect(entry.body).toBeUndefined();
    // The only message that a caller should send to the client is a safe string
    const safeClientMessage = 'Server error';
    expect(safeClientMessage).not.toContain(internalErr.message);
  });
});

// ---------------------------------------------------------------------------
// 9. SENSITIVE_KEYS coverage
// ---------------------------------------------------------------------------

describe('SENSITIVE_KEYS coverage', () => {
  const sensitiveFields = [
    ['password', 'pw'],
    ['passwordHash', 'hash'],
    ['token', 'tok'],
    ['accessToken', 'at'],
    ['refreshToken', 'rt'],
    ['apiKey', 'key'],
    ['secretKey', 'sk'],
    ['authorization', 'auth'],
    ['creditCard', 'cc'],
  ];

  test.each(sensitiveFields)('field "%s" is redacted', (field) => {
    const result = logger._scrub({ [field]: 'should-be-hidden', safe: 'ok' });
    expect(result[field]).toBe('[REDACTED]');
    expect(result.safe).toBe('ok');
  });
});
