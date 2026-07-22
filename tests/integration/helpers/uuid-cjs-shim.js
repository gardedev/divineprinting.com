'use strict';
/**
 * CJS shim for uuid used only in integration tests.
 * uuid v14 ships pure ESM which Jest (on Node < 24.9) cannot require().
 * This shim re-exports the subset used by the codebase (v4) via the
 * built-in crypto.randomUUID() so no native ESM import is needed.
 */
module.exports = {
  v4: () => require('crypto').randomUUID(),
};
