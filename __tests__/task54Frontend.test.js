'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

describe('Task 5.4 live T-shirt migration', () => {
  test('uses the shared cart client and has no active Snipcart loader or browser price', () => {
    const html = read('products/church-t-shirt.html');
    expect(html).toContain('/js/cart-api.js');
    expect(html).not.toMatch(/cdn\.snipcart|data-item-price|Snipcart\.api/);
    expect(html).not.toMatch(/\bprice\s*[:=]\s*15(?:\.00)?/);
    expect(read('js/cart-api.js')).toContain('https://i3w6x21dzg.execute-api.us-east-1.amazonaws.com');
  });

  test('collects generic grouped allocations and visibly disables custom artwork', () => {
    const html = read('products/church-t-shirt.html');
    const script = read('products/tshirt-configurator.js');
    expect(html.match(/data-size=/g)).toHaveLength(8);
    expect(html).toContain('Custom artwork upload coming soon');
    expect(script).toContain('variantAllocations: allocations');
    expect(read('js/tshirt-preview.js')).toContain("designSource: 'TEMPLATE'");
    expect(script).toContain('DivineTshirtPreview.normalizeEditor');
    expect(html).toContain('/js/tshirt-preview-assets.js');
    expect(html).toContain('/js/tshirt-preview.js');
    expect(script).not.toMatch(/new FileReader|readAsDataURL/);
    const context = {}; vm.createContext(context);
    vm.runInContext(read('js/tshirt-preview-assets.js'), context);
    expect(context.DivineTshirtAssets.colors).toHaveLength(15);
    expect(Object.keys(context.DivineTshirtAssets.templates)).toHaveLength(16);
  });

  test('cart page loads canonical API state and no Snipcart runtime', () => {
    const html = read('cart.html');
    expect(html).toContain('/js/cart-page.js');
    expect(html).not.toMatch(/cdn\.snipcart|snipcart-custom\.js/);
    expect(html).not.toMatch(/localStorage|getCart\(|Snipcart\.api|data-item-price/);
    const page = read('js/cart-page.js');
    expect(page).toContain('variantSurchargeCents');
    expect(page).toContain("money(state.cart.subtotalCents)");
    expect(page).toContain("money(state.cart.totalCents)");
  });
});
