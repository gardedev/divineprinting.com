'use strict';

/**
 * logger.js — Lightweight structured logger for Divine Printing API.
 *
 * Provides levelled logging (info, warn, error, debug) without external
 * dependencies, keeping the infrastructure/server package lean.
 *
 * Key behaviours:
 *   - Writes structured JSON lines to stdout (info/warn/debug) and stderr
 *     (error) so log aggregators and process managers can separate streams.
 *   - Timestamps every entry with ISO-8601 UTC.
 *   - In non-production environments, error entries include full stack traces.
 *   - Sensitive field names (e.g. password, token, apiKey) are automatically
 *     scrubbed from any metadata object before the entry is emitted.
 *   - HTTP error responses never receive internal details; callers should
 *     always reply with a safe, generic message (see README / route files).
 *
 * Usage:
 *   const logger = require('./utils/logger');
 *
 *   logger.info('Server started', { port: 3000 });
 *   logger.warn('Deprecated endpoint used', { path: '/old' });
 *   logger.error('Database error', error, { context: 'register' });
 *   logger.debug('Parsed token payload', { email });   // only in non-production
 *
 * Environment:
 *   NODE_ENV=production  — debug entries are suppressed; error stacks omitted.
 *   LOG_LEVEL=debug|info|warn|error — overrides minimum log level
 *                                     (default: 'info' in production, 'debug'
 *                                      otherwise).
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Ordered log levels — lower index = more verbose. */
const LEVELS = ['debug', 'info', 'warn', 'error'];

/**
 * Returns true when running in a production environment.
 * Evaluated at call-time so that tests can change NODE_ENV between cases.
 *
 * @returns {boolean}
 */
function isProduction() {
  return process.env.NODE_ENV === 'production';
}

/**
 * Resolve the active minimum log level.
 *
 * Priority: LOG_LEVEL env var > default based on NODE_ENV.
 */
function resolveMinLevel() {
  const override = (process.env.LOG_LEVEL || '').toLowerCase().trim();
  if (LEVELS.includes(override)) {
    return override;
  }
  return isProduction() ? 'info' : 'debug';
}

// ---------------------------------------------------------------------------
// Sensitive-field scrubbing
// ---------------------------------------------------------------------------

/**
 * Field names (case-insensitive) whose values must never appear in logs.
 *
 * Add to this list whenever a new sensitive field is introduced to the schema.
 */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordhash',
  'passwordconfirm',
  'newpassword',
  'oldpassword',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'jwttoken',
  'jwtsecret',
  'apikey',
  'apikeyid',
  'secretkey',
  'secretaccesskey',
  'authorization',
  'authorizationheader',
  'bearertoken',
  'creditcard',
  'cardnumber',
  'cvv',
  'ssn',
]);

/**
 * Recursively scrubs sensitive fields from a plain-object metadata tree.
 *
 * Non-object values are returned as-is.  Circular references are not
 * supported (avoid passing raw Express request objects).
 *
 * @param {*} obj - Value to scrub.
 * @param {number} [depth=0] - Current recursion depth (hard-limit: 10).
 * @returns {*} Scrubbed clone of obj.
 */
function scrub(obj, depth = 0) {
  if (depth > 10) return '[MaxDepthReached]';
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
    return obj;
  }

  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = scrub(value, depth + 1);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Core emit function
// ---------------------------------------------------------------------------

/**
 * Builds and emits a single log entry.
 *
 * @param {'debug'|'info'|'warn'|'error'} level - Log level.
 * @param {string} message - Human-readable log message.
 * @param {Error|null} [error] - Optional error object (stack included in non-prod).
 * @param {Object|null} [meta] - Optional metadata key-value pairs (scrubbed).
 */
function emit(level, message, error, meta) {
  const minLevel = resolveMinLevel();
  if (LEVELS.indexOf(level) < LEVELS.indexOf(minLevel)) {
    return; // Suppress below minimum level
  }

  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: String(message),
  };

  // Attach scrubbed metadata
  if (meta && typeof meta === 'object') {
    entry.meta = scrub(meta);
  }

  // Attach error information
  if (error instanceof Error) {
    entry.error = {
      name: error.name,
      message: error.message,
    };
    // Include stack trace in non-production environments only
    if (!isProduction() && error.stack) {
      entry.error.stack = error.stack;
    }
  }

  const line = JSON.stringify(entry);

  // Errors go to stderr; everything else to stdout
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const logger = {
  /**
   * Log a debug-level message (suppressed in production).
   *
   * @param {string} message
   * @param {Object} [meta]
   */
  debug(message, meta) {
    emit('debug', message, null, meta);
  },

  /**
   * Log an informational message.
   *
   * @param {string} message
   * @param {Object} [meta]
   */
  info(message, meta) {
    emit('info', message, null, meta);
  },

  /**
   * Log a warning.
   *
   * @param {string} message
   * @param {Object} [meta]
   */
  warn(message, meta) {
    emit('warn', message, null, meta);
  },

  /**
   * Log an error.  If `errorOrMeta` is an Error instance it is attached with
   * stack trace (non-prod) and safe message.  If it is a plain object it is
   * treated as metadata.
   *
   * @param {string} message
   * @param {Error|Object} [errorOrMeta]
   * @param {Object} [meta]
   */
  error(message, errorOrMeta, meta) {
    if (errorOrMeta instanceof Error) {
      // error(msg, Error, meta?)
      emit('error', message, errorOrMeta, meta || null);
    } else if (errorOrMeta === null || errorOrMeta === undefined) {
      // error(msg, null, meta?) — explicit null means "no error object", use meta
      emit('error', message, null, meta || null);
    } else {
      // error(msg, metaObj) — non-Error second arg treated as metadata
      emit('error', message, null, errorOrMeta);
    }
  },

  // Expose internals for unit-testing purposes
  _scrub: scrub,
  _SENSITIVE_KEYS: SENSITIVE_KEYS,
  _LEVELS: LEVELS,
  _resolveMinLevel: resolveMinLevel,
};

module.exports = logger;
