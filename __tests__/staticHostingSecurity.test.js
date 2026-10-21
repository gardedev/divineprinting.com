'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { buildStatic, isPublicAsset } = require('../scripts/build-static');
const root = path.resolve(__dirname, '..');
let temporary;
beforeEach(() => { temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'divine-static-')); });
afterEach(() => fs.rmSync(temporary, { recursive: true, force: true }));
function put(name, bytes = name) { const filename = path.join(temporary, name); fs.mkdirSync(path.dirname(filename), { recursive: true }); fs.writeFileSync(filename, bytes); }

test('publishes browser assets only, preserves bytes and removes stale artifacts', () => {
  const allowed = ['index.html', 'products/item.html', 'account/orders.html', 'admin/index.html', 'blog/index.html', 'checkout/success.html', 'cart.js', 'js/account-auth.js', 'products/tshirt-configurator.js', 'styles.css', 'images/nested/photo.jpg', 'fonts/inter/font.woff2', 'fonts/inter/OFL.txt', 'robots.txt', '_redirects'];
  const denied = ['send-quote.php', 'images/leak.php', 'fonts/secret.json', '.env', 'package.json', 'amplify.yml', 'generate_pages2.py', 'infrastructure/server/server.js', 'docs/index.html', 'node_modules/foo.js', 'images/.env', 'test-report/index.html'];
  [...allowed, ...denied].forEach(name => put(name, Buffer.from([0, 42, 255])));
  put('dist/send-quote.php', 'stale');
  expect(buildStatic(temporary).sort()).toEqual(allowed.sort());
  for (const name of allowed) expect(fs.readFileSync(path.join(temporary, 'dist', name))).toEqual(fs.readFileSync(path.join(temporary, name)));
  for (const name of denied) expect(fs.existsSync(path.join(temporary, 'dist', name))).toBe(false);
  expect(buildStatic(temporary).sort()).toEqual(allowed.sort());
});
test('refuses linked public assets and unsafe dist destinations', () => {
  put('index.html'); fs.symlinkSync(path.join(temporary, 'index.html'), path.join(temporary, 'cart.js'));
  expect(() => buildStatic(temporary)).toThrow(/Symlink/);
  fs.unlinkSync(path.join(temporary, 'cart.js'));
  fs.symlinkSync(os.tmpdir(), path.join(temporary, 'dist'));
  expect(() => buildStatic(temporary)).toThrow(/unsafe dist/);
});
test.each(['../index.html', 'images/../secret.png', '/index.html', 'images\\file.png', 'images/.hidden/file.png'])('rejects unsafe policy path %s', name => expect(isPublicAsset(name)).toBe(false));

