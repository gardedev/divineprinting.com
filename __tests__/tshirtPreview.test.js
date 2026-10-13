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
test('font failure uses explicit Arial fallback while retaining selected font and full-back notice', async () => {
  const { preview, canvas } = scope('success', 'missing'); const s = state(); s.position = 'back'; s.texts[0].font = 'Brush Script MT'; const c = preview.normalizeEditor(s, 'Black', ''); const status = {};
  expect(await preview.render(canvas, c, status)).toBe(true); expect(status.textContent).toMatch(/Arial/); expect(status.textContent).toMatch(/not a rear view/); expect(c.designConfiguration.textElements[0].fontId).toBe('script');
});
test('asset failures report unavailable and stale rendering cannot replace latest', async () => {
  const failed = scope('failure'); const c = failed.preview.normalizeEditor(state(), 'Black', ''); const status = {};
  expect(await failed.preview.render(failed.canvas, c, status)).toBe(false); expect(status.textContent).toMatch(/unavailable/);
  const slow = scope('pending'); const first = slow.preview.render(slow.canvas, c, status); const secondConfig = JSON.parse(JSON.stringify(c)); secondConfig.options.color = 'White'; const second = slow.preview.render(slow.canvas, secondConfig, status);
  slow.pending.forEach(img => img.onload()); expect(await first).toBe(false); expect(await second).toBe(true);
  expect(slow.calls.find(c => c[0] === 'drawImage')[1].url).toContain('white.jpg');
});
test('arched Unicode text renders code points rather than surrogate halves', async () => {
  const { preview, canvas, calls } = scope(); const s = state(); s.texts[0].text = '🙏A'; s.texts[0].arch = 30;
  await preview.render(canvas, preview.normalizeEditor(s, 'Black', ''), {});
  expect(calls.filter(c => c[0] === 'fillText').map(c => c[1])).toEqual(['🙏', 'A']);
});
test.each(['Cinzel', 'Inter', 'Georgia', 'Brush Script MT', 'Impact', 'Playfair Display', 'Oswald', 'Lobster'])('preserves independent chosen font %s with shared rendering fallback', async font => {
  const { preview, canvas, calls } = scope(); const s = state(); s.texts[0].text = ''; s.texts[1] = { ...s.texts[1], text: 'Second', font, size: 48, arch: -30, color: '#abcdef', x: 800, y: 800 };
  const c = preview.normalizeEditor(s, 'White', '');
  expect(c.designConfiguration.blankTextPanels[0].elementId).toBe('text-1');
  expect(c.designConfiguration.textElements[0]).toMatchObject({ elementId: 'text-2', fontSize: 48, archDegrees: -30, color: '#ABCDEF', position: { x: 800, y: 800 } });
  expect(await preview.render(canvas, c, {})).toBe(true); expect(calls.filter(c => c[0] === 'fillText')).toHaveLength(6);
});
