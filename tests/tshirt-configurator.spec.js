const { test, expect } = require('@playwright/test');
const fs = require('fs'); const path = require('path');
const { evaluateConfiguredProduct } = require('../infrastructure/server/products/configuredProduct');
const shirt = require('../infrastructure/server/products/data/product-seed.json').records.find(p => p.productId === 'd204cea4-ce22-4bc5-ad04-530f19fb3878');
const origin = 'http://127.0.0.1:3000';
async function mockCart(page) {
  let item; const requests = []; const cart = { cartId: 'local-cart', version: 1, subtotalCents: 0, totalCents: 0, status: 'active' };
  await page.addInitScript(base => { window.DIVINE_CART_API_BASE = base; }, origin);
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin !== origin) { await route.abort(); return; }
    if (!url.pathname.startsWith('/api/')) {
      const file = path.resolve(__dirname, '..', '.' + url.pathname);
      if (!file.startsWith(path.resolve(__dirname, '..') + path.sep) || !fs.existsSync(file)) { await route.fulfill({ status: 404, body: '' }); return; }
      const contentType = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg' }[path.extname(file)] || 'application/octet-stream';
      await route.fulfill({ body: fs.readFileSync(file), contentType }); return;
    }
    if (url.pathname.includes('checkout')) throw new Error('Checkout forbidden in local test');
    requests.push({ method: request.method(), path: url.pathname, body: request.postDataJSON() });
    if (request.method() === 'POST' && url.pathname.endsWith('/items')) {
      const body = request.postDataJSON(); const result = await evaluateConfiguredProduct(shirt, body);
      item = { ...result, productId: shirt.productId, cartItemId: 'local-item', cartItemType: 'CONFIGURED_JOB', quantity: result.totalQuantity, version: 1 };
      cart.version++; cart.subtotalCents = result.lineTotalCents; cart.totalCents = result.lineTotalCents;
    } else if (request.method() === 'PATCH') {
      const body = request.postDataJSON(); const result = await evaluateConfiguredProduct(shirt, { customerConfiguration: item.customerConfiguration, customerInstructions: item.customerInstructions, variantAllocations: body.variantAllocations });
      item = { ...item, ...result, quantity: result.totalQuantity, version: item.version + 1 }; cart.version++; cart.subtotalCents = result.lineTotalCents; cart.totalCents = result.lineTotalCents;
    }
    await route.fulfill({ json: { cart: { ...cart }, items: item ? [item] : [], ...(url.pathname === '/api/carts/anonymous' ? { cartToken: 'A'.repeat(43) } : {}) } });
  });
  return { requests, saved: () => item };
}
test('local evaluated save/reload/quantity roundtrip preserves exact customized preview and independent settings', async ({ page }) => {
  const mock = await mockCart(page); await page.goto(origin + '/products/church-t-shirt.html');
  await expect(page.locator('.text-instance')).toHaveCount(2); await expect(page.locator('#addTextBtn, .remove-text-btn')).toHaveCount(0);
  await expect(page.locator('#previewStatus')).toContainText('Customized shirt preview');
  await page.locator('#text-input-0').fill('  Grace 🙏  '); await page.locator('#text-input-1').fill('');
  await page.getByLabel('Text 1 font', { exact: true }).selectOption('Brush Script MT');
  await page.getByLabel('Text 1 arch', { exact: true }).fill('20');
  await page.locator('#organizationName').fill('Grace 🙏'); await page.locator('#customerInstructions').fill('Keep this placement');
  await page.evaluate(() => { state.texts[0].x = 0; state.texts[0].y = 0; state.texts[1].color = '#123456'; drawPreview(); });
  await expect(page.locator('#previewStatus')).toContainText('Customized shirt preview');
  const before = await page.locator('#tshirtCanvas').evaluate(c => c.toDataURL());
  await page.locator('#configuredAddButton').click(); await expect(page).toHaveURL(origin + '/cart.html');
  await expect(page.locator('.preview-status')).toContainText('Customized shirt preview');
  expect(await page.locator('.cart-customized-canvas').evaluate(c => c.toDataURL())).toBe(before);
  await page.getByText('View Customization', { exact: true }).click(); await expect(page.locator('.customization-details')).toContainText('Text 2 (blank)'); await expect(page.locator('.customization-details')).toContainText('#123456');
  const configuration = JSON.parse(JSON.stringify(mock.saved().customerConfiguration));
  await page.reload(); await expect(page.locator('.preview-status')).toContainText('Customized shirt preview');
  await page.getByLabel('size: L quantity').fill('26'); await page.getByLabel('size: L quantity').blur();
  await expect.poll(() => mock.saved().totalQuantity).toBe(26);
  expect(mock.saved().customerConfiguration).toEqual(configuration);
  const patch = mock.requests.find(r => r.method === 'PATCH'); expect(patch.body).toEqual({ itemType: 'CONFIGURED_JOB', variantAllocations: [{ selections: { size: 'L' }, quantity: 26 }] });
});
test('both blank panels survive save and full-back/reset/first-text keyboard behavior is explicit', async ({ page }) => {
  const mock = await mockCart(page); await page.goto(origin + '/products/church-t-shirt.html');
  await page.locator('#text-input-0').fill(''); await page.locator('#text-input-1').fill('');
  await page.locator('#positionSelect').selectOption('back');
  const c = await page.evaluate(() => buildConfiguredJobRequest().customerConfiguration);
  expect(c.designConfiguration.designGeometry).toEqual({ x: 200, y: 200 }); expect(c.designConfiguration.blankTextPanels).toHaveLength(2);
  await page.getByRole('group', { name: 'Text 1 positioning' }).focus();
  await page.keyboard.press('ArrowRight');
  expect((await page.evaluate(() => buildConfiguredJobRequest())).customerConfiguration.designConfiguration.blankTextPanels[0].position.x).toBe(202);
  await page.getByRole('group', { name: 'Text 2 positioning' }).focus();
  await page.keyboard.press('ArrowLeft');
  expect((await page.evaluate(() => buildConfiguredJobRequest())).customerConfiguration.designConfiguration.blankTextPanels[1].position.x).toBe(198);
  await page.getByText('Reset All Positions', { exact: true }).click();
  expect((await page.evaluate(() => buildConfiguredJobRequest())).customerConfiguration.designConfiguration.blankTextPanels[0].position.x).toBe(200);
  await page.locator('#configuredAddButton').click(); await expect(page).toHaveURL(origin + '/cart.html');
  await expect(page.locator('.preview-status')).toContainText('not a rear view');
  expect(mock.saved().customerConfiguration.designConfiguration.textElements).toHaveLength(0);
  await page.getByText('View Customization', { exact: true }).click(); await expect(page.locator('.customization-details')).toContainText('Text 1 (blank)'); await expect(page.locator('.customization-details')).toContainText('Text 2 (blank)');
});

