'use strict';

const fs = require('fs');
const path = require('path');

describe('cart API application construction paths', () => {
  const serverSource = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
  const appSource = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');

  test.each([
    ['server.js', serverSource],
    ['app.js', appSource],
  ])('%s mounts the same cart router under /api/carts', (_name, source) => {
    expect(source).toContain("require('./api/cartApi')");
    expect(source).toMatch(/app\.use\('\/api\/carts',[^;]*createCartRouter/);
  });

  test.each([
    ['server.js', serverSource],
    ['app.js', appSource],
  ])('%s applies the bounded JSON parser and safe parser errors', (_name, source) => {
    expect(source).toContain("express.json({ limit: '256kb' })");
    expect(source).toContain("err.type === 'entity.too.large'");
    expect(source).toContain("code: 'CART_ITEM_TOO_LARGE'");
    expect(source).toContain("code: 'CART_INVALID_INPUT'");
  });
});
