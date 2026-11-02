'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { addMetaTracking } = require('../scripts/meta-tracking');
const { buildStatic } = require('../scripts/build-static');
const root = path.resolve(__dirname, '..');
test('all public build pages have one shared consent-controlled tracker and unchanged GTM boundary', () => {
  const files = buildStatic(root, { mode: 'quote_only' });
  for (const file of files.filter(name => name.endsWith('.html'))) {
    const html = fs.readFileSync(path.join(root, 'dist', file), 'utf8');
    expect(html.match(/src="\/js\/meta-tracking.js"/g) || []).toHaveLength(file.startsWith('admin/') ? 0 : 1);
    expect(html.match(/GTM-MZXJHMD5/g) || []).toHaveLength(file.startsWith('admin/') ? 0 : 2);
    if (!file.startsWith('admin/')) expect(html).not.toMatch(/fbq\s*\(|facebook\.com\/tr|connect\.facebook\.net/);
  }
  expect(fs.readFileSync(path.join(root, 'thank-you.html'), 'utf8')).not.toMatch(/track["'],\s*["']Lead/);
});
test('build refuses conflicting Meta installations and shared insertion is idempotent', () => {
  const html = '<head></head><body></body>';
  expect(addMetaTracking(addMetaTracking(html))).toBe(addMetaTracking(html));
  for (const tag of ['<script>fbq("init","other")</script>', '<img src="https://www.facebook.com/tr?id=other">', '<script src="/other/meta-tracking.js"></script>']) expect(() => addMetaTracking(html.replace('</body>', tag + '</body>'))).toThrow(/Conflicting/);
});
function formHarness(outcome, options = {}) {
  let submit;
  const form = { dataset: {}, action: 'https://formspree.io/f/test', reportValidity: () => options.valid !== false, addEventListener: (name, callback) => { submit = callback; } };
  const button = { disabled: false }, status = {};
  const acceptedQuote = jest.fn(async () => {}), calls = [];
  class Data { constructor() { this.fields = {}; } set(key, value) { this.fields[key] = value; } }
  const window = { crypto: { randomUUID: () => 'opaque-quote-identity-123' }, DivineQuoteConfig: { endpoint: form.action, thankYouUrl: '/thank-you.html', timeoutMs: 10 }, location: { href: 'https://storefront.test/products/banner.html?fbclid=click#quote', pathname: '/products/banner.html' }, hcaptcha: { getResponse: () => options.captcha === false ? '' : 'token', reset() {} }, DivineMeta: { acceptedQuote, attribution: () => ({ fbp: 'existing-id' }) } };
  const fetch = jest.fn(async (url, request) => {
    calls.push(request.body.fields);
    if (outcome === 'network') throw Error('offline');
    if (outcome === 'timeout' || outcome === 'late') return new Promise(resolve => { if (outcome === 'late') setTimeout(() => resolve({ status: 200, ok: true, text: async () => '{}' }), 25); });
    return { status: typeof outcome === 'number' ? outcome : 200, ok: typeof outcome !== 'number' || outcome < 300, text: async () => outcome === 'malformed' ? 'not json' : outcome === 'primitive' ? 'true' : outcome === 'array' ? '[]' : outcome === 'false-string' ? '{"ok":"false"}' : outcome === 'explicit' ? '{"errors":[{"message":"error"}]}' : '{}' };
  });
  const document = { getElementById: id => ({ quoteForm: form, submitBtn: button, quoteStatus: status })[id], querySelector: () => null };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'js/vestment-quote.js'), 'utf8'), { window, document, FormData: Data, URL, AbortController, fetch, setTimeout, clearTimeout, console });
  return { submit: () => submit({ preventDefault() {} }), window, acceptedQuote, fetch, calls, button, status };
}
test.each([200, 204])('accepted provider response %s emits once, then prevents repeat submission', async status => {
  const h = formHarness(status);
  await Promise.all([h.submit(), h.submit()]); await h.submit();
  expect(h.fetch).toHaveBeenCalledTimes(1); expect(h.acceptedQuote).toHaveBeenCalledTimes(1);
  expect(h.acceptedQuote).toHaveBeenCalledWith('opaque-quote-identity-123');
  expect(h.calls[0]).toMatchObject({ submission_id: 'opaque-quote-identity-123', meta_fbp: 'existing-id', product_page_url: 'https://storefront.test/products/banner.html' });
  expect(h.window.location.href).toBe('/thank-you.html'); expect(h.button.disabled).toBe(true);
});
test.each([400, 429, 500, 'malformed', 'primitive', 'array', 'false-string', 'explicit', 'network', 'timeout', 'late'])('%s never authorizes Lead', async outcome => {
  const h = formHarness(outcome); await h.submit();
  if (outcome === 'late') await new Promise(resolve => setTimeout(resolve, 30));
  expect(h.acceptedQuote).not.toHaveBeenCalled(); expect(h.window.location.href).not.toBe('/thank-you.html'); expect(h.button.disabled).toBe(false);
});
test.each([{ valid: false }, { captcha: false }])('validation/CAPTCHA failures never submit or track %j', async options => {
  const h = formHarness(200, options); await h.submit(); expect(h.fetch).not.toHaveBeenCalled(); expect(h.acceptedQuote).not.toHaveBeenCalled();
});
test('failed request retry retains attempt identity and tracking failure cannot prevent confirmation', async () => {
  const h = formHarness('network'); await h.submit(); await h.submit();
  expect(h.calls[0].submission_id).toBe(h.calls[1].submission_id);
  const accepted = formHarness(200); accepted.acceptedQuote.mockRejectedValue(Error('blocked')); await accepted.submit(); expect(accepted.window.location.href).toBe('/thank-you.html');
});
