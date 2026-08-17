(function (global) {
  'use strict';
  const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);
  const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };

  function configurationSummary(item) {
    const options = item.customerConfiguration?.options || {};
    const template = item.customerConfiguration?.designConfiguration?.templateId;
    return [options.color, options.placement, template, item.customerConfiguration?.organizationName].filter(Boolean).join(' · ');
  }

  function allocationLabel(allocation) {
    return Object.entries(allocation.selections || {}).map(([key, value]) => `${key}: ${value}`).join(', ');
  }

  async function remove(item, cartVersion) {
    try { await global.DivineCart.removeItem(item, cartVersion); await render(); }
    catch (error) { show(error.code === 'CART_VERSION_CONFLICT' ? 'The cart changed. Review it and try again.' : error.message, true); await render(); }
  }

  async function updateAllocation(item, index, value, cartVersion) {
    const quantity = Number(value);
    if (!Number.isInteger(quantity) || quantity < 0) return show('Enter a whole-number quantity.', true);
    const allocations = item.variantAllocations.map((entry, entryIndex) => ({ selections: entry.selections, quantity: entryIndex === index ? quantity : entry.quantity })).filter(entry => entry.quantity > 0);
    if (!allocations.length) return show('At least one variant quantity is required.', true);
    try { await global.DivineCart.updateConfiguredJob(item, { variantAllocations: allocations }, cartVersion); await render(); }
    catch (error) { show(error.code === 'CART_VERSION_CONFLICT' ? 'The cart changed. Review it and try again.' : error.message, true); await render(); }
  }

  function show(message, error) {
    const toast = document.getElementById('toast'); if (!toast) return;
    toast.textContent = message; toast.classList.toggle('error', Boolean(error)); toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 4000);
  }

  async function render() {
    const container = document.getElementById('cartContent');
    try {
      const state = await global.DivineCart.loadAnonymousCart(false);
      const items = state?.items || [];
      const badge = document.getElementById('cart-count');
      if (badge) { badge.textContent = items.reduce((sum, item) => sum + (item.totalQuantity || item.quantity || 0), 0); badge.style.display = items.length ? 'flex' : 'none'; }
      container.replaceChildren();
      if (!state || !items.length) {
        const empty = node('div', undefined, 'empty-cart'); empty.append(node('div', '🛒', 'empty-cart-icon'), node('h2', 'Your cart is empty'), node('p', 'Configure a product to begin your order.'));
        const link = node('a', 'Start Shopping', 'btn-primary'); link.href = '/#products'; empty.append(link); container.append(empty); return;
      }
      const grid = node('div', undefined, 'cart-grid'); const list = node('div', undefined, 'cart-items'); list.append(node('h2', `Cart Items (${items.length})`));
      for (const item of items) {
        const row = node('article', undefined, 'cart-item'); const details = node('div', undefined, 'cart-item-details');
        details.append(node('h3', item.baseSku === 'DPT-CHURCH-TSHIRT' ? 'Custom Church T-Shirts' : item.sku || 'Configured product'), node('p', configurationSummary(item)));
        (item.variantAllocations || []).forEach((allocation, index) => {
          const priced = item.pricingSnapshot?.allocations?.[index] || {};
          const line = node('label', undefined, 'allocation-row'); line.append(node('span', allocationLabel(allocation)));
          const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '10000'; input.value = allocation.quantity; input.setAttribute('aria-label', `${allocationLabel(allocation)} quantity`);
          input.addEventListener('change', () => updateAllocation(item, index, input.value, state.cart.version));
          const surcharge = priced.variantSurchargeCents ? ` (${money(priced.variantSurchargeCents)} size surcharge)` : '';
          line.append(input, node('span', `${money(priced.configuredUnitPriceCents)} each${surcharge}`)); details.append(line);
        });
        const pricing = item.pricingSnapshot || {}; details.append(node('p', `Tier: ${pricing.tier?.minimumQuantity || 1}${pricing.tier?.maximumQuantity ? `–${pricing.tier.maximumQuantity}` : '+'} · ${item.totalQuantity || item.quantity} total`));
        const removeButton = node('button', 'Remove', 'remove-btn'); removeButton.type = 'button'; removeButton.addEventListener('click', () => remove(item, state.cart.version)); details.append(removeButton);
        row.append(details, node('div', money(item.lineTotalCents), 'cart-item-price')); list.append(row);
      }
      const summary = node('aside', undefined, 'cart-summary'); summary.append(node('h2', 'Authoritative Cart Total'));
      const subtotal = node('div', undefined, 'summary-row'); subtotal.append(node('span', 'Subtotal'), node('span', money(state.cart.subtotalCents)));
      const total = node('div', undefined, 'summary-row total'); total.append(node('span', 'Pre-checkout total'), node('span', money(state.cart.totalCents))); summary.append(subtotal, total, node('p', 'Tax, shipping, discounts, and checkout are not calculated in this cart yet.'));
      grid.append(list, summary); container.append(grid);
    } catch (error) {
      container.replaceChildren(node('p', error.message || 'The cart could not be loaded.')); show('The cart could not be loaded.', true);
    }
  }
  global.DivineCartPage = { render, configurationSummary };
  document.addEventListener('DOMContentLoaded', render);
}(typeof window !== 'undefined' ? window : globalThis));
