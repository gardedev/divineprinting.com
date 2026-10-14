'use strict';
const fs = require('fs'); const vm = require('vm'); const path = require('path');
function scope(imageMode = 'success', fontMode = 'available') {
  const calls = []; const pending = [];
  class Image { constructor() { this.width = 200; this.height = 200; this.naturalWidth = 200; } set src(value) { this.url = value; if (imageMode === 'pending') pending.push(this); else queueMicrotask(() => imageMode === 'failure' ? this.onerror() : this.onload()); } }
  const global = { Image, setTimeout, clearTimeout, document: { fonts: { load: async () => fontMode === 'available' ? [{}] : [] } } };
  vm.createContext(global);
  ['tshirt-preview-assets', 'tshirt-preview'].forEach(file => vm.runInContext(fs.readFileSync(path.join(__dirname, '../js', `${file}.js`), 'utf8'), global));
  const ctx = new Proxy({ measureText: text => ({ width: Array.from(text).length * 10 }) }, { get: (obj, key) => obj[key] || ((...args) => calls.push([key, ...args])) });
  const canvas = { style: {}, getContext: () => ctx };
  return { preview: global.DivineTshirtPreview, assets: global.DivineTshirtAssets, canvas, calls, pending };
}
const state = () => ({ position: 'center', selectedDesign: 'cross-modern', designX: null, designY: null, designScale: 1, texts: [{ text: ' Grace ', font: 'Cinzel', color: '#ffffff', size: 32, arch: 0, x: 0, y: 0 }, { text: '', font: 'Inter', color: '#123456', size: 24, arch: -30, x: null, y: null }] });
test('two panels preserve blank settings, trim text, resolve null and retain zero', () => {
  const { preview } = scope(); const c = preview.normalizeEditor(state(), 'Black', '');
  expect(c.designConfiguration.textElements[0]).toMatchObject({ elementId: 'text-1', order: 0, text: 'Grace', position: { x: 0, y: 0 }, color: '#FFFFFF' });
  expect(c.designConfiguration.blankTextPanels[0]).toMatchObject({ elementId: 'text-2', order: 1, archDegrees: -30, position: { x: 400, y: 342 } });
  const s = state(); s.texts[0].text = ''; expect(preview.normalizeEditor(s, 'Black', '').designConfiguration.blankTextPanels).toHaveLength(2);
  s.texts[0].text = 'One'; s.texts[1].text = 'Two'; expect(preview.normalizeEditor(s, 'Black', '').designConfiguration.blankTextPanels).toHaveLength(0);
});
test.each(['left', 'back'])('placement %s resets resolved positions consistently', position => {
  const { preview } = scope(); const s = state(); s.position = position; s.texts.forEach(p => { p.x = null; p.y = null; });
  const c = preview.normalizeEditor(s, 'Black', ''); const d = preview.defaults(c.options.placement);
  expect(c.designConfiguration.designGeometry).toEqual({ x: d.x, y: d.y });
  expect(c.designConfiguration.textElements[0].position).toEqual({ x: d.x, y: d.y + d.scale / 2 + 10 });
});
test('renderer awaits assets and fonts, renders identical snapshot without selection controls', async () => {
  const { preview, canvas, calls } = scope(); const c = preview.normalizeEditor(state(), 'Black', ''); const status = {};
  expect(await preview.render(canvas, c, status)).toBe(true);
  expect(calls.filter(c => c[0] === 'drawImage')).toHaveLength(2);
  expect(calls.find(c => c[0] === 'fillText')).toEqual(['fillText', 'Grace', 0, 0]);
  expect(calls.some(c => c[0] === 'strokeRect')).toBe(false);
});
test('font failure is explicit without substituting a different font', async () => {
  const { preview, canvas } = scope('success', 'missing'); const s = state(); s.position = 'back'; s.texts[0].font = 'Brush Script MT'; const c = preview.normalizeEditor(s, 'Black', ''); const status = {};
  expect(await preview.render(canvas, c, status)).toBe(false); expect(status.textContent).toMatch(/font unavailable/); expect(canvas.style.visibility).toBe('hidden'); expect(c.designConfiguration.textElements[0].fontId).toBe('script');
});
test('asset failures report unavailable and stale rendering cannot replace latest', async () => {
  const failed = scope('failure'); const c = failed.preview.normalizeEditor(state(), 'Black', ''); const status = {};
  expect(await failed.preview.render(failed.canvas, c, status)).toBe(false); expect(status.textContent).toMatch(/unavailable/);
  const slow = scope('pending'); const first = slow.preview.render(slow.canvas, c, status); const secondConfig = JSON.parse(JSON.stringify(c)); secondConfig.options.color = 'White'; const second = slow.preview.render(slow.canvas, secondConfig, status);
  slow.pending.forEach(img => img.onload()); expect(await first).toBe(false); expect(await second).toBe(true);
  expect(slow.calls.find(c => c[0] === 'drawImage')[1].url).toContain('white.jpg');
});
test('grapheme segmentation preserves combining marks and emoji clusters', () => {
  const { preview } = scope(); expect(preview.graphemes('e\u0301👨‍👩‍👧‍👦A')).toEqual(['e\u0301', '👨‍👩‍👧‍👦', 'A']);
});
test('unsupported glyphs fail explicitly rather than silently drawing a system font', async () => {
  const { preview, canvas } = scope(); const s = state(); s.texts[0].text = '🙏'; const status = {};
  expect(await preview.render(canvas, preview.normalizeEditor(s, 'Black', ''), status)).toBe(false); expect(status.textContent).toMatch(/cannot render every character/);
});
test.each(['Cinzel', 'Inter', 'Georgia', 'Brush Script MT', 'Impact', 'Playfair Display', 'Oswald', 'Lobster'])('preserves independent chosen font %s with its own licensed rendering face', async font => {
  const { preview, canvas, calls } = scope(); const s = state(); s.texts[0].text = ''; s.texts[1] = { ...s.texts[1], text: 'Second', font, size: 48, arch: -30, color: '#abcdef', x: 800, y: 800 };
  const c = preview.normalizeEditor(s, 'White', '');
  expect(c.designConfiguration.blankTextPanels[0].elementId).toBe('text-1');
  expect(c.designConfiguration.textElements[0]).toMatchObject({ elementId: 'text-2', fontSize: 48, archDegrees: -30, color: '#ABCDEF', position: { x: 800, y: 800 } });
  expect(await preview.render(canvas, c, {})).toBe(true); expect(calls.filter(c => c[0] === 'fillText')).toHaveLength(6);
});

