'use strict';
// Trusted deployment configuration, never a browser-controlled authorization flag.
function storefrontMode(environment = process.env) {
  const value = environment.PUBLIC_STOREFRONT_MODE || 'quote_only';
  return value === 'commerce' ? 'commerce' : 'quote_only';
}
function assertBuildMode(environment = process.env) {
  if (environment.PUBLIC_STOREFRONT_MODE && !['quote_only', 'commerce'].includes(environment.PUBLIC_STOREFRONT_MODE)) throw new Error('Invalid PUBLIC_STOREFRONT_MODE');
  return storefrontMode(environment);
}
module.exports = { storefrontMode, assertBuildMode };
