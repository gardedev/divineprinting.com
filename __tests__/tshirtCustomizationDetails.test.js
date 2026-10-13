'use strict';
const fs = require('fs'); const vm = require('vm'); const path = require('path');
function element(tag) {
  return { tag, textContent: '', children: [], style: {}, append(...children) { this.children.push(...children); }, setAttribute() {}, addEventListener() {} };
}
function texts(node) { return [node.textContent, ...node.children.flatMap(texts)].join('\n'); }
test('details display both saved panels and all settings safely without interpreting HTML', () => {
  const global = { document: { getElementById: () => null, createElement: element, addEventListener() {} }, addEventListener() {}, DivineTshirtPreview: { fontNote: () => 'Preview uses Inter; selected font is saved.' }, DivineTshirtAssets: { fonts: { script: 'Script', inter: 'Inter' } } };
  vm.createContext(global); vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/cart-page.js'), 'utf8'), global);
  const panel = { elementId: 'text-1', order: 0, fontId: 'script', color: '#FFFFFF', fontSize: 32, archDegrees: 20, position: { x: 0, y: 0 }, text: '<img src=x onerror=alert(1)>', elementRole: 'additionalText' };
  const item = { quantity: 25, totalQuantity: 25, customerInstructions: '<script>bad()</script>', variantAllocations: [{ selections: { size: 'L' }, quantity: 25 }], customerConfiguration: { schemaVersion: 'custom-design-v1', organizationName: 'Grace', options: { color: 'Black', placement: 'full-back', designSource: 'TEMPLATE' }, designConfiguration: { canvasVersion: 'tshirt-800-v1', templateId: 'cross-modern', templateVersion: 1, designScale: 1.5, designGeometry: { x: 200, y: 300 }, textElements: [panel], blankTextPanels: [{ ...panel, text: undefined, elementRole: undefined, elementId: 'text-2', order: 1, fontId: 'inter' }] } } };
  const section = global.DivineCartPage.buildCustomizationDetails(item); const text = texts(section);
  expect(section.tag).toBe('details'); expect(section.children[0].tag).toBe('summary');
  for (const expected of ['View Customization', 'Text 1', 'Text 2 (blank)', panel.text, item.customerInstructions, 'Script', '#FFFFFF', '32px', '20°', 'x 0, y 0', 'text-1', 'text-2', 'Black', 'full-back', 'cross-modern', '150%', 'x 200, y 300', 'Grace', 'TEMPLATE', 'size: L × 25', 'Total quantity: 25', 'rear view is unavailable']) expect(text).toContain(expected);
  expect(section.children.some(n => n.tag === 'img' || n.tag === 'script')).toBe(false);
});

test('missing renderer fails closed for scoped shirts without using default product photo', () => {
  const global = { document: { getElementById: () => null, createElement: element, addEventListener() {} }, addEventListener() {} };
  vm.createContext(global); vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/cart-page.js'), 'utf8'), global);
  const item = { productId: 'd204cea4-ce22-4bc5-ad04-530f19fb3878', customerConfiguration: { schemaVersion: 'custom-design-v1', designConfiguration: { canvasVersion: 'tshirt-800-v1' } } };
  expect(global.DivineCartPage.isChurchShirt(item)).toBe(true);
  const view = global.DivineCartPage.buildCustomizedPreview(item);
  expect(texts(view)).toContain('Customized preview unavailable'); expect(view.children[0].style.display).toBe('none'); expect(view.children.some(e => e.tag === 'img')).toBe(false);
});
