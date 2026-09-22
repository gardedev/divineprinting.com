(function (global) {
  'use strict';

  /**
   * standard-product-cart.js — DivineCart adapter for standard-configurable products.
   *
   * Collects ALL declared [data-dimension] controls (not just one) and any [data-option]
   * controls, builds a strict submission shape, and delegates to DivineCart.addConfiguredJob.
   *
   * Submission contract:
   *   { productId, customerConfiguration: { schemaVersion, options }, variantAllocations: [{ selections, quantity }] }
   *
   * Never submits: price, unitPriceCents, lineTotalCents, baseSku, sku, physicalUnits,
   * pricingSnapshot, availability, availableForSale, sellable.
   */

  // ── Utility ─────────────────────────────────────────────────────────────────

  function updateCartBadge() {
    const badge = document.getElementById('cart-count');
    if (!badge || !global.DivineCart || typeof global.DivineCart.loadCurrentCart !== 'function') return;
    global.DivineCart.loadCurrentCart(false).then(function (state) {
      const count = (state && state.items || []).reduce(function (sum, item) {
        return sum + (item.totalQuantity || item.quantity || 0);
      }, 0);
      badge.textContent = count;
      badge.style.display = count ? 'flex' : 'none';
    }).catch(function () { /* Cart badge must never interfere with product selection. */ });
  }

  function toggleMobileMenu() {
    const menu = document.getElementById('mobile-menu');
    if (!menu) return;
    menu.classList.toggle('active');
    document.body.style.overflow = menu.classList.contains('active') ? 'hidden' : '';
  }

  // ── Dimension & option collection ───────────────────────────────────────────

  /**
   * Collect all [data-dimension] controls within a product root.
   * Returns an object mapping dimensionKey → selectedValue, or null on error.
   *
   * A control contributes its value when:
   *   - It is a button/element with class "selected" and a [data-variant] attribute, OR
   *   - It is an <input> / <select> with a non-empty value.
   *
   * Duplicate dimension declarations (two controls with the same data-dimension attribute)
   * that both have non-empty values cause a local failure.
   */
  function collectDimensions(root) {
    const controls = Array.from(root.querySelectorAll('[data-dimension]'));
    const seen = new Map(); // dimensionKey → { value, count }

    for (const control of controls) {
      const dimensionKey = control.getAttribute('data-dimension');
      if (!dimensionKey) continue;

      let value = null;

      // Button/tile selectors: selected class + data-variant.
      if (control.tagName === 'BUTTON' || control.classList.contains('size-option') || control.hasAttribute('data-variant')) {
        if (control.classList.contains('selected') && control.dataset.variant) {
          value = control.dataset.variant;
        }
      } else if (control.tagName === 'SELECT' || control.tagName === 'INPUT') {
        value = control.value && control.value.trim() ? control.value.trim() : null;
      }

      if (value !== null) {
        const prior = seen.get(dimensionKey);
        if (prior) {
          // Two non-null values for the same dimension — duplicate conflict.
          seen.set(dimensionKey, { value: null, count: prior.count + 1, conflict: true });
        } else {
          seen.set(dimensionKey, { value, count: 1, conflict: false });
        }
      } else {
        // Ensure the key is registered even without a value so we can detect missing later.
        if (!seen.has(dimensionKey)) seen.set(dimensionKey, { value: null, count: 0, conflict: false });
      }
    }

    // Collect unique dimension keys declared anywhere in the root.
    const allDimensionKeys = new Set(controls.map(c => c.getAttribute('data-dimension')).filter(Boolean));

    const selections = {};
    for (const key of allDimensionKeys) {
      const entry = seen.get(key);
      if (!entry || entry.conflict) return { error: 'duplicate-dimension', key };
      if (entry.value === null) return { error: 'missing-selection', key };
      selections[key] = entry.value;
    }

    if (allDimensionKeys.size === 0) return { error: 'no-dimensions' };

    return { selections };
  }

  /**
   * Collect all [data-option] controls within a product root.
   * Returns an object mapping optionKey → value, or an error descriptor.
   *
   * Options with data-option-required="true" must have a non-empty value.
   */
  function collectOptions(root) {
    const controls = Array.from(root.querySelectorAll('[data-option]'));
    const options = {};

    for (const control of controls) {
      const optionKey = control.getAttribute('data-option');
      if (!optionKey) continue;

      let value = null;

      if (control.tagName === 'BUTTON' || control.hasAttribute('data-variant')) {
        if (control.classList.contains('selected') && control.dataset.variant) {
          value = control.dataset.variant;
        }
      } else if (control.tagName === 'SELECT' || control.tagName === 'INPUT') {
        value = control.value && control.value.trim() ? control.value.trim() : null;
      } else if (control.type === 'hidden') {
        value = control.value && control.value.trim() ? control.value.trim() : null;
      }

      const required = control.getAttribute('data-option-required') === 'true';
      if (required && value === null) return { error: 'missing-option', key: optionKey };
      if (value !== null) options[optionKey] = value;
    }

    return { options };
  }

  // ── Add to cart ─────────────────────────────────────────────────────────────

  async function add(button) {
    if (!global.DivineCart || typeof global.DivineCart.addConfiguredJob !== 'function') {
      console.error('DivineCart is not available. Cannot add to cart.');
      return;
    }

    const root = button.closest('[data-standard-product]');
    if (!root) return;

    const productId = root.dataset.productId;
    const message = root.querySelector('[data-cart-error]');
    const clearError = () => { if (message) message.textContent = ''; };
    const setError = (text) => { if (message) message.textContent = text; };

    clearError();

    if (!productId) { setError('Product configuration error: missing product ID.'); return; }

    // Collect dimension selections.
    const dimResult = collectDimensions(root);
    if (dimResult.error) {
      if (dimResult.error === 'duplicate-dimension') setError(`Please make only one selection for "${dimResult.key}".`);
      else if (dimResult.error === 'missing-selection') setError(`Please choose a ${dimResult.key}.`);
      else setError('Please complete all product selections.');
      return;
    }
    const selections = dimResult.selections;

    // Collect required options.
    const optResult = collectOptions(root);
    if (optResult.error) {
      if (optResult.error === 'missing-option') setError(`Please choose a ${optResult.key}.`);
      else setError('Please complete all required options.');
      return;
    }
    const options = optResult.options;

    // Collect quantity.
    const quantityMode = root.dataset.quantityMode;
    const quantity = quantityMode === 'DISCRETE_SELECTION'
      ? 1
      : Number(
          (root.querySelector('[data-cart-quantity]') && root.querySelector('[data-cart-quantity]').value) ||
          (root.querySelector('#qty') && root.querySelector('#qty').textContent) ||
          1
        );
    const minimum = Number(root.dataset.minimumQuantity || 1);
    const increment = Number(root.dataset.quantityIncrement || 1);

    if (!Number.isInteger(quantity) || quantity < minimum || (quantity - minimum) % increment !== 0) {
      setError('Please enter a valid quantity of ' + minimum + ' or more' + (increment > 1 ? ' in increments of ' + increment : '') + '.');
      return;
    }

    button.disabled = true;
    try {
      // Strict submission: only productId, schemaVersion, options, selections, quantity.
      await global.DivineCart.addConfiguredJob({
        productId,
        customerConfiguration: { schemaVersion: 'standard-product-v1', options },
        variantAllocations: [{ selections, quantity }],
      });
      global.location.href = '/cart.html';
    } catch (error) {
      setError(error.message || 'Unable to add this item. Please try again.');
    } finally {
      button.disabled = false;
    }
  }

  // ── Package summary display (backward compat for package-mode products) ──────

  function packageSummary(root) {
    if (!root.dataset.packageUnits) return;
    // Support single data-dimension for package-mode backward compat.
    const dimensionKey = root.dataset.dimension;
    const choice = dimensionKey
      ? root.querySelector(`[data-dimension="${dimensionKey}"].selected, [data-dimension="${dimensionKey}"][data-variant].selected`)
      : root.querySelector('[data-variant].selected, .size-option.selected');
    const key = choice && choice.dataset.variant;
    const packs = Number((root.querySelector('#qty') && root.querySelector('#qty').textContent) || 1);
    const units = key && JSON.parse(root.dataset.packageUnits)[key];
    const output = root.querySelector('[data-physical-quantity]');
    if (output && Number.isInteger(packs) && units) {
      output.textContent = choice.textContent.trim().replace(/\s*-\s*\$.*$/, '') + ' \u00d7 ' + packs + ' pack' + (packs === 1 ? '' : 's') + ' = ' + (units * packs) + ' ' + (root.dataset.physicalLabel || 'units');
    }
  }

  // ── Event wiring ─────────────────────────────────────────────────────────────

  document.addEventListener('click', function (event) {
    const button = event.target.closest('[data-add-standard-product]');
    if (button) {
      event.preventDefault();
      add(button);
      return;
    }
    const root = event.target.closest('[data-standard-product]');
    if (root) setTimeout(function () { packageSummary(root); }, 0);
  });

  global.toggleMobileMenu = toggleMobileMenu;

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-standard-product]').forEach(packageSummary);
    updateCartBadge();
  });

}(window));
