'use strict';

const fs = require('fs');
const path = require('path');

const cartHtml = fs.readFileSync(path.join(__dirname, '..', 'cart.html'), 'utf8');
const cartPage = fs.readFileSync(path.join(__dirname, '..', 'js', 'cart-page.js'), 'utf8');

describe('custom cart visual layout contract', () => {
  test('uses two grid tracks because the custom renderer supplies details and price, not an image', () => {
    expect(cartPage).toContain("row.append(details, node('div', money(item.lineTotalCents), 'cart-item-price'))");
    expect(cartPage).not.toContain("row.append(node('img'");
    expect(cartHtml).toContain('.cart-item { display: grid; grid-template-columns: minmax(0, 1fr) auto;');
    expect(cartHtml).not.toContain('.cart-item { display: grid; grid-template-columns: 100px 1fr auto;');
    expect(cartHtml).not.toContain('.cart-item { grid-template-columns: 80px 1fr; }');
  });

  test('keeps allocation controls and the price usable at narrow widths', () => {
    expect(cartHtml).toContain('.allocation-row { display: flex; flex-wrap: wrap;');
    expect(cartHtml).toContain('.allocation-row input[type="number"] { width: 4.5rem;');
    expect(cartHtml).toContain('.cart-item-price { grid-column: auto; font-size: 1.1rem; }');
  });
});
