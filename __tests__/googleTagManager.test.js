'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { buildStatic, addTagManager } = require('../scripts/build-static');
let temporary;
beforeEach(() => { temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'divine-gtm-')); });
afterEach(() => fs.rmSync(temporary, { recursive: true, force: true }));
const source = '<!doctype html><html><head data-test="head"><meta charset="utf-8"><script src="https://www.googletagmanager.com/gtag/js?id=G-FYH23228K7"></script></head><body class="store"><main>Store</main></body></html>';
function put(name, content) { const file = path.join(temporary, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, content); }
function verify(html) {
  expect(html).toMatch(/<head data-test="head">\n<!-- Google Tag Manager -->\n<script>/);
  expect(html).toMatch(/<body class="store">\n<!-- Google Tag Manager \(noscript\) -->\n<noscript><iframe src="https:\/\/www.googletagmanager.com\/ns.html\?id=GTM-MZXJHMD5"\nheight="0" width="0" style="display:none;visibility:hidden"><\/iframe><\/noscript>/);
  expect(html.match(/GTM-MZXJHMD5/g)).toHaveLength(2);
  expect(html.match(/<!-- Google Tag Manager -->/g)).toHaveLength(1);
  expect(html).toContain('https://www.googletagmanager.com/gtag/js?id=G-FYH23228K7');
}
test('every public storefront directory receives GTM; admin, assets and source remain unchanged', () => {
  const pages = ['index.html', 'legacy.html', 'products/item.html', 'blog/index.html', 'account/orders.html', 'checkout/success.html'];
  pages.forEach(name => put(name, source));
  put('admin/index.html', source); put('js/store.js', 'window.store = true;');
  const binary = Buffer.from([0, 42, 255]); put('binary.html', binary);
  buildStatic(temporary);
  const first = pages.map(name => fs.readFileSync(path.join(temporary, 'dist', name), 'utf8'));
  first.forEach(verify);
  pages.forEach(name => expect(fs.readFileSync(path.join(temporary, name), 'utf8')).toBe(source));
  expect(fs.readFileSync(path.join(temporary, 'dist/admin/index.html'), 'utf8')).toBe(source);
  expect(fs.readFileSync(path.join(temporary, 'dist/binary.html'))).toEqual(binary);
  expect(fs.readFileSync(path.join(temporary, 'dist/js/store.js'), 'utf8')).toBe('window.store = true;');
  buildStatic(temporary);
  expect(pages.map(name => fs.readFileSync(path.join(temporary, 'dist', name), 'utf8'))).toEqual(first);
});
test('an existing exact installation is preserved and conflicting or partial installations require review', () => {
  const installed = addTagManager(source);
  expect(addTagManager(installed)).toBe(installed);
  for (const script of ['<script src="https://www.googletagmanager.com/gtm.js?id=GTM-OTHER"></script>', '<iframe src="https://www.googletagmanager.com/ns.html?id=GTM-MZXJHMD5"></iframe>']) {
    expect(() => addTagManager(source.replace('</head>', `${script}</head>`))).toThrow(/requires review/);
  }
});
test('loader preserves the existing dataLayer and queues its startup before loading the correct container', () => {
  const html = addTagManager(source);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const dataLayer = [{ existing: true }];
  const insertBefore = jest.fn();
  const firstScript = { parentNode: { insertBefore } };
  const document = { getElementsByTagName: () => [firstScript], createElement: () => ({}) };
  vm.runInNewContext(script, { window: { dataLayer }, document });
  expect(dataLayer[0]).toEqual({ existing: true });
  expect(dataLayer[1].event).toBe('gtm.js');
  expect(typeof dataLayer[1]['gtm.start']).toBe('number');
  expect(insertBefore).toHaveBeenCalledTimes(1);
  expect(insertBefore.mock.calls[0][0]).toEqual({ async: true, src: 'https://www.googletagmanager.com/gtm.js?id=GTM-MZXJHMD5' });
});