test('customized mobile details use full row width at 320px and generic rows remain unclassified', async ({ page }) => {
  const mock = await mockCart(page); await page.goto(origin + '/products/church-t-shirt.html');
  await page.locator('#configuredAddButton').click(); await expect(page).toHaveURL(origin + '/cart.html');
  await page.setViewportSize({ width: 320, height: 720 });
  await page.getByText('View Customization', { exact: true }).click();
  const metrics = await page.locator('.cart-item--customized').evaluate(row => {
    const details = row.querySelector('.cart-item-details'); const price = row.querySelector('.cart-item-price'); const preview = row.querySelector('.customized-preview');
    return { row: row.getBoundingClientRect().width, details: details.getBoundingClientRect().width, overflow: row.scrollWidth > row.clientWidth, detailsTop: details.getBoundingClientRect().top, previewBottom: preview.getBoundingClientRect().bottom, priceTop: price.getBoundingClientRect().top, previewTop: preview.getBoundingClientRect().top };
  });
  expect(metrics.details).toBeCloseTo(metrics.row); expect(metrics.overflow).toBe(false);
  expect(metrics.detailsTop).toBeGreaterThan(metrics.previewBottom); expect(metrics.priceTop).toBeCloseTo(metrics.previewTop);
  await page.evaluate(() => {
    const generic = { productId: 'generic', cartItemId: 'generic-item', quantity: 1, lineTotalCents: 100, pricingSnapshot: { productName: 'Generic product', productImageUrl: '/images/tshirts/black.jpg', allocations: [] }, customerConfiguration: { options: {} } };
    const cart = { cartId: 'local-cart', version: 1, subtotalCents: 100, totalCents: 100 };
    window.DivineCart.loadCurrentCart = async () => ({ cart, items: [generic] });
    return window.DivineCartPage.render();
  });
  await expect(page.locator('.cart-item')).toHaveCount(1); await expect(page.locator('.cart-item--customized')).toHaveCount(0);
  await expect(page.locator('.cart-item-image')).toHaveCount(1);
});
