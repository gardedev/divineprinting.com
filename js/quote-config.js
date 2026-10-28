/* Public browser form settings only. Account CAPTCHA secrets never belong here. */
(function (root) {
  'use strict';
  const config = Object.freeze({ endpoint: 'https://formspree.io/f/xqeydkya', sitekey: 'a5f28750-0a52-40f2-a1b0-eee4c19022ae', thankYouUrl: '/thank-you.html', timeoutMs: 15000 });
  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.DivineQuoteConfig = config;
})(globalThis);
