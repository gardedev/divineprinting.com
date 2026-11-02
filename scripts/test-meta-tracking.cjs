'use strict';
// All network requests are intercepted. No provider submission or Meta event leaves this harness.
const { chromium } = require('@playwright/test');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../dist'), base = 'https://storefront.test';
const slug = 'custom-embroidered-church-chasuble';
(async () => {
  const browser = await chromium.launch();
  let assertions = 0;
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage(); const calls = [], submissions = [], errors = []; let mode = '200', sdk = 0;
      await page.exposeFunction('recordMeta', (...args) => calls.push(args));
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.hostname === 'connect.facebook.net') {
          sdk++;
          return route.fulfill({ contentType: 'text/javascript', body: `document.cookie='_fbp=fb.1.1760000000000.123456; Path=/; SameSite=Lax';fbq.callMethod=function(){window.recordMeta(...arguments)};fbq.queue.splice(0).forEach(args=>fbq.callMethod(...args));` });
        }
        if (url.hostname === 'formspree.io') {
          submissions.push(req.postData());
          if (mode === 'network') return route.abort();
          return route.fulfill({ status: Number(mode), headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: mode === '204' ? '' : mode === '200' ? '{"ok":true}' : '{"errors":[{"message":"fixture failure"}]}' });
        }
        if (req.method() !== 'GET' || url.origin !== base) return route.abort();
        const file = path.join(root, decodeURIComponent(url.pathname));
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ contentType: ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' })[path.extname(file)] || 'application/octet-stream', body: fs.readFileSync(file) });
      });
      const leads = () => calls.filter(call => call[0] === 'track' && call[1] === 'Lead');
      await page.goto(base + '/index.html?fbclid=fixture_click_123');
      assert.equal(sdk, 0); assert.equal(calls.length, 0); assertions++;
      await page.getByRole('button', { name: 'Accept advertising', exact: true }).click();
      await page.waitForFunction(() => window.fbq?.callMethod);
      assert.equal(sdk, 1); assert.equal(calls.filter(call => call[1] === 'PageView').length, 1); assertions++;
      const prepare = async () => {
        await page.goto(base + '/products/' + slug + '.html#quote');
        await page.waitForFunction(() => window.fbq?.callMethod);
        await page.evaluate(() => { window.hcaptcha = { getResponse: () => 'local-captcha', reset() {} }; window.divineQuoteCaptchaReady(); });
        await page.locator('#q-name').fill('Local fixture only'); await page.locator('#q-email').fill('fixture@example.invalid');
        await page.locator('#q-quantity').fill('2'); await page.locator('#fconsent').check();
      };
      await prepare();
      const view = calls.filter(call => call[1] === 'ViewContent').at(-1);
      assert.deepEqual(view[2], { content_ids: [slug], content_type: 'product', content_name: 'Custom Embroidered Church Chasuble' }); assertions++;
      for (const failure of ['400', '429', '500', 'network']) {
        mode = failure; await page.locator('#submitBtn').click(); await page.waitForFunction(() => !document.getElementById('submitBtn').disabled);
        assert.equal(leads().length, 0); assertions++;
      }
      mode = '200';
      await page.evaluate(() => { const form = document.getElementById('quoteForm'); form.dispatchEvent(new Event('submit', { cancelable: true })); form.dispatchEvent(new Event('submit', { cancelable: true })); });
      await page.waitForURL('**/thank-you.html');
      assert.equal(leads().length, 1); const event = leads()[0]; assert.ok(event[3].eventID); assert.equal(event[2].value, undefined); assertions++;
      assert.ok(submissions.at(-1).includes('name="meta_fbclid"')); assert.ok(submissions.at(-1).includes('fixture_click_123')); assert.ok(submissions.at(-1).includes('name="submission_id"')); assertions++;
      await page.reload(); await page.goto(base + '/thank-you.html?success=true&submission_id=forged');
      await page.evaluate(id => window.DivineMeta.acceptedQuote(id), event[3].eventID);
      assert.equal(leads().length, 1); assertions++;
      await page.getByRole('button', { name: 'Advertising preferences', exact: true }).click();
      await page.getByRole('button', { name: 'Decline advertising', exact: true }).click();
      assert.equal(await page.evaluate(() => document.cookie.includes('_fbp=')), false); assertions++;
      mode = '204';
      await page.goto(base + '/products/' + slug + '.html');
      await page.evaluate(() => { window.hcaptcha = { getResponse: () => 'local-captcha', reset() {} }; window.divineQuoteCaptchaReady(); });
      await page.locator('#q-name').fill('Local fixture only'); await page.locator('#q-email').fill('fixture@example.invalid'); await page.locator('#q-quantity').fill('2'); await page.locator('#fconsent').check();
      await page.locator('#submitBtn').click(); await page.waitForURL('**/thank-you.html');
      assert.equal(leads().length, 1); assert.ok(!submissions.at(-1).includes('name="meta_')); assertions++;
      assert.deepEqual(errors, []); assertions++;
      await context.close();
      console.log('PASS desktop/mobile width=' + width + ' consent, attribution, ViewContent, accepted Lead, failures, duplicate submission, confirmation refresh, decline quote');
    }
    // Storage unavailable must preserve usable consent UI and form initialization.
    const page = await browser.newPage();
    await page.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw Error('storage disabled'); } }); });
    await page.route('**/*', route => { const url = new URL(route.request().url()); const file = path.join(root, url.pathname); return url.origin === base && fs.existsSync(file) && fs.statSync(file).isFile() ? route.fulfill({ contentType: file.endsWith('.js') ? 'text/javascript' : 'text/html', body: fs.readFileSync(file) }) : route.abort(); });
    await page.goto(base + '/products/' + slug + '.html'); await page.getByRole('button', { name: 'Decline advertising', exact: true }).click();
    assert.equal(await page.locator('#quoteForm').getAttribute('data-quote-initialized'), 'true'); assertions++;
    console.log('PASS ' + assertions + ' browser assertions; real provider requests=0, real Meta events=0');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