test('arches center glyph advances and rotate with the positive/negative tangent', () => {
  const { preview } = scope(); const ctx = { measureText: () => ({ width: 10 }) };
  const positive = preview.archLayout(ctx, 'ABC', 20, 30); const negative = preview.archLayout(ctx, 'ABC', 20, -30);
  expect(positive[0].x).toBeCloseTo(-positive[2].x); expect(positive[1].x).toBeCloseTo(0); expect(positive[1].y).toBeCloseTo(0);
  positive.forEach((p, i) => { expect(negative[i].x).toBeCloseTo(p.x); expect(negative[i].y).toBeCloseTo(-p.y); expect(negative[i].rotation).toBeCloseTo(-p.rotation); });
  expect(positive[0].rotation).toBeLessThan(0); expect(positive[2].rotation).toBeGreaterThan(0);
  expect(preview.archLayout(ctx, '', 20, 30)).toEqual([]); expect(preview.archLayout(ctx, 'A', 20, 30)).toEqual([{ text: 'A', x: 0, y: 0, rotation: 0 }]);
  expect(preview.archLayout({ measureText: () => ({ width: 0 }) }, 'A', 20, 30)).toEqual([]);
});

test('pinned font binaries and licenses match their source checksums', () => {
  const crypto = require('crypto'); const root = path.join(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'fonts/tshirt/provenance.json'), 'utf8'));
  expect(manifest.revision).toMatch(/^[0-9a-f]{40}$/); expect(manifest.files).toHaveLength(24);
  for (const entry of manifest.files) {
    const data = fs.readFileSync(path.join(root, entry.file)); expect(crypto.createHash('sha256').update(data).digest('hex')).toBe(entry.sha256);
    expect(entry.source).toContain(manifest.revision);
    if (entry.file.endsWith('OFL.txt')) expect(data.toString()).toContain('SIL OPEN FONT LICENSE Version 1.1');
  }
  const { assets } = scope();
  expect(new Set(Object.values(assets.fontSpecs).map(s => s.family)).size).toBe(8);
  for (const id of ['script', 'impact', 'lobster']) expect(assets.fontSpecs[id].weight).toBe(400);
});
