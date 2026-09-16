(function (global) {
  'use strict';
  function selected(button) { const choice = button.closest('[data-standard-product]').querySelector('[data-variant].selected, .size-option.selected'); const inline = choice?.getAttribute('onclick')?.match(/selectSize\('([^']+)'/); return choice?.dataset.variant || inline?.[1]; }
  function packageSummary(root) {
    if (!root.dataset.packageUnits) return;
    const choice = root.querySelector('[data-variant].selected, .size-option.selected');
    const key = choice?.dataset.variant;
    const packs = Number(root.querySelector('#qty')?.textContent || 1);
    const units = JSON.parse(root.dataset.packageUnits)[key];
    const output = root.querySelector('[data-physical-quantity]');
    if (output && Number.isInteger(packs) && units) output.textContent = `${choice.textContent.trim().replace(/\s*-\s*\$.*$/, '')} × ${packs} pack${packs === 1 ? '' : 's'} = ${units * packs} ${root.dataset.physicalLabel}`;
  }
  function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    if (!menu) return;
    menu.classList.toggle('active');
    document.body.style.overflow = menu.classList.contains('active') ? 'hidden' : '';
  }
  async function updateCartBadge() {
    const badge = document.getElementById('cart-count');
    if (!badge || !global.DivineCart?.loadCurrentCart) return;
    try {
      const state = await global.DivineCart.loadCurrentCart(false);
      const count = (state?.items || []).reduce((sum, item) => sum + (item.totalQuantity || item.quantity || 0), 0);
      badge.textContent = count;
      badge.style.display = count ? 'flex' : 'none';
    } catch (_) { /* A cart badge must not interfere with product selection. */ }
  }
  async function add(button) {
    const root = button.closest('[data-standard-product]'); const productId = root.dataset.productId;
    const variant = selected(button); const quantity = root.dataset.quantityMode === 'DISCRETE_SELECTION' ? 1 : Number(root.querySelector('[data-cart-quantity]')?.value || root.querySelector('#qty')?.textContent || 1);
    const minimum = Number(root.dataset.minimumQuantity || 1); const increment = Number(root.dataset.quantityIncrement || 1);
    const message = root.querySelector('[data-cart-error]');
    if (!productId || !variant || !Number.isInteger(quantity) || quantity < minimum || (quantity - minimum) % increment !== 0) { if (message) message.textContent = `Choose a quantity of ${minimum} or more in increments of ${increment}.`; return; }
    button.disabled = true;
    try {
      await global.DivineCart.addConfiguredJob({ productId, customerConfiguration: { schemaVersion: 'standard-product-v1', options: {} }, variantAllocations: [{ selections: { [root.dataset.dimension]: variant }, quantity }] });
      global.location.href = '/cart.html';
    } catch (error) { if (message) message.textContent = error.message || 'Unable to add this item.'; }
    finally { button.disabled = false; }
  }
  document.addEventListener('click', event => { const button = event.target.closest('[data-add-standard-product]'); if (button) { event.preventDefault(); add(button); } const root = event.target.closest('[data-standard-product]'); if (root) setTimeout(() => packageSummary(root), 0); });
  global.toggleMobileMenu = toggleMobileMenu;
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-standard-product]').forEach(packageSummary);
    updateCartBadge();
  });
}(window));
