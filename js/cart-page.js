(function (global) {
  'use strict';
  // Informational overlays must never intercept cart or checkout controls.
  const toastOverlay = document.getElementById('toast');
  if (toastOverlay) toastOverlay.style.pointerEvents = 'none';
  const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format((cents || 0) / 100);
  const authoritativeUnitPriceCents = priced => Number.isInteger(priced?.configuredUnitPriceCents)
    ? priced.configuredUnitPriceCents
    : Number.isInteger(priced?.unitPriceCents) ? priced.unitPriceCents : null;
  const node = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; if (className) element.className = className; return element; };

  /**
   * Resolve a raw option value to a human-readable label using the
   * optionLabels map emitted by the server in pricingSnapshot.
   * Falls back to the raw value when no label is available.
   */
  function resolveLabel(optionLabels, optionId, rawValue) {
    if (!optionLabels) return rawValue;
    const map = optionLabels[optionId];
    if (!map) return rawValue;
    return map[rawValue] || rawValue;
  }

  /**
   * Build a human-readable configuration summary paragraph for a cart item.
   *
   * For standard-pricing-v1 products the option keys and values are already
   * plain text.  For configured-pricing-v1 products (e.g. the T-shirt) the
   * server now supplies optionLabels and designTemplate display names so raw
   * internal identifiers such as "center-chest" or "cross-modern" are
   * resolved to "Center Chest" / "Modern Cross" before display.
   *
   * organizationName, when present, is appended so the customer can verify
   * their church name without the raw field key.
   *
   * The client never computes prices here — this is display only.
   */
  function configurationSummary(item) {
    const options = item.customerConfiguration?.options || {};
    const snapshot = item.pricingSnapshot || {};
    const schema = snapshot.schemaVersion;
    const optionLabels = snapshot.optionLabels;

    // Standard-configurable products: render all option key/value pairs.
    if (schema === 'standard-pricing-v1') {
      const optionParts = Object.entries(options).map(([k, v]) => k + ': ' + v);
      return optionParts.join(' · ');
    }

    // Configured products (e.g. custom t-shirt): resolve friendly labels.
    const parts = [];

    // Color — stored as a display-ready string in the configurator.
    if (options.color) parts.push(options.color);

    // Placement — resolve "center-chest" → "Center Chest" etc.
    if (options.placement) {
      parts.push(resolveLabel(optionLabels, 'placement', options.placement));
    }

    // Design template — resolve "cross-modern" → "Modern Cross" etc.
    const templateId = item.customerConfiguration?.designConfiguration?.templateId;
    if (templateId) {
      parts.push(resolveLabel(optionLabels, 'design', templateId));
    }

    // Organization name — append as plain text without an internal key.
    const orgName = item.customerConfiguration?.organizationName;
    if (orgName) parts.push(orgName);

    return parts.filter(Boolean).join(' · ');
  }

  function allocationLabel(allocation) {
    return Object.entries(allocation.selections || {}).map(([key, value]) => `${key}: ${value}`).join(', ');
  }

  function standardSummary(item, allocation, priced) {
    if (item.pricingSnapshot?.schemaVersion !== 'standard-pricing-v1') return null;
    // allocationLabel already renders all dimension keys generically.
    const selected = allocationLabel(allocation);
    const physical = priced.physicalQuantity || allocation.quantity;
    return item.pricingSnapshot.quantityMode === 'PACKAGE_SELECTION'
      ? `${selected} × ${allocation.quantity} pack${allocation.quantity === 1 ? '' : 's'} = ${physical} physical units`
      : `${selected} · ${physical} unit${physical === 1 ? '' : 's'}`;
  }

  /**
   * Build a product image element from the server-authoritative productImageUrl
   * stored in pricingSnapshot.  Returns null when no URL is available.
   *
   * The image path from the product seed is stored relative to the product
   * page (e.g. "../images/…").  Cart pages live at the root, so we strip any
   * leading "../" prefix and use an absolute path from the site root.
   */
  function buildProductImage(item) {
    const rawUrl = item.pricingSnapshot?.productImageUrl;
    if (!rawUrl) return null;
    // Normalise "../images/…" → "/images/…" so it resolves from the cart page.
    const src = rawUrl.replace(/^(\.\.\/)+/, '/');
    const productName = item.pricingSnapshot?.productName || 'Product';
    const img = document.createElement('img');
    img.src = src;
    img.alt = productName;
    img.className = 'cart-item-image';
    img.loading = 'lazy';
    img.onerror = () => { img.style.display = 'none'; };
    return img;
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

  let checkoutBusy = false;
  let checkoutAttempt;

  async function startCheckout(cart) {
    if (checkoutBusy) return;
    if (!global.getAccessToken || !global.getAccessToken()) {
      global.location.href = '/account/login.html';
      return;
    }
    checkoutBusy = true;
    if (!checkoutAttempt) {
      try { checkoutAttempt = JSON.parse(global.sessionStorage.getItem('dp_checkout_attempt_v1') || 'null'); } catch (_) { /* Retry state is optional. */ }
    }
    const sameAttempt = checkoutAttempt && checkoutAttempt.cartId === cart.cartId &&
      typeof checkoutAttempt.key === 'string' && Number.isInteger(checkoutAttempt.version) &&
      (checkoutAttempt.version === cart.version || (cart.status === 'pending_checkout' && checkoutAttempt.version + 1 === cart.version));
    if (!sameAttempt) {
      checkoutAttempt = { cartId: cart.cartId, version: cart.version, key: global.crypto?.randomUUID ? global.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}` };
    }
    try { global.sessionStorage.setItem('dp_checkout_attempt_v1', JSON.stringify(checkoutAttempt)); } catch (_) { /* In-memory retries remain available. */ }
    const button = document.getElementById('checkout-btn');
    if (button) { button.disabled = true; button.textContent = 'Preparing checkout...'; }
    try {
      const result = await global.DivineCart.startCheckout({ cartId: cart.cartId, version: checkoutAttempt.version }, checkoutAttempt.key);
      try { global.sessionStorage.setItem('dp_checkout_pending_v1', JSON.stringify({ orderId: result.orderId })); } catch (_) { /* Order history remains available if browser storage is disabled. */ }
      global.location.href = result.checkoutUrl;
    } catch (error) {
      const conflict = ['CHECKOUT_CONFLICT', 'ORDER_CART_VERSION_CONFLICT', 'CART_VERSION_CONFLICT'].includes(error.code);
      show(conflict
        ? 'The cart changed. Reload it and try again.'
        : error.message || 'Checkout could not be started.', true);
      checkoutBusy = false;
      if (conflict) {
        checkoutAttempt = null;
        try { global.sessionStorage.removeItem('dp_checkout_attempt_v1'); } catch (_) { /* Storage may be unavailable. */ }
        await render();
      }
      if (button) { button.disabled = false; button.textContent = 'Continue to secure checkout'; }
    }
  }

  async function render() {
    const container = document.getElementById('cartContent');
    try {
      const state = await global.DivineCart.loadCurrentCart(false);
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
        const productImg = buildProductImage(item);
        const row = node('article', undefined, productImg ? 'cart-item' : 'cart-item cart-item--no-image');

        // Product image — server-authoritative URL from pricingSnapshot.
        if (productImg) row.append(productImg);

        const details = node('div', undefined, 'cart-item-details');
        details.append(node('h3', item.pricingSnapshot?.productName || (item.baseSku === 'DPT-CHURCH-TSHIRT' ? 'Custom Church T-Shirts' : item.sku || 'Configured product')), node('p', configurationSummary(item)));
        (item.variantAllocations || []).forEach((allocation, index) => {
          const priced = item.pricingSnapshot?.allocations?.[index] || {};
          const line = node('label', undefined, 'allocation-row'); line.append(node('span', standardSummary(item, allocation, priced) || allocationLabel(allocation)));
          const input = document.createElement('input'); input.type = 'number'; input.min = '0'; input.max = '10000'; input.value = allocation.quantity; input.setAttribute('aria-label', `${allocationLabel(allocation)} quantity`);
          input.addEventListener('change', () => updateAllocation(item, index, input.value, state.cart.version));
          const surcharge = priced.variantSurchargeCents ? ` (${money(priced.variantSurchargeCents)} size surcharge)` : '';
          const unitPrice = authoritativeUnitPriceCents(priced);
          line.append(input, node('span', unitPrice === null ? 'Authoritative price unavailable' : `${money(unitPrice)} each${surcharge}`)); details.append(line);
        });
        const pricing = item.pricingSnapshot || {}; details.append(node('p', `Tier: ${pricing.tier?.minimumQuantity || 1}${pricing.tier?.maximumQuantity ? `–${pricing.tier.maximumQuantity}` : '+'} · ${item.totalQuantity || item.quantity} total`));
        const removeButton = node('button', 'Remove', 'remove-btn'); removeButton.type = 'button'; removeButton.addEventListener('click', () => remove(item, state.cart.version)); details.append(removeButton);
        row.append(details, node('div', money(item.lineTotalCents), 'cart-item-price')); list.append(row);
      }
      const summary = node('aside', undefined, 'cart-summary'); summary.append(node('h2', 'Authoritative Cart Total'));
      const subtotal = node('div', undefined, 'summary-row'); subtotal.append(node('span', 'Subtotal'), node('span', money(state.cart.subtotalCents)));
      const total = node('div', undefined, 'summary-row total'); total.append(node('span', 'Pre-checkout total'), node('span', money(state.cart.totalCents)));
      const checkout = node('button', 'Continue to secure checkout', 'checkout-btn'); checkout.id = 'checkout-btn'; checkout.type = 'button'; checkout.addEventListener('click', () => startCheckout(state.cart));
      summary.append(subtotal, total, node('p', 'Final payment totals are calculated by the secure checkout service.'), checkout);
      grid.append(list, summary); container.append(grid);
    } catch (error) {
      container.replaceChildren(node('p', error.message || 'The cart could not be loaded.')); show('The cart could not be loaded.', true);
    }
  }
  global.DivineCartPage = { render, configurationSummary, buildProductImage, resolveLabel, startCheckout, authoritativeUnitPriceCents };
  document.addEventListener('DOMContentLoaded', render);
  global.addEventListener('cart:claim-success', render);
  global.addEventListener('auth:session-restored', render);
  global.addEventListener('auth:login-success', render);
}(typeof window !== 'undefined' ? window : globalThis));