function htmlFiles(directory, prefix = '') {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory() && ['products', 'account', 'admin', 'blog', 'checkout'].includes(relative)) return htmlFiles(path.join(directory, entry.name), relative);
    return entry.isFile() && /\.html$/.test(relative) && isPublicAsset(relative) ? [relative] : [];
  });
}
const storefront = htmlFiles(root);
const quotePages = storefront.filter(name => /async function submitQuote\(/.test(fs.readFileSync(path.join(root, name), 'utf8')));
function handler(html, functionName) {
  const script = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]).find(source => source.includes(`async function ${functionName}(`));
  expect(script).toBeDefined();
  return script;
}
async function exercise(html, functionName, outcome) {
  const formId = functionName === 'submitContact' ? 'contactForm' : 'quoteForm';
  const elements = { submitBtn: { disabled: false, textContent: 'Send' }, [formId]: { style: {}, fields: { email: 'fixture@example.invalid', message: 'test only' } }, formSuccess: { style: {} } };
  class MockFormData { constructor(form) { this.values = { ...form.fields }; } delete(key) { delete this.values[key]; } append(key, value) { this.values[key] = value; } }
  const fetch = jest.fn(async () => { if (outcome === 'network') throw new Error('offline'); return { ok: outcome === 'success', json: async () => ({ errors: [{ message: 'Please retry' }] }) }; });
  const context = { document: { getElementById: id => elements[id] }, FormData: MockFormData, fetch, alert: jest.fn(), hcaptcha: { getResponse: () => outcome === 'captcha' ? '' : 'mock-token', reset: jest.fn() }, window: { location: { href: '' } } };
  vm.createContext(context); vm.runInContext(handler(html, functionName), context);
  await context[functionName]({ preventDefault: jest.fn() });
  if (outcome === 'captcha') { expect(fetch).not.toHaveBeenCalled(); expect(context.alert).toHaveBeenCalled(); return; }
  expect(fetch).toHaveBeenCalledTimes(1);
  const [url, options] = fetch.mock.calls[0];
  expect(url).toBe('https://formspree.io/f/xqeydkya'); expect(options.method).toBe('POST'); expect(options.headers.Accept).toBe('application/json');
  expect(options.body.values).toEqual({ email: 'fixture@example.invalid', message: 'test only', 'h-captcha-response': 'mock-token' });
  if (outcome === 'success') expect(context.window.location.href === '../thank-you.html' || elements.formSuccess.style.display === 'block').toBe(true);
  else { expect(elements.submitBtn.disabled).toBe(false); expect(elements[formId].style.display).not.toBe('none'); expect(elements.formSuccess.style.display).not.toBe('block'); expect(context.window.location.href).toBe(''); expect(context.alert).toHaveBeenCalled(); expect(context.hcaptcha.reset).toHaveBeenCalled(); }
}
test('all active storefront HTML is free of legacy PHP dependencies', () => {
  expect(quotePages).toHaveLength(19);
  for (const filename of storefront) expect(fs.readFileSync(path.join(root, filename), 'utf8')).not.toMatch(/send-quote\.php/i);
});
describe.each([...quotePages.map(name => [name, 'submitQuote']), ['contact.html', 'submitContact']])('%s Formspree integration', (name, fn) => {
  test.each(['captcha', 'success', 'http', 'network'])('%s uses only mocked requests', async outcome => exercise(fs.readFileSync(path.join(root, name), 'utf8'), fn, outcome));
});
const renderScript = `import ast,json,sys
source=ast.parse(open(sys.argv[1]).read())
selected=[n for n in source.body if isinstance(n,ast.FunctionDef) or (isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in ('PRODUCTS_EXTRA','NAV','TOPBAR') for t in n.targets))]
namespace={}
exec(compile(ast.Module(body=selected,type_ignores=[]),sys.argv[1],'exec'),namespace)
print(json.dumps([namespace['render_page'](p) for p in namespace['PRODUCTS_EXTRA']]))`;
test('isolated generator rendering preserves Formspree, CAPTCHA, success and retry behavior', async () => {
  const rendered = path.join(temporary, 'generated.json');
  const output = fs.openSync(rendered, 'w');
  try { execFileSync('python3', ['-c', renderScript, path.join(root, 'generate_pages2.py')], { stdio: ['ignore', output, 'inherit'] }); } finally { fs.closeSync(output); }
  const pages = JSON.parse(fs.readFileSync(rendered, 'utf8'));
  expect(pages.length).toBeGreaterThan(0);
  for (const html of pages) {
    expect(html).not.toMatch(/send-quote\.php/);
    expect(html).toContain('action="https://formspree.io/f/xqeydkya" method="POST"');
    expect(html).toContain('https://js.hcaptcha.com/1/api.js'); expect(html).toContain('class="h-captcha"');
    for (const outcome of ['captcha', 'success', 'http', 'network']) await exercise(html, 'submitQuote', outcome);
  }
});
test('real artifact preserves every public route and existing local HTML/CSS asset reference', () => {
  // Work in a fixture, leaving the checkout and its existing dist untouched.
  for (const filename of storefront) put(filename, fs.readFileSync(path.join(root, filename)));
  const walk = (directory, prefix = '') => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !['node_modules', '.git', 'dist'].includes(entry.name)) walk(path.join(directory, entry.name), relative);
      else if (entry.isFile() && isPublicAsset(relative)) put(relative, fs.readFileSync(path.join(root, relative)));
    }
  };
  walk(root);
  const published = new Set(buildStatic(temporary));
  for (const name of storefront) expect(published.has(name)).toBe(true);
  for (const name of published) {
    expect(fs.readFileSync(path.join(temporary, 'dist', name)).equals(fs.readFileSync(path.join(root, name)))).toBe(true);
    if (!/\.(html|css)$/.test(name)) continue;
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    const references = [...text.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^\s)'"?]+)["']?\s*\)/gi)].map(match => match[1] || match[2]);
    for (const ref of references) {
      if (/^(?:[a-z]+:|\/\/|#)/i.test(ref)) continue;
      const clean = ref.split(/[?#]/)[0]; if (!clean) continue;
      const target = path.posix.normalize(clean.startsWith('/') ? clean.slice(1) : path.posix.join(path.posix.dirname(name), clean));
      const absolute = path.join(root, target);
      if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) expect(published.has(target)).toBe(true);
    }
  }
});
