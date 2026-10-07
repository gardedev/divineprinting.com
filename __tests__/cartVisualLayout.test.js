'use strict';

const fs = require('fs');
const path = require('path');

const cartHtml = fs.readFileSync(path.join(__dirname, '..', 'cart.html'), 'utf8');
const cartPage = fs.readFileSync(path.join(__dirname, '..', 'js', 'cart-page.js'), 'utf8');

describe('custom cart visual layout contract', () => {
  test('uses three grid tracks: image | details | price', () => {
    // The renderer appends: image (optional), details, price column.
    expect(cartPage).toContain("row.append(details, node('div', money(item.lineTotalCents), 'cart-item-price'))");
    // Product image is rendered via buildProductImage, not a static img node.
    expect(cartPage).toContain('buildProductImage');
    expect(cartPage).toContain("className = 'cart-item-image'");
    // Three-column grid: image slot | flexible details | auto price.
    expect(cartHtml).toContain('.cart-item { display: grid; grid-template-columns: 100px minmax(0, 1fr) auto;');
    // No-image modifier collapses the image column gracefully for products without a productImageUrl.
    expect(cartHtml).toContain('.cart-item--no-image { grid-template-columns: minmax(0, 1fr) auto; }');
    // Renderer applies the no-image class when image is absent.
    expect(cartPage).toContain("'cart-item cart-item--no-image'");
  });

  test('keeps allocation controls and the price usable at narrow widths', () => {
    expect(cartHtml).toContain('.allocation-row { display: flex; flex-wrap: wrap;');
    expect(cartHtml).toContain('.allocation-row input[type="number"] { width: 4.5rem;');
    expect(cartHtml).toContain('.cart-item-price { grid-column: auto; font-size: 1.1rem; }');
  });

  test('mobile responsive layout adjusts image column width at narrow widths', () => {
    // At ≤900 px the image column narrows from 100px to 80px.
    expect(cartHtml).toContain('.cart-item { grid-template-columns: 80px minmax(0, 1fr) auto;');
  });

  test('product image has defined size, border-radius, and object-fit so it never blows out the layout', () => {
    expect(cartHtml).toContain('.cart-item-image { width: 100px; height: 100px; border-radius: 12px; object-fit: cover;');
  });
});
